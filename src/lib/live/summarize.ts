import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db } from "@/db";
import {
  liveSessions,
  homeworkItems,
  learnerProfiles,
  learningPaths,
  routeAgents,
  lessons,
  modules,
} from "@/db/schema";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";
import { getConversationTranscript } from "./provider";
import { enqueueProgressEmail } from "@/lib/email/enqueue";

/*
  Post-clase: destila la transcripción en UN artefacto con dos usos —
  (1) resumen + tareas para el correo del alumno, (2) merge en la memoria
  del profesor (learner_profiles) para que la PRÓXIMA clase abra con contexto.
*/

const classSummarySchema = z.object({
  summary: z
    .array(z.string())
    .describe("3-5 frases de lo que se trabajó en la clase, concretas"),
  highlight: z.string().describe("El logro o avance más destacable del alumno hoy"),
  struggles: z
    .array(z.string())
    .describe("0-3 puntos donde el alumno mostró dificultad (para la memoria)"),
  homework: z
    .array(
      z.object({
        task: z.string().describe("Tarea concreta y accionable"),
        kind: z.enum(["retrieval", "aplicada"]),
        // Índice numérico, NO título: los enteros no se parafrasean ("Iluminación
        // natural" vs "Iluminación con luz natural" perdía el recurso).
        relatedLessonIndex: z
          .number()
          .int()
          .nullable()
          .describe(
            "Número EXACTO de la lección de apoyo según la lista numerada LECCIONES DE LA RUTA (la primera = 1), o null si ninguna aplica",
          ),
      }),
    )
    .describe("Las tareas que el profesor asignó en el cierre (3-5); si no asignó, derívalas de lo trabajado"),
});

const SUMMARIZE_INSTRUCTIONS = `Destilas la transcripción de una clase particular en español. REGLAS: solo hechos presentes en la transcripción (jamás inventes); las tareas deben ser las que el profesor dijo en el cierre (o derivadas directamente de lo practicado); si el profesor ejecutó acciones (líneas [acción del profesor: …] como agregar un módulo o agendar la próxima clase), el resumen las menciona; tono cálido y concreto.`;

export async function summarizeClass(sessionId: string): Promise<string> {
  const [session] = await db
    .select()
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId))
    .limit(1);
  if (!session) return "sesión no encontrada";
  if (!session.conversationId) return "sin conversación que resumir";
  if (session.summary) return "ya resumida";

  // CLAIM atómico: dos ejecuciones concurrentes (Trigger es at-least-once) no
  // pueden duplicar tareas/correo. Solo procesa quien gana el update.
  const claimedRows = await db
    .update(liveSessions)
    .set({ summary: { claiming: true }, updatedAt: new Date() })
    .where(and(eq(liveSessions.id, sessionId), isNull(liveSessions.summary)))
    .returning({ id: liveSessions.id });
  if (!claimedRows.length) return "ya resumida (claim)";
  // Si algo falla de aquí en adelante, soltamos el claim para que el
  // reintento de Trigger pueda volver a procesar.
  const releaseClaim = () =>
    db
      .update(liveSessions)
      .set({ summary: null, updatedAt: new Date() })
      .where(eq(liveSessions.id, sessionId))
      .catch(() => {});

  try {
    // La transcripción tarda en procesarse en ElevenLabs (a veces minutos).
    let transcript: Awaited<ReturnType<typeof getConversationTranscript>> | null = null;
    for (let i = 0; i < 9; i++) {
      transcript = await getConversationTranscript(session.conversationId);
      if (transcript.status === "done" && transcript.transcript.length) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
    if (!transcript?.transcript.length) {
      // Lanzar (no retornar): Trigger reintenta con backoff y la transcripción
      // suele estar lista al siguiente intento. Sin esto, el correo se pierde.
      await releaseClaim();
      throw new Error("transcripción aún no disponible — reintentar");
    }
    return await processTranscript(sessionId, session, transcript);
  } catch (e) {
    await releaseClaim();
    throw e;
  }
}

type SessionRow = typeof liveSessions.$inferSelect;

