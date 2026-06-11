import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  liveSessions,
  modules as modulesT,
  lessons as lessonsT,
  videoCandidates,
} from "@/db/schema";
import {
  generateModuleSkeleton,
  generateLessonContent,
  generateVideoQueries,
} from "@/lib/ai/generate";
import { getVideoInsights, type VideoDigest } from "@/lib/video/insights";
import {
  curateAndSaveVideo,
  generateAndSaveQuiz,
  swapVideoRanks,
  effectiveCoverage,
} from "./run";
import { enqueueProgressEmail } from "@/lib/email/enqueue";

/*
  Extensión de ruta POST-CLASE: el profesor propuso un módulo en vivo
  (client tool agregar_modulo) y aquí se materializa con el MISMO pipeline
  de calidad de la generación original (queries → video curado + digest +
  coverage gate → lección anclada → quiz grounded).

  Diferencia deliberada con runPathGeneration: este módulo es PERSONAL
  (nace del feedback de UN alumno), así que NO lee ni escribe
  lesson_content_cache — jamás contamina el canónico compartido.
*/

export async function extendPathWithModule(args: {
  pathId: string;
  sessionId: string;
  requestedTitle: string;
  reason: string;
}): Promise<string> {
  const [path] = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.id, args.pathId))
    .limit(1);
  if (!path) return "ruta no encontrada";

  // Idempotencia (Trigger es at-least-once). Dedupe DETERMINÍSTICO por
  // source_session_id (A-P2): si Sonnet renombra el módulo, el match por
  // título fallaba y cada retry creaba un duplicado. El título queda como
  // fallback para módulos pre-migración.
  const existing = await db
    .select({
      id: modulesT.id,
      title: modulesT.title,
      objective: modulesT.objective,
      orderIndex: modulesT.orderIndex,
      source: modulesT.source,
      sourceSessionId: modulesT.sourceSessionId,
    })
    .from(modulesT)
    .where(eq(modulesT.pathId, args.pathId))
    .orderBy(asc(modulesT.orderIndex));
  const dupe = existing.find(
    (m) =>
      (m.source === "teacher" && m.sourceSessionId === args.sessionId) ||
      (m.source === "teacher" &&
        m.title.toLowerCase().includes(args.requestedTitle.toLowerCase().slice(0, 30))),
  );
  if (dupe) return `ya existe: ${dupe.title}`;

  // Dificultades recientes del alumno (del resumen de la clase, si ya está).
  const [session] = await db
    .select({ summary: liveSessions.summary })
    .from(liveSessions)
    .where(eq(liveSessions.id, args.sessionId))
    .limit(1);
  const struggles =
    ((session?.summary as { struggles?: string[] } | null)?.struggles ?? []).slice(0, 3);

  // 1) Sonnet diseña el módulo que encaja con la ruta sin repetirla.
  const mod = await generateModuleSkeleton({
    pathTitle: path.title,
    goal: path.goal,
    level: path.level,
    language: path.language,
    existingModules: existing.map((m) => m.title),
    requestedTitle: args.requestedTitle,
    reason: args.reason,
    struggles,
    tracking: { pathId: args.pathId },
  });

  // 2) Estructura primero (visible al instante con spinners por lección).
  const nextIndex = (existing.at(-1)?.orderIndex ?? -1) + 1;
  const [inserted] = await db
    .insert(modulesT)
    .values({
      pathId: args.pathId,
      orderIndex: nextIndex,
      title: mod.title,
      description: mod.description,
      objective: mod.objective,
      source: "teacher",
      sourceSessionId: args.sessionId, // dedupe determinístico de reintentos
    })
    .onConflictDoNothing({ target: [modulesT.pathId, modulesT.orderIndex] })
    .returning();
  if (!inserted) return "carrera: otro proceso insertó el módulo";

  const lessonRows: { id: string; ls: (typeof mod.lessons)[number] }[] = [];
  for (const [li, ls] of mod.lessons.entries()) {
    const [lesson] = await db
      .insert(lessonsT)
      .values({
        moduleId: inserted.id,
        orderIndex: li,
        title: ls.title,
        estimatedMinutes: ls.estimatedMinutes,
        stubSummary: ls.summary, // reanchorLesson lo necesita (A-P2)
      })
      .onConflictDoNothing({ target: [lessonsT.moduleId, lessonsT.orderIndex] })
      .returning();
    if (lesson) lessonRows.push({ id: lesson.id, ls });
  }
  await db
    .update(learningPaths)
    .set({
      totalLessons: (path.totalLessons ?? 0) + lessonRows.length,
      updatedAt: new Date(),
    })
    .where(eq(learningPaths.id, args.pathId));

  // 3) Videos ya usados en la ruta → no repetir en el módulo nuevo.
  const allLessonIds = await db
    .select({ id: lessonsT.id })
    .from(lessonsT)
    .innerJoin(modulesT, eq(lessonsT.moduleId, modulesT.id))
    .where(eq(modulesT.pathId, args.pathId));
  const used = allLessonIds.length
    ? await db
        .select({ vid: videoCandidates.youtubeVideoId })
        .from(videoCandidates)
        .where(inArray(videoCandidates.lessonId, allLessonIds.map((l) => l.id)))
    : [];
  const usedVideoIds = new Set(used.map((u) => u.vid));

  // 4) Mismo pipeline de calidad por lección (Stage A→D, sin caché canónico).
  let queryByIndex = new Map<number, string>();
  try {
    const q = await generateVideoQueries({
      routeTitle: path.title,
      moduleTitle: mod.title,
      moduleObjective: mod.objective,
      lessons: lessonRows.map(({ ls }, i) => ({
        index: i,
        title: ls.title,
        summary: ls.summary,
      })),
      language: path.language,
      level: path.level,
      tracking: { pathId: args.pathId },
    });
    queryByIndex = new Map(q.queries.map((x) => [x.lessonIndex, x.query]));
  } catch (e) {
    console.error(`[extend] queries de video fallaron:`, e);
  }

  await Promise.all(
    lessonRows.map(async ({ id: lessonId, ls }, li) => {
      // El ranker recibe lección + nivel dentro del objetivo (A-P1.7).
      const rankObjective = `${mod.objective} · LECCIÓN: ${ls.title} — ${ls.summary} · NIVEL DEL ESTUDIANTE: ${path.level}`;
      const vids = await curateAndSaveVideo(
        lessonId,
        queryByIndex.get(li) ?? ls.title,
        rankObjective,
        path.language,
        path.title,
        usedVideoIds,
      );
      for (const v of vids) usedVideoIds.add(v.videoId);
      let topVideo = vids[0] ?? null;
      let digest: VideoDigest | null = null;
      if (topVideo) {
        try {
          const coverageSummary = `${ls.summary} (contexto de la ruta: ${path.title})`;
          let ins = await getVideoInsights({
            videoId: topVideo.videoId,
            lessonSummary: coverageSummary,
            language: path.language,
            durationSeconds: topVideo.durationSeconds ?? null,
          });
          const alt = vids[1];
          if (ins && effectiveCoverage(ins.digest, path.level) < 0.5 && alt) {
            const altIns = await getVideoInsights({
              videoId: alt.videoId,
              lessonSummary: coverageSummary,
              language: path.language,
              durationSeconds: alt.durationSeconds ?? null,
            });
            if (
              altIns &&
              effectiveCoverage(altIns.digest, path.level) >
                effectiveCoverage(ins.digest, path.level)
            ) {
              ins = altIns;
              topVideo = alt;
              // A-P1.6: el ganador del gate se PROMUEVE a rank 0 — antes el
              // alumno veía el video #1 con la guía y el quiz anclados al #2,
              // justo en el flujo premium (módulo del profesor post-clase).
              await swapVideoRanks(lessonId, alt.videoId).catch((e) =>
                console.error(`[extend] swap de rank falló:`, e),
              );
            }
          }
          if (ins && effectiveCoverage(ins.digest, path.level) < 0.35) {
            // Igual que en run.ts: si ningún candidato cubre la lección, se
            // desactivan TODOS (no solo el top) — la UI no debe promover un
            // video jamás verificado.
            await db
              .update(videoCandidates)
              .set({ isActive: false })
              .where(eq(videoCandidates.lessonId, lessonId))
              .catch(() => {});
            topVideo = null;
            ins = null;
          }
          digest = ins?.digest ?? null;
        } catch (e) {
          console.error(`[extend] digest falló (lección ${lessonId}):`, e);
        }
      }

      const content = await generateLessonContent({
        pathTitle: path.title,
        moduleTitle: mod.title,
        moduleObjective: mod.objective,
        lessonTitle: ls.title,
        lessonSummary: ls.summary,
        level: path.level,
        language: path.language,
        videoDigest: digest,
        videoDurationSeconds: topVideo?.durationSeconds ?? null,
        tracking: { pathId: args.pathId },
      });
      await db
        .update(lessonsT)
        .set({ content, notes: content.keyTakeaways.join("\n• ") })
        .where(eq(lessonsT.id, lessonId));

      await generateAndSaveQuiz(
        lessonId,
        ls.title,
        ls.summary,
        path.level,
        path.language,
        content,
        digest,
        topVideo?.durationSeconds ?? null,
        { pathId: args.pathId },
      ).catch((e) => console.error(`[extend] quiz falló (lección ${lessonId}):`, e));
    }),
  );

  // 5) Avísale al alumno: su profesor le agregó un módulo a medida.
  await enqueueProgressEmail(path.userId, "module_ready", inserted.id, {
    pathId: args.pathId,
    pathTitle: path.title,
    moduleId: inserted.id,
    moduleTitle: `${mod.title} — agregado por tu profesor tras la clase`,
    lessonTitles: mod.lessons.map((l) => l.title),
    language: path.language,
  });

  return `módulo agregado: ${mod.title} (${lessonRows.length} lecciones)`;
}
