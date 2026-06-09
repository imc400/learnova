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
    const emitProgress = async (step: string) => {
      const pct =
        totalLessons > 0 ? 25 + Math.round((done / totalLessons) * 70) : 25;
      await db
        .update(learningPaths)
        .set({ generationProgress: pct, generationStep: step, updatedAt: new Date() })
        .where(eq(learningPaths.id, pathId));
    };

    for (const { m, lessons } of plan) {
      await Promise.all(
        lessons.map(async ({ id: lessonId, ls }) => {
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
            .where(eq(lessonsT.id, lessonId));

          // Quiz y video en paralelo; ninguno aborta la ruta si falla.
          await Promise.all([
            generateAndSaveQuiz(
              lessonId,
              ls.title,
              ls.summary,
              skeleton.level,
              intake.language,
            ).catch((e) =>
              console.error(`[generation] quiz falló (lección ${lessonId}):`, e),
            ),
            curateAndSaveVideo(lessonId, content.videoSearchQuery, m.objective, intake.language),
          ]);

          done++;
          await emitProgress(`Lección ${done}/${totalLessons}: ${ls.title}`);
        }),
      );
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
            lastCheckedAt: new Date(), // cumplimiento: marca temporal de frescura
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
