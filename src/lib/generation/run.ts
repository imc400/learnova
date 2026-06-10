import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  skeletonCache,
  lessonContentCache,
  modules as modulesT,
  lessons as lessonsT,
  quizzes as quizzesT,
  questions as questionsT,
  videoCandidates,
} from "@/db/schema";
import {
  generatePathSkeleton,
  generateLessonContent,
  generateQuiz,
  generateVideoQueries,
} from "@/lib/ai/generate";
import { curateVideoForLesson } from "@/lib/youtube/curate";
import { getVideoDetails } from "@/lib/youtube/client";
import { getVideoInsights, type VideoDigest } from "@/lib/video/insights";
import type {
  Intake,
  PathSkeleton,
  LessonContent,
  GeneratedQuiz,
} from "@/lib/ai/schemas";

type GeneratedQuizData = GeneratedQuiz;
import { env } from "@/lib/env";

/**
 * Orquesta la generación PROGRESIVA de una ruta:
 * 1) Planifica el esqueleto (Opus o caché de cabeza gruesa).
 * 2) Inserta TODA la estructura (módulos + stubs de lección) y marca la ruta
 *    'ready' de inmediato → el usuario ve el árbol completo y puede empezar.
 * 3) Rellena el contenido por módulo EN ORDEN (los primeros primero); cada
 *    lección queda disponible apenas se genera. El progreso se publica en vivo.
 * Idempotente (upserts + guard de progreso) y tolerante a fallos.
 */
