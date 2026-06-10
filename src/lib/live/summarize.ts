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
        relatedLessonTitle: z
          .string()
          .nullable()
          .describe(
            "Título EXACTO de la lección de la ruta que sirve de apoyo para esta tarea (de la lista LECCIONES DE LA RUTA), o null si ninguna aplica",
          ),
      }),
    )
    .describe("Las tareas que el profesor asignó en el cierre (3-5); si no asignó, derívalas de lo trabajado"),
});

const SUMMARIZE_INSTRUCTIONS = `Destilas la transcripción de una clase particular en español. REGLAS: solo hechos presentes en la transcripción (jamás inventes); las tareas deben ser las que el profesor dijo en el cierre (o derivadas directamente de lo practicado); tono cálido y concreto.`;

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

  // Lecciones reales de la ruta → recursos INTERNOS verificables por tarea
  // (la IA solo puede citar títulos de esta lista; nada inventado).
  const pathLessons = await db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.pathId, session.pathId));
  const lessonByTitle = new Map(
    pathLessons.map((l) => [l.title.toLowerCase().trim(), l.id]),
  );

  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: 2000,
    system: cachedSystem(SUMMARIZE_INSTRUCTIONS),
    output_config: { format: zodOutputFormat(classSummarySchema) },
    messages: [
      {
        role: "user",
        content: [
          `LECCIONES DE LA RUTA (únicos títulos válidos para relatedLessonTitle):\n${pathLessons.map((l) => `- ${l.title}`).join("\n")}`,
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
        // Recurso interno: link a la lección de apoyo SOLO si existe de verdad.
        const lessonId = h.relatedLessonTitle
          ? lessonByTitle.get(h.relatedLessonTitle.toLowerCase().trim())
          : undefined;
        return {
          sessionId,
          userId: session.userId,
          pathId: session.pathId,
          task: h.task,
          kind: h.kind,
          resources: lessonId
            ? [
                {
                  title: h.relatedLessonTitle!,
                  href: `/app/rutas/${session.pathId}/leccion/${lessonId}`,
                },
              ]
            : [],
        };
      }),
    );
  }

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
  const mergedProfile = {
    ...prevProfile,
    lastClassAt: new Date().toISOString(),
    lastHighlight: distilled.highlight,
    recentStruggles: distilled.struggles.slice(0, 3),
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

  // Correo con resumen + tareas (el outbox dedupea por sessionId).
  const [pathRow] = await db
    .select({ title: learningPaths.title, cacheKey: learningPaths.skeletonCacheKey })
    .from(learningPaths)
    .where(eq(learningPaths.id, session.pathId))
    .limit(1);
  const [teacher] = pathRow?.cacheKey
    ? await db
        .select({ name: routeAgents.name })
        .from(routeAgents)
        .where(eq(routeAgents.cacheKey, pathRow.cacheKey))
        .limit(1)
    : [];
  await enqueueProgressEmail(session.userId, "class_summary", sessionId, {
    pathId: session.pathId,
    pathTitle: pathRow?.title ?? "tu ruta",
    moduleTitle: teacher?.name ?? "tu profesor",
    lessonTitles: [
      ...distilled.summary.slice(0, 3),
      ...distilled.homework.map((h) => `📝 ${h.task}`),
    ],
  });

  return `resumida: ${distilled.homework.length} tareas`;
}
