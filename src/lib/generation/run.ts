import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  skeletonCache,
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
} from "@/lib/ai/generate";
import { curateVideoForLesson } from "@/lib/youtube/curate";
import type { Intake, PathSkeleton } from "@/lib/ai/schemas";
import { env } from "@/lib/env";

/**
 * Orquesta la generación completa de una ruta. Idempotente y tolerante a fallos:
 * - guard de status (no re-procesa una ruta ya 'ready')
 * - caché de "cabeza gruesa" (reusa esqueletos de temas populares → 0 Opus)
 * - upserts (sobrevive a reintentos de Trigger.dev sin duplicar)
 * - progreso real persistido por lección
 * - un quiz o un video que fallan NO abortan la ruta
 */
export async function runPathGeneration(pathId: string): Promise<void> {
  const [path] = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.id, pathId))
    .limit(1);
  if (!path) throw new Error(`Ruta ${pathId} no encontrada`);
  if (path.status === "ready") return; // idempotente: ya completada

  try {
    await db
      .update(learningPaths)
      .set({
        status: "generating",
        generationProgress: 2,
        generationStep: "Planificando tu currículum…",
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
    // Reusa el esqueleto canónico de temas populares en vez de llamar a Opus.
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

    await db
      .update(learningPaths)
      .set({
        title: skeleton.title,
        level: skeleton.level,
        estimatedHours: skeleton.estimatedHours,
        skeletonCacheKey: cacheKey,
        generationStep: `Estructurando ${skeleton.modules.length} módulos…`,
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));

    // --- Progreso real ---
    const totalLessons = skeleton.modules.reduce(
      (n, m) => n + m.lessons.length,
      0,
    );
    let done = 0;
    const emitProgress = async (step: string) => {
      const pct = totalLessons > 0 ? Math.round((done / totalLessons) * 90) : 0;
      await db
        .update(learningPaths)
        .set({ generationProgress: pct, generationStep: step, updatedAt: new Date() })
        .where(eq(learningPaths.id, pathId));
    };

    // --- NIVEL 2 + 3 (idempotente vía upsert) ---
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
        if (!lesson) continue;

        const content = await generateLessonContent({
          pathTitle: skeleton.title,
          moduleTitle: m.title,
          moduleObjective: m.objective,
          lessonTitle: ls.title,
          lessonSummary: ls.summary,
          level: skeleton.level,
          language: intake.language,
        });
        await db
          .update(lessonsT)
          .set({ content, notes: content.keyTakeaways.join("\n• ") })
          .where(eq(lessonsT.id, lesson.id));

        // Quiz y video en paralelo; ninguno aborta la ruta si falla.
        await Promise.all([
          generateAndSaveQuiz(
            lesson.id,
            ls.title,
            ls.summary,
            skeleton.level,
            intake.language,
          ).catch((e) =>
            console.error(`[generation] quiz falló (lección ${lesson.id}):`, e),
          ),
          curateAndSaveVideo(lesson.id, content.videoSearchQuery, m.objective, intake.language),
        ]);

        done++;
        await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
      }
    }

    await db
      .update(learningPaths)
      .set({
        status: "ready",
        generationProgress: 100,
        generationStep: "¡Listo!",
        updatedAt: new Date(),
      })
      .where(eq(learningPaths.id, pathId));
  } catch (err) {
    console.error(`[generation] Falló la ruta ${pathId}:`, err);
    await db
      .update(learningPaths)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(learningPaths.id, pathId));
    throw err;
  }
}

/** Genera y guarda el quiz de una lección en una transacción (idempotente). */
async function generateAndSaveQuiz(
  lessonId: string,
  title: string,
  summary: string,
  level: string,
  language: string,
) {
  const quiz = await generateQuiz({ lessonTitle: title, lessonSummary: summary, level, language });
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
          explanation: q.explanation,
        })),
      );
    }
  });
}

/** Cura y guarda videos de una lección (idempotente; nunca aborta la ruta). */
async function curateAndSaveVideo(
  lessonId: string,
  query: string,
  objective: string,
  language: string,
) {
  try {
    const vids = await curateVideoForLesson({ query, objective, language });
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
          })),
        )
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error(`[generation] Curación de video falló (lección ${lessonId}):`, err);
  }
}

/**
 * Encola la generación.
 * - Producción: Trigger.dev (sin límite de tiempo). Obligatorio.
 * - Dev (`next dev`): corre inline (el proceso de Node persiste, no hay timeout).
 * - Serverless sin Trigger: se rechaza (el `void` moriría al responder la acción).
 */
export async function enqueuePathGeneration(pathId: string): Promise<void> {
  if (env.TRIGGER_SECRET_KEY) {
    const { tasks } = await import("@trigger.dev/sdk/v3");
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