export async function runPathGeneration(pathId: string): Promise<void> {
  const [path] = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.id, pathId))
    .limit(1);
  if (!path) throw new Error(`Ruta ${pathId} no encontrada`);
  if (path.generationProgress >= 100) return; // idempotente: contenido ya completo

  try {
    await db
      .update(learningPaths)
      .set({
        status: "generating",
        generationProgress: 8,
        generationStep: "Planificando tu currículum…",
        generationStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    const meta = (path.intake ?? {}) as Partial<Intake>;
    const intake: Intake = {
      topic: path.topic,
      goal: path.goal,
      level: path.level,
      language: path.language,
      priorExperience: meta.priorExperience,
      weeklyHours: meta.weeklyHours,
    };

    // --- NIVEL 1 con CACHÉ DE CABEZA GRUESA ---
    const cacheKey = `${intake.topic.toLowerCase().trim()}-${intake.level}-${intake.language}`;
    const [cached] = await db
      .select()
      .from(skeletonCache)
      .where(and(eq(skeletonCache.cacheKey, cacheKey), eq(skeletonCache.version, 1)))
      .limit(1);

    let skeleton: PathSkeleton;
    if (cached) {
      skeleton = cached.skeleton as PathSkeleton;
      await db
        .update(skeletonCache)
        .set({ timesReused: sql`${skeletonCache.timesReused} + 1`, updatedAt: new Date() })
        .where(eq(skeletonCache.id, cached.id));
    } else {
      skeleton = await generatePathSkeleton(intake);
      await db
        .insert(skeletonCache)
        .values({
          cacheKey,
          topic: intake.topic,
          language: intake.language,
          level: intake.level,
          skeleton,
        })
        .onConflictDoUpdate({
          target: [skeletonCache.cacheKey, skeletonCache.version],
          set: { timesReused: sql`${skeletonCache.timesReused} + 1`, updatedAt: new Date() },
        });
    }

    const totalLessons = skeleton.modules.reduce(
      (n, m) => n + m.lessons.length,
      0,
    );
    await db
      .update(learningPaths)
      .set({
        title: skeleton.title,
        level: skeleton.level,
        estimatedHours: skeleton.estimatedHours,
        skeletonCacheKey: cacheKey,
        totalLessons,
        generationProgress: 18,
        generationStep: `Estructurando ${skeleton.modules.length} módulos…`,
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    // --- PASO 1: insertar módulos + stubs de lección (sin contenido, instantáneo) ---
    const plan: Array<{
      m: PathSkeleton["modules"][number];
      lessons: Array<{
        id: string;
        ls: PathSkeleton["modules"][number]["lessons"][number];
      }>;
    }> = [];

    for (const [mi, m] of skeleton.modules.entries()) {
      const [mod] = await db
        .insert(modulesT)
        .values({
          pathId,
          orderIndex: mi,
          title: m.title,
          description: m.description,
          objective: m.objective,
        })
        .onConflictDoUpdate({
          target: [modulesT.pathId, modulesT.orderIndex],
          set: { title: m.title, description: m.description, objective: m.objective },
        })
        .returning();
      if (!mod) continue;

      const lessons: Array<{ id: string; ls: (typeof m.lessons)[number] }> = [];
      for (const [li, ls] of m.lessons.entries()) {
        const [lesson] = await db
          .insert(lessonsT)
          .values({
            moduleId: mod.id,
            orderIndex: li,
            title: ls.title,
            estimatedMinutes: ls.estimatedMinutes,
          })
          .onConflictDoUpdate({
            target: [lessonsT.moduleId, lessonsT.orderIndex],
            set: { title: ls.title, estimatedMinutes: ls.estimatedMinutes },
          })
          .returning();
        if (lesson) lessons.push({ id: lesson.id, ls });
      }
      plan.push({ m, lessons });
    }

    // Estructura completa → la ruta YA es navegable. El usuario ve el árbol entero.
    await db
      .update(learningPaths)
      .set({
        status: "ready",
        generationProgress: 25,
        generationStep: "Generando el contenido de tus lecciones…",
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    // --- PASO 2: rellenar contenido por módulo EN ORDEN (prioriza los primeros);
    //     lecciones del módulo en paralelo. Cada lección queda lista al instante. ---
    let done = 0;
    let firstModuleEmailSent = false;
    // Un mismo video de YouTube no se repite entre lecciones de la ruta.
    const usedVideoIds = new Set<string>();
    const emitProgress = async (step: string) => {
      const pct =
        totalLessons > 0 ? 25 + Math.round((done / totalLessons) * 70) : 25;
      await db
        .update(learningPaths)
        .set({ generationProgress: pct, generationStep: step, updatedAt: new Date() })
        .where(eq(learningPaths.id, pathId));
    };

    for (const [mi, { m, lessons }] of plan.entries()) {
      // STAGE A — queries de video del módulo entero en 1 llamada Haiku
      // (desde los STUBS: el video se elige ANTES de escribir la lección).
      let queryByIndex = new Map<number, string>();
      try {
        const q = await generateVideoQueries({
          routeTitle: skeleton.title,
          moduleTitle: m.title,
          moduleObjective: m.objective,
          lessons: lessons.map(({ ls }, i) => ({
            index: i,
            title: ls.title,
            summary: ls.summary,
          })),
          language: intake.language,
        });
        queryByIndex = new Map(q.queries.map((x) => [x.lessonIndex, x.query]));
      } catch (e) {
        console.error(`[generation] queries de video fallaron (módulo ${m.title}):`, e);
      }

      await Promise.all(
        lessons.map(async ({ id: lessonId, ls }, li) => {
          // CACHÉ DE CONTENIDO: si otro usuario del mismo esqueleto ya pagó
          // esta lección, se reutiliza entera (contenido + quiz) — la ruta
          // repetida cuesta ~$0 y se genera en segundos.
          const [cachedLesson] = await db
            .select()
            .from(lessonContentCache)
            .where(
              and(
                eq(lessonContentCache.cacheKey, cacheKey),
                eq(lessonContentCache.moduleIndex, mi),
                eq(lessonContentCache.lessonIndex, li),
                eq(lessonContentCache.version, 1),
              ),
            )
            .limit(1);
          if (cachedLesson) {
            const cachedContent = cachedLesson.content as LessonContent;
            // VIDEO FIJADO: el canónico ya pasó el coverage gate y la
            // videoGuide le pertenece. Re-consultamos metadatos FRESCOS
            // (videos.list, 1 unidad) para cumplir los 30 días; si el video
            // murió, recién ahí re-curamos desde cero.
            const pinVideos = async () => {
              const ids = (cachedLesson.videoIds as string[] | null) ?? [];
              if (ids.length) {
                const fresh = await getVideoDetails(ids);
                const byId = new Map(fresh.map((f) => [f.videoId, f]));
                const alive = ids.filter((id) => byId.has(id));
                if (alive.length && byId.has(ids[0]!)) {
                  for (const id of alive) usedVideoIds.add(id);
                  await db
                    .insert(videoCandidates)
                    .values(
                      alive.map((id, rank) => {
                        const f = byId.get(id)!;
                        return {
                          lessonId,
                          youtubeVideoId: id,
                          title: f.title,
                          channelTitle: f.channelTitle,
                          rank,
                          language: f.defaultLanguage ?? intake.language,
                          durationSeconds: f.durationSeconds,
                          reason: "canónico verificado (cache)",
                          lastCheckedAt: new Date(),
                        };
                      }),
                    )
                    .onConflictDoNothing();
                  return;
                }
              }
              // Sin videos fijados o el principal murió → curación normal.
              const vids = await curateAndSaveVideo(
                lessonId,
                queryByIndex.get(li) ?? ls.title,
                m.objective,
                intake.language,
                skeleton.title,
                usedVideoIds,
              );
              for (const v of vids) usedVideoIds.add(v.videoId);
            };

            await Promise.all([
              db
                .update(lessonsT)
                .set({
                  content: cachedContent,
                  notes: cachedContent.keyTakeaways.join("\n• "),
                })
                .where(eq(lessonsT.id, lessonId)),
              pinVideos().catch((e) =>
                console.error(`[generation] pin de video falló:`, e),
              ),
              cachedLesson.quiz
                ? saveQuizData(lessonId, ls.title, cachedLesson.quiz as GeneratedQuizData).catch(
                    (e) => console.error(`[generation] quiz cacheado falló:`, e),
                  )
                : Promise.resolve(),
              db
                .update(lessonContentCache)
                .set({
                  timesReused: sql`${lessonContentCache.timesReused} + 1`,
                  updatedAt: new Date(),
                })
                .where(eq(lessonContentCache.id, cachedLesson.id)),
            ]);
            done++;
            await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
            return;
          }

          // STAGE B — curar video + digest del top-1 (con coverage gate).
          const query = queryByIndex.get(li) ?? ls.title;
          const vids = await curateAndSaveVideo(
            lessonId,
            query,
            m.objective,
            intake.language,
            skeleton.title,
            usedVideoIds,
          );
          for (const v of vids) usedVideoIds.add(v.videoId);
          let topVideo = vids[0] ?? null;
          let digest: VideoDigest | null = null;
          if (topVideo) {
            try {
              // El contexto de la RUTA viaja al coverage: un video del tema
              // correcto pero del medio equivocado (DSLR vs celular) puntúa bajo.
              const coverageSummary = `${ls.summary} (contexto de la ruta: ${skeleton.title})`;
              let ins = await getVideoInsights({
                videoId: topVideo.videoId,
                lessonSummary: coverageSummary,
                language: intake.language,
                durationSeconds: topVideo.durationSeconds ?? null,
              });
              // Coverage gate: si el video no cubre la lección, prueba el #2
              // (cap 2 digests/lección) y gana el de mejor cobertura real.
              const alt = vids[1];
              if (ins && ins.digest.coverage < 0.5 && alt) {
                const altIns = await getVideoInsights({
                  videoId: alt.videoId,
                  lessonSummary: coverageSummary,
                  language: intake.language,
                  durationSeconds: alt.durationSeconds ?? null,
                });
                if (altIns && altIns.digest.coverage > ins.digest.coverage) {
                  ins = altIns;
                  topVideo = alt;
                  await swapVideoRanks(lessonId, alt.videoId).catch((e) =>
                    console.error(`[generation] swap de rank falló:`, e),
                  );
                }
              }
              // PISO DE COVERAGE: si ni el mejor candidato trata de lo que la
              // lección necesita, mejor SIN video principal que uno irrelevante
              // (caso real: video de ansiedad en ruta de fotografía).
              if (ins && ins.digest.coverage < 0.35) {
                await db
                  .update(videoCandidates)
                  .set({ isActive: false })
                  .where(
                    and(
                      eq(videoCandidates.lessonId, lessonId),
                      eq(videoCandidates.youtubeVideoId, topVideo.videoId),
                    ),
                  )
                  .catch(() => {});
                topVideo = null;
                ins = null;
              }
              digest = ins?.digest ?? null;
            } catch (e) {
              console.error(`[generation] digest falló (lección ${lessonId}):`, e);
            }
          }

          // STAGE C — lección ANCLADA al video (una sola llamada Sonnet).
          const content = await generateLessonContent({
            pathTitle: skeleton.title,
            moduleTitle: m.title,
            moduleObjective: m.objective,
            lessonTitle: ls.title,
            lessonSummary: ls.summary,
            level: skeleton.level,
            language: intake.language,
            videoDigest: digest,
          });
          await db
            .update(lessonsT)
            .set({ content, notes: content.keyTakeaways.join("\n• ") })
            .where(eq(lessonsT.id, lessonId));

          // STAGE D — quiz DESPUÉS de la lección, grounded en contenido + anclas.
          const quizData = await generateAndSaveQuiz(
            lessonId,
            ls.title,
            ls.summary,
            skeleton.level,
            intake.language,
            content,
            digest,
            topVideo?.durationSeconds ?? null,
          ).catch((e) => {
            console.error(`[generation] quiz falló (lección ${lessonId}):`, e);
            return null;
          });

          // Cachear el canónico: los siguientes usuarios del esqueleto reciben
          // esta lección (y su quiz) gratis y al instante.
          // Orden final de videos: el verificado por coverage primero.
          const finalVideoIds = topVideo
            ? [topVideo.videoId, ...vids.filter((v) => v.videoId !== topVideo!.videoId).map((v) => v.videoId)]
            : vids.map((v) => v.videoId);
          await db
            .insert(lessonContentCache)
            .values({
              cacheKey,
              moduleIndex: mi,
              lessonIndex: li,
              content,
              quiz: quizData,
              videoIds: finalVideoIds,
            })
            .onConflictDoNothing({
              target: [
                lessonContentCache.cacheKey,
                lessonContentCache.moduleIndex,
                lessonContentCache.lessonIndex,
                lessonContentCache.version,
              ],
            })
            .catch((e) =>
              console.error(`[generation] cache de lección falló:`, e),
            );

          done++;
          await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
        }),
      );

      // El PRIMER módulo con contenido completo → correo "tu ruta está lista,
      // empieza por aquí" (uno solo por ruta; dedupe por moduleId).
      const firstPlan = plan[0];
      if (!firstModuleEmailSent && firstPlan && firstPlan.lessons.length) {
        firstModuleEmailSent = true;
        const [firstModule] = await db
          .select({ id: modulesT.id })
          .from(modulesT)
          .where(and(eq(modulesT.pathId, pathId), eq(modulesT.orderIndex, 0)))
          .limit(1);
        if (firstModule) {
          const { enqueueProgressEmail } = await import("@/lib/email/enqueue");
          await enqueueProgressEmail(path.userId, "module_ready", firstModule.id, {
            pathId,
            pathTitle: skeleton.title,
            moduleId: firstModule.id,
            moduleTitle: firstPlan.m.title,
            lessonTitles: firstPlan.m.lessons.map((l) => l.title),
            language: intake.language,
          });
        }
      }
    }

    // Contenido completo (la ruta ya estaba 'ready' desde el Paso 1).
    await db
      .update(learningPaths)
      .set({ generationProgress: 100, generationStep: "Completo", updatedAt: new Date() })
      .where(eq(learningPaths.id, pathId));
  } catch (err) {
    console.error(`[generation] Falló la ruta ${pathId}:`, err);
    // Si la estructura ya existe (status ready), no la marcamos failed: el usuario
    // puede usar lo generado y un reintento rellena lo que falte (idempotente).
    const [p] = await db
      .select({ status: learningPaths.status })
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId))
      .limit(1);
    if (p && p.status !== "ready") {
      await db
        .update(learningPaths)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(learningPaths.id, pathId));
    }
    throw err;
  }
}

/** Inserta un quiz (generado o cacheado) en una transacción idempotente. */
export async function saveQuizData(
  lessonId: string,
  title: string,
  quiz: GeneratedQuizData,
) {
  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  await db.transaction(async (tx) => {
    const [qz] = await tx
      .insert(quizzesT)
      .values({ lessonId, title: `Quiz: ${title}` })
      .onConflictDoUpdate({
        target: quizzesT.lessonId,
        set: { title: `Quiz: ${title}` },
      })
      .returning();
    if (qz && quiz.questions.length) {
      await tx.delete(questionsT).where(eq(questionsT.quizId, qz.id));
      await tx.insert(questionsT).values(
        quiz.questions.map((q, qi) => ({
          quizId: qz.id,
          orderIndex: qi,
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correctOptionIds,
          // El grounding validado viaja en la explicación (visible al corregir).
          explanation:
            q.grounding?.timestampSeconds != null
              ? `${q.explanation} ⏱ El video lo explica en ${mmss(q.grounding.timestampSeconds)}.`
              : q.explanation,
        })),
      );
    }
  });
}

/** Genera y guarda el quiz de una lección (devuelve el quiz para cachearlo).
 *  Corre DESPUÉS de la lección: recibe contenido final + digest del video para
 *  que las preguntas evalúen lo que el estudiante realmente vio y leyó. */
export async function generateAndSaveQuiz(
  lessonId: string,
  title: string,
  summary: string,
  level: string,
  language: string,
  lessonContent?: LessonContent | null,
  videoDigest?: VideoDigest | null,
  videoDurationSeconds?: number | null,
): Promise<GeneratedQuizData> {
  const quiz = await generateQuiz({
    lessonTitle: title,
    lessonSummary: summary,
    level,
    language,
    lessonContent,
    videoDigest,
    videoDurationSeconds,
  });
  await saveQuizData(lessonId, title, quiz);
  return quiz;
}

/** Cura y guarda videos de una lección (idempotente; nunca aborta la ruta).
 *  Devuelve los candidatos curados (rank asc) para el digest/coverage gate. */
export async function curateAndSaveVideo(
  lessonId: string,
  query: string,
  objective: string,
  language: string,
  routeTopic?: string,
  excludeVideoIds?: Set<string>,
): Promise<Awaited<ReturnType<typeof curateVideoForLesson>>> {
  try {
    const vids = await curateVideoForLesson({
      query,
      objective,
      language,
      routeTopic,
      excludeVideoIds,
    });
    if (vids.length) {
      await db
        .insert(videoCandidates)
        .values(
          vids.map((v) => ({
            lessonId,
            youtubeVideoId: v.videoId,
            title: v.title,
            channelTitle: v.channelTitle,
            rank: v.rank,
            score: v.score,
            language: v.language,
            durationSeconds: v.durationSeconds,
            reason: v.reason,
            lastCheckedAt: new Date(), // cumplimiento: marca temporal de frescura
          })),
        )
        .onConflictDoNothing();
    }
    return vids;
  } catch (err) {
    console.error(`[generation] Curación de video falló (lección ${lessonId}):`, err);
    return [];
  }
}

/** Promueve a rank 0 el video que ganó el coverage gate (swap seguro con el
 *  índice único lesson+rank: 0→99, ganador→0, 99→1). */
async function swapVideoRanks(lessonId: string, winnerVideoId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(videoCandidates)
      .set({ rank: 99 })
      .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.rank, 0)));
    await tx
      .update(videoCandidates)
      .set({ rank: 0 })
      .where(
        and(
          eq(videoCandidates.lessonId, lessonId),
          eq(videoCandidates.youtubeVideoId, winnerVideoId),
        ),
      );
    await tx
      .update(videoCandidates)
      .set({ rank: 1 })
      .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.rank, 99)));
  });
}

