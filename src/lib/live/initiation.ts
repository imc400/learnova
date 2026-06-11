import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  liveSessions,
  learningPaths,
  routeAgents,
  modules,
  lessons,
  videoCandidates,
} from "@/db/schema";
import { buildClassBrief } from "@/lib/live/brief";
import { buildInductionPrompt } from "@/lib/live/persona";

/*
  Iniciación de una sesión de aula: UNA sola fuente de verdad para el prompt
  completo (persona + arco + brief), el saludo con memoria y la pizarra.
  La consumen DOS caminos:
  - El initiation webhook (/api/live/initiation): ElevenLabs pide el prompt
    server-to-server — jamás viaja al navegador (modo seguro).
  - La página del aula (modo legado sin webhook secret): overrides cliente.
*/

export interface SessionInitiation {
  prompt: string;
  firstMessage: string;
  language: "es" | "en";
  kind: "class" | "induction";
  userId: string;
  pathId: string;
  pathTitle: string;
  teacherName: string;
  specialty: string;
  elevenlabsAgentId: string | null;
  /** Mapa de la ruta para la pizarra (con video por lección para mostrar_video). */
  outline: { title: string; lessons: { title: string; videoId: string | null }[] }[];
  /** Tareas pendientes numeradas (mismo orden que el brief) para marcar_tarea. */
  pendingHomework: { id: string; task: string }[];
}

/**
 * Construye todo lo necesario para iniciar la conversación de una sesión
 * in_progress. `userId` opcional: la página lo exige (ownership con auth);
 * el webhook no tiene usuario autenticado y confía en el UUID + estado + el
 * match de agente que valida el route handler.
 */
export async function buildSessionInitiation(
  sessionId: string,
  opts?: { userId?: string },
): Promise<SessionInitiation | null> {
  const conds = [eq(liveSessions.id, sessionId), eq(liveSessions.status, "in_progress")];
  if (opts?.userId) conds.push(eq(liveSessions.userId, opts.userId));
  const [session] = await db
    .select({
      id: liveSessions.id,
      userId: liveSessions.userId,
      pathId: liveSessions.pathId,
      kind: liveSessions.kind,
    })
    .from(liveSessions)
    .where(and(...conds))
    .limit(1);
  if (!session) return null;

  const [path] = await db
    .select({
      title: learningPaths.title,
      language: learningPaths.language,
      skeletonCacheKey: learningPaths.skeletonCacheKey,
    })
    .from(learningPaths)
    .where(eq(learningPaths.id, session.pathId))
    .limit(1);
  if (!path) return null;

  const cacheKey = path.skeletonCacheKey ?? `path-${session.pathId}`;
  const [agent] = await db
    .select()
    .from(routeAgents)
    .where(eq(routeAgents.cacheKey, cacheKey))
    .limit(1);
  if (!agent) return null;

  // Brief con memoria (100% server-derived) — por carga/conversación.
  const brief = await buildClassBrief(session.userId, session.pathId, agent.greeting);

  // Outline de la ruta → la PIZARRA que el profesor controla en vivo.
  const mods = await db
    .select({
      title: modules.title,
      orderIndex: modules.orderIndex,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      lessonIndex: lessons.orderIndex,
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(eq(modules.pathId, session.pathId))
    .orderBy(asc(modules.orderIndex), asc(lessons.orderIndex));

  // Video principal por lección (candidato ACTIVO de mejor rank) para la
  // tool mostrar_video — solo IDs públicos de YouTube, cero cuota Data API.
  const lessonIds = mods.map((r) => r.lessonId);
  const candidates = lessonIds.length
    ? await db
        .select({
          lessonId: videoCandidates.lessonId,
          videoId: videoCandidates.youtubeVideoId,
          rank: videoCandidates.rank,
        })
        .from(videoCandidates)
        .where(
          and(
            inArray(videoCandidates.lessonId, lessonIds),
            eq(videoCandidates.isActive, true),
          ),
        )
        .orderBy(asc(videoCandidates.rank))
    : [];
  const videoByLesson = new Map<string, string>();
  for (const c of candidates) {
    if (!videoByLesson.has(c.lessonId)) videoByLesson.set(c.lessonId, c.videoId);
  }

  const outlineMap = new Map<number, SessionInitiation["outline"][number]>();
  for (const r of mods) {
    const m = outlineMap.get(r.orderIndex) ?? { title: r.title, lessons: [] };
    m.lessons.push({ title: r.lessonTitle, videoId: videoByLesson.get(r.lessonId) ?? null });
    outlineMap.set(r.orderIndex, m);
  }
  const outline = [...outlineMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, m]) => m);

  const isInduction = session.kind === "induction";
  const prompt = isInduction
    ? `${buildInductionPrompt({
        persona: {
          name: agent.name,
          specialty: agent.specialty,
          style: agent.style,
          greeting: agent.greeting,
          // Rasgos de voz: irrelevantes para el prompt (la voz ya vive en el
          // agente de ElevenLabs); valores neutros para satisfacer el tipo.
          voiceGender: "m",
          voiceEnergy: "calida",
        },
        routeTitle: path.title,
        language: path.language,
      })}\n\n${brief.briefText}`
    : `${agent.systemPrompt}\n\n${brief.briefText}`;
  const firstMessage = isInduction
    ? `¡Hola ${brief.studentFirstName}! Soy ${agent.name}, tu profesor en esta ruta. Te doy la bienvenida. Antes de que empieces, déjame mostrarte qué vamos a aprender juntos y cómo funciona todo esto. ¿Te parece?`
    : brief.scriptedGreeting;

  return {
    prompt,
    firstMessage,
    language: path.language.slice(0, 2) === "en" ? "en" : "es",
    kind: isInduction ? "induction" : "class",
    userId: session.userId,
    pathId: session.pathId,
    pathTitle: path.title,
    teacherName: agent.name,
    specialty: agent.specialty,
    elevenlabsAgentId: agent.elevenlabsAgentId,
    outline,
    pendingHomework: brief.pendingHomework,
  };
}