async function processTranscript(
  sessionId: string,
  session: SessionRow,
  transcript: Awaited<ReturnType<typeof getConversationTranscript>>,
): Promise<string> {
  // Ruta + profesor primero: validan la conversación y alimentan el correo.
  const [pathRow] = await db
    .select({ title: learningPaths.title, cacheKey: learningPaths.skeletonCacheKey })
    .from(learningPaths)
    .where(eq(learningPaths.id, session.pathId))
    .limit(1);
  const [teacher] = pathRow?.cacheKey
    ? await db
        .select({ name: routeAgents.name, elId: routeAgents.elevenlabsAgentId })
        .from(routeAgents)
        .where(eq(routeAgents.cacheKey, pathRow.cacheKey))
        .limit(1)
    : [];

  // SEGURIDAD: la conversación debe ser DEL AGENTE de esta ruta. Un
  // conversationId ajeno (attachConversationAction acepta strings del
  // cliente) no puede inyectar resumen/tareas/memoria de otra conversación.
  if (transcript.agentId && teacher?.elId && transcript.agentId !== teacher.elId) {
    await db
      .update(liveSessions)
      .set({ summary: { invalid: "agent_mismatch" }, updatedAt: new Date() })
      .where(eq(liveSessions.id, sessionId));
    return "conversación de otro agente — descartada (sin correo)";
  }

  // Duración real (más confiable que la estimada del cliente).
  if (transcript.durationSec > 0) {
    await db
      .update(liveSessions)
      .set({ durationSec: transcript.durationSec, updatedAt: new Date() })
      .where(eq(liveSessions.id, sessionId));
  }

  const convoText = transcript.transcript
    .map((t) => `${t.role === "agent" ? "PROFESOR" : "ALUMNO"}: ${t.message}`)
    .join("\n")
    .slice(0, 40_000);

  // Lecciones reales de la ruta, NUMERADAS → recursos INTERNOS verificables
  // por tarea (la IA solo puede citar índices de esta lista; nada inventado).
  const pathLessons = await db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.pathId, session.pathId))
    .orderBy(modules.orderIndex, lessons.orderIndex);

  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: 2000,
    // Extracción de hechos, no creatividad: varianza baja.
    temperature: 0.2,
    system: cachedSystem(SUMMARIZE_INSTRUCTIONS),
    output_config: { format: zodOutputFormat(classSummarySchema) },
    messages: [
      {
        role: "user",
        content: [
          `LECCIONES DE LA RUTA (cita lecciones SOLO por su número):\n${pathLessons.map((l, i) => `${i + 1}. ${l.title}`).join("\n")}`,
          `TRANSCRIPCIÓN DE LA CLASE:\n${convoText}`,
        ].join("\n\n"),
      },
    ],
  });
  // Lanzar para que el catch externo suelte el claim y Trigger reintente.
  if (!res.parsed_output) throw new Error("destilado falló (parsed_output null)");
  const distilled = res.parsed_output;

  // Persistir: resumen en la sesión + tareas + memoria del alumno (merge).
  await db
    .update(liveSessions)
    .set({ summary: distilled, updatedAt: new Date() })
    .where(eq(liveSessions.id, sessionId));

  if (distilled.homework.length) {
    await db.insert(homeworkItems).values(
      distilled.homework.slice(0, 5).map((h) => {
        // Recurso interno: link a la lección de apoyo SOLO si el índice es real.
        const lesson =
          h.relatedLessonIndex && h.relatedLessonIndex >= 1 && h.relatedLessonIndex <= pathLessons.length
            ? pathLessons[h.relatedLessonIndex - 1]
            : undefined;
        return {
          sessionId,
          userId: session.userId,
          pathId: session.pathId,
          task: h.task,
          kind: h.kind,
          resources: lesson
            ? [
                {
                  title: lesson.title,
                  href: `/app/rutas/${session.pathId}/leccion/${lesson.id}`,
                },
              ]
            : [],
        };
      }),
    );
  }

  // Cerrar el loop de tareas: las completadas que el brief de ESTA clase le
  // mostró al profesor (para celebrarlas) quedan marcadas como repasadas —
  // la próxima clase no las re-celebra. Las nuevas de hoy nacen done=false.
  await db
    .update(homeworkItems)
    .set({ reviewedInSessionId: sessionId })
    .where(
      and(
        eq(homeworkItems.userId, session.userId),
        eq(homeworkItems.pathId, session.pathId),
        eq(homeworkItems.done, true),
        isNull(homeworkItems.reviewedInSessionId),
      ),
    );

  const [existing] = await db
    .select({ id: learnerProfiles.id, profile: learnerProfiles.profile })
    .from(learnerProfiles)
    .where(
      and(
        eq(learnerProfiles.userId, session.userId),
        eq(learnerProfiles.pathId, session.pathId),
      ),
    )
    .limit(1);
  const prevProfile = (existing?.profile as Record<string, unknown>) ?? {};
  // Memoria ACUMULATIVA, no foto: la clase 2 ya no borra lo aprendido en la 1.
  // Trabas con dedupe (case-insensitive) y cap 6 FIFO (quedan las recientes).
  const prevStruggles = Array.isArray(prevProfile.recentStruggles)
    ? (prevProfile.recentStruggles as string[])
    : [];
  const seen = new Set<string>();
  const mergedStruggles = [...prevStruggles, ...distilled.struggles]
    .filter((s) => {
      const k = s.toLowerCase().trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(-6);
  const mergedProfile = {
    ...prevProfile,
    lastClassAt: new Date().toISOString(),
    lastHighlight: distilled.highlight,
    recentStruggles: mergedStruggles,
    classCount: (Number(prevProfile.classCount) || 0) + 1,
    // exitTicket lo escribe la tool registrar_aprendizaje durante la clase.
    ...(session.exitTicket ? { lastExitTicket: session.exitTicket } : {}),
  };
  if (existing) {
    await db
      .update(learnerProfiles)
      .set({ profile: mergedProfile, updatedAt: new Date() })
      .where(eq(learnerProfiles.id, existing.id));
  } else {
    await db.insert(learnerProfiles).values({
      userId: session.userId,
      pathId: session.pathId,
      profile: mergedProfile,
    });
  }

  // Correo con resumen + tareas (el outbox dedupea por sessionId). Sin
  // emojis (regla de marca: gesto = texto); el prefijo "Tarea:" separa lo
  // accionable del resumen dentro de la plantilla actual.
  await enqueueProgressEmail(session.userId, "class_summary", sessionId, {
    pathId: session.pathId,
    pathTitle: pathRow?.title ?? "tu ruta",
    moduleTitle: teacher?.name ?? "tu profesor",
    lessonTitles: [
      ...distilled.summary.slice(0, 3),
      ...distilled.homework.map((h) => `Tarea: ${h.task}`),
    ],
  });

  return `resumida: ${distilled.homework.length} tareas`;
}