/**
 * Re-ancla UNA lección ya generada: digest del video (con coverage gate sobre
 * el candidato #2) → regenera el contenido anclado → regenera el quiz grounded.
 * Para backfills de rutas generadas sin digest (p.ej. cuota de Gemini agotada).
 */
export async function reanchorLesson(lessonId: string): Promise<string> {
  const [row] = await db
    .select({
      lessonTitle: lessonsT.title,
      moduleTitle: modulesT.title,
      moduleObjective: modulesT.objective,
      pathTitle: learningPaths.title,
      level: learningPaths.level,
      language: learningPaths.language,
    })
    .from(lessonsT)
    .innerJoin(modulesT, eq(modulesT.id, lessonsT.moduleId))
    .innerJoin(learningPaths, eq(learningPaths.id, modulesT.pathId))
    .where(eq(lessonsT.id, lessonId))
    .limit(1);
  if (!row) return "lección no encontrada";

  const vids = await db
    .select()
    .from(videoCandidates)
    .where(and(eq(videoCandidates.lessonId, lessonId), eq(videoCandidates.isActive, true)))
    .orderBy(videoCandidates.rank)
    .limit(2);
  if (!vids.length) return "sin video";

  const summary = `${row.lessonTitle} (contexto de la ruta: ${row.pathTitle})`;
  let top = vids[0]!;
  let ins = await getVideoInsights({
    videoId: top.youtubeVideoId,
    lessonSummary: summary,
    language: row.language,
    durationSeconds: top.durationSeconds ?? null,
  });
  const alt = vids[1];
  if (ins && ins.digest.coverage < 0.5 && alt) {
    const altIns = await getVideoInsights({
      videoId: alt.youtubeVideoId,
      lessonSummary: summary,
      language: row.language,
      durationSeconds: alt.durationSeconds ?? null,
    });
    if (altIns && altIns.digest.coverage > ins.digest.coverage) {
      ins = altIns;
      top = alt;
      await swapVideoRanks(lessonId, alt.youtubeVideoId).catch(() => {});
    }
  }
  if (!ins) return "digest no disponible";

  const content = await generateLessonContent({
    pathTitle: row.pathTitle,
    moduleTitle: row.moduleTitle,
    moduleObjective: row.moduleObjective ?? "",
    lessonTitle: row.lessonTitle,
    lessonSummary: row.lessonTitle,
    level: row.level,
    language: row.language,
    videoDigest: ins.digest,
  });
  await db
    .update(lessonsT)
    .set({ content, notes: content.keyTakeaways.join("\n• ") })
    .where(eq(lessonsT.id, lessonId));

  await generateAndSaveQuiz(
    lessonId,
    row.lessonTitle,
    row.lessonTitle,
    row.level,
    row.language,
    content,
    ins.digest,
    top.durationSeconds ?? null,
  );
  return `anclada (coverage ${ins.digest.coverage.toFixed(2)}, video ${top.youtubeVideoId})`;
}

/**
 * Encola la generación.
 * - Producción: Trigger.dev (sin límite de tiempo). Obligatorio.
 * - Dev (`next dev`): corre inline (el proceso de Node persiste, no hay timeout).
 * - Serverless sin Trigger: se rechaza (el `void` moriría al responder la acción).
 */
export async function enqueuePathGeneration(pathId: string): Promise<void> {
  if (env.TRIGGER_SECRET_KEY) {
    const { tasks } = await import("@trigger.dev/sdk");
    await tasks.trigger("generate-path", { pathId });
  } else if (env.NODE_ENV !== "production") {
    // Solo dev: en `next dev` el proceso sigue vivo tras responder la acción.
    void runPathGeneration(pathId).catch((e) =>
      console.error("[generation] inline (dev) falló:", e),
    );
  } else {
    throw new Error(
      "[config] En producción se requiere TRIGGER_SECRET_KEY: no hay modo inline seguro en serverless.",
    );
  }
}
