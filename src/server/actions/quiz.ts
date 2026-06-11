"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  questions,
  quizzes,
  quizAttempts,
  lessons,
  modules,
  learningPaths,
  progress,
} from "@/db/schema";
import {
  awardQuizXp,
  processLessonCompletion,
  type GamificationResult,
} from "@/lib/gamification";
import { enqueueProgressEmail } from "@/lib/email/enqueue";
import { asc as ascOrder } from "drizzle-orm";

/**
 * Tras cerrar un módulo/ruta, encola el correo de celebración con los TÍTULOS
 * REALES de las lecciones (grounding anti-alucinación). Nunca lanza.
 */
async function emitMilestoneEmails(
  userId: string,
  g: GamificationResult,
  ctx: { pathId: string; pathTitle: string; language?: string },
  progressPct: number,
) {
  try {
    if (g.moduleCompleted) {
      const titles = await db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.moduleId, g.moduleCompleted.id))
        .orderBy(ascOrder(lessons.orderIndex));
      await enqueueProgressEmail(userId, "module_learned", g.moduleCompleted.id, {
        pathId: ctx.pathId,
        pathTitle: ctx.pathTitle,
        moduleId: g.moduleCompleted.id,
        moduleTitle: g.moduleCompleted.title,
        lessonTitles: titles.map((t) => t.title),
        progressPct,
        language: ctx.language,
      });
    }
    if (g.pathCompleted) {
      const titles = await db
        .select({ title: lessons.title })
        .from(lessons)
        .innerJoin(modules, eq(modules.id, lessons.moduleId))
        .where(eq(modules.pathId, ctx.pathId))
        .orderBy(ascOrder(modules.orderIndex), ascOrder(lessons.orderIndex));

      // "Siguiente paso": se genera AQUÍ (antes del outbox, que se encola una
      // sola vez) para que la card de la ruta y el correo cuenten lo mismo.
      const { getOrCreateNextPathSuggestion } = await import("@/lib/next-path");
      const suggestion = await getOrCreateNextPathSuggestion({
        userId,
        sourcePathId: ctx.pathId,
      });

      await enqueueProgressEmail(userId, "path_completed", ctx.pathId, {
        pathId: ctx.pathId,
        pathTitle: ctx.pathTitle,
        lessonTitles: titles.map((t) => t.title).slice(0, 8),
        progressPct: 100,
        language: ctx.language,
        // CTA primaria del correo → puente one-click (GET-seguro) con la
        // sugerencia congelada; las reasons van como bullets de venta.
        nextStep: suggestion
          ? {
              topic: suggestion.topic,
              url: `/app/rutas/${ctx.pathId}/siguiente?via=email`,
              reasons: suggestion.reasons,
            }
          : undefined,
      });
    }
  } catch (e) {
    console.error("[email] emitMilestoneEmails falló:", e);
  }
}

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation: string;
  /** Segundo del video donde se responde la pregunta (grounding del digest).
   *  Null si la pregunta se ancla solo al texto de la lección. */
  timestampSeconds: number | null;
}

/**
 * El grounding validado se persiste DENTRO de la explicación como sufijo
 * "⏱ El video lo explica en M:SS." (ver saveQuizData en lib/generation/run.ts).
 * Aquí se separa: el timestamp viaja estructurado al cliente (chip que hace
 * seek del video) y la explicación queda limpia. Plomería pura, sin IA.
 */
const GROUNDING_SUFFIX_RE = /\s*⏱\s*El video lo explica en (\d+):(\d{1,2})\.?\s*$/;

function splitGrounding(explanation: string): {
  text: string;
  timestampSeconds: number | null;
} {
  const m = explanation.match(GROUNDING_SUFFIX_RE);
  if (!m) return { text: explanation, timestampSeconds: null };
  return {
    text: explanation.slice(0, m.index).trim(),
    timestampSeconds: Number(m[1]) * 60 + Number(m[2]),
  };
}
export interface GradeResult {
  score: number;
  passed: boolean;
  results: QuestionResult[];
  /** Recompensas de esta acción (XP, racha, logros). Null si no aprobó. */
  gamification: GamificationResult | null;
  /**
   * Puente quiz trabado → clase en vivo (2+ intentos reprobados = traba real).
   * Calculado server-side; la elegibilidad FINAL la valida startClassAction
   * (gates de 40% y cupo — la UI solo refleja, jamás decide).
   * - "clase": puede iniciar la clase ahora (form → startClassAction).
   * - "planes": sin minutos en la ruta y no es Pro → /app/planes?source=quiz_trabado.
   * Null si aprobó, si lleva <2 intentos fallidos o si va bajo el 40% (el gate
   * pedagógico no se vende: ahí toca avanzar, no comprar).
   */
  classBridge: { pathId: string; cta: "clase" | "planes" } | null;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/** Lección+módulo+ruta del quiz, validando que la ruta sea del usuario. */
async function getQuizContext(quizId: string, userId: string) {
  const [row] = await db
    .select({
      lessonId: lessons.id,
      moduleId: modules.id,
      moduleTitle: modules.title,
      pathId: learningPaths.id,
      pathTitle: learningPaths.title,
      language: learningPaths.language,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
    .where(and(eq(quizzes.id, quizId), eq(learningPaths.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** % de avance real de la ruta (para el contexto del correo). */
async function pathProgressPct(userId: string, pathId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .leftJoin(
      progress,
      and(eq(progress.lessonId, lessons.id), eq(progress.userId, userId)),
    )
    .where(eq(modules.pathId, pathId));
  return row && row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
}

/**
 * Corrige un cuestionario en el SERVIDOR (las respuestas correctas nunca llegan
 * al cliente). Registra el intento y, si aprueba (>= 60%), auto-completa la
 * lección y otorga XP/racha/logros en UNA transacción idempotente.
 */
export async function gradeQuizAction(
  quizId: string,
  answers: Record<string, string[]>,
): Promise<GradeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  // Propiedad: el quiz debe pertenecer a una ruta del usuario.
  const ctx = await getQuizContext(quizId, user.id);
  if (!ctx) throw new Error("Quiz no encontrado");

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(asc(questions.orderIndex));

  // Sanitiza las respuestas: solo ids de preguntas reales, tamaño acotado.
  const safeAnswers: Record<string, string[]> = {};
  for (const q of qs) {
    const a = answers[q.id];
    if (Array.isArray(a)) {
      safeAnswers[q.id] = a.slice(0, 12).map((x) => String(x).slice(0, 2000));
    }
  }

  // Las preguntas 'open' no tienen corrección automática aún: NO entran al
  // score (ni a favor ni en contra). Cuentan como "respondidas" si traen
  // texto real, solo para feedback en la UI.
  const closed = qs.filter((q) => q.type !== "open");
  let correctClosed = 0;
  const results: QuestionResult[] = qs.map((q) => {
    const correctIds = (q.correctAnswer as string[] | null) ?? [];
    const selected = safeAnswers[q.id] ?? [];
    const correct =
      q.type === "open"
        ? (selected[0] ?? "").trim().length >= 20
        : sameSet(selected, correctIds);
    if (correct && q.type !== "open") correctClosed++;
    const grounded = splitGrounding(q.explanation ?? "");
    return {
      questionId: q.id,
      correct,
      correctOptionIds: correctIds,
      explanation: grounded.text,
      timestampSeconds: grounded.timestampSeconds,
    };
  });

  const allOpenAnswered = qs
    .filter((q) => q.type === "open")
    .every((q) => (safeAnswers[q.id]?.[0] ?? "").trim().length >= 20);

  // Score sobre las preguntas verificables; si TODO es open, exige respuesta
  // real para aprobar con el mínimo (sin posibilidad de "perfecto").
  const score = closed.length
    ? correctClosed / closed.length
    : allOpenAnswered && qs.length > 0
      ? 0.6
      : 0;
  const passed = score >= 0.6 && (closed.length > 0 || allOpenAnswered);
  // "Impecable" solo si el 100% del quiz es verificable y correcto.
  const perfectEligible = score >= 1 && closed.length === qs.length;

  const gamification = await db.transaction(async (tx) => {
    await tx.insert(quizAttempts).values({
      userId: user.id,
      quizId,
      answers: safeAnswers,
      score,
      passed,
      feedback: results,
    });
    if (!passed) return null;

    // Aprobar el quiz completa la lección: una sola pasada de XP/racha/hitos.
    const quizXp = await awardQuizXp(tx, user.id, quizId, score, perfectEligible);
    return processLessonCompletion(tx, {
      userId: user.id,
      pathId: ctx.pathId,
      pathTitle: ctx.pathTitle,
      moduleId: ctx.moduleId,
      moduleTitle: ctx.moduleTitle,
      lessonId: ctx.lessonId,
      extraXp: quizXp,
    });
  });

  // Hito cerrado → correo de celebración (fuera de la transacción; nunca rompe).
  if (gamification && (gamification.moduleCompleted || gamification.pathCompleted)) {
    const pct = await pathProgressPct(user.id, ctx.pathId);
    await emitMilestoneEmails(user.id, gamification, ctx, pct);
  }

  // Puente quiz trabado → clase (D-P1.5): con 2+ intentos reprobados, la
  // clase en vivo es la herramienta diseñada exactamente para destrabarse —
  // y el brief del profesor YA consume los quizzes fallados. Nunca lanza.
  let classBridge: GradeResult["classBridge"] = null;
  if (!passed) {
    try {
      const [fails] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.userId, user.id),
            eq(quizAttempts.quizId, quizId),
            eq(quizAttempts.passed, false),
          ),
        );
      if (Number(fails?.n ?? 0) >= 2) {
        const pct = await pathProgressPct(user.id, ctx.pathId);
        const { getEntitlement } = await import("@/lib/subscription");
        const { isPro } = await getEntitlement(user.id);
        // El gate pedagógico del 40% manda (no se vende un bypass): bajo el
        // 40% no hay puente. Pro salta ese gate server-side, así que sí ve CTA.
        if (isPro || pct >= 40) {
          // Minutos restantes de la ruta (lectura informativa; el cobro/cupo
          // REAL lo valida startClassAction al iniciar).
          const { liveSessions } = await import("@/db/schema");
          const [used] = await db
            .select({
              sec: sql<number>`coalesce(sum(${liveSessions.durationSec}) filter (where ${liveSessions.status} in ('completed', 'missed')), 0)::int`,
            })
            .from(liveSessions)
            .where(
              and(
                eq(liveSessions.userId, user.id),
                eq(liveSessions.pathId, ctx.pathId),
              ),
            );
          const usedMin = Math.ceil(Number(used?.sec ?? 0) / 60);
          const { env } = await import("@/lib/env");
          const routeLeft = env.CLASS_MINUTES_PER_ROUTE - usedMin;
          classBridge = {
            pathId: ctx.pathId,
            cta: !isPro && routeLeft <= 0 ? "planes" : "clase",
          };
        }
      }
    } catch (e) {
      console.error("[quiz] classBridge falló (no bloquea el resultado):", e);
    }
  }

  return { score, passed, results, gamification, classBridge };
}

/**
 * Marca una lección como completada (botón manual). Valida propiedad, deriva
 * módulo/ruta reales de la BD y otorga XP/racha/hitos transaccionalmente.
 */
export async function completeLessonAction(
  pathId: string,
  lessonId: string,
): Promise<GamificationResult | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  // Propiedad + contexto real (no confiamos en el pathId del cliente).
  const [ctx] = await db
    .select({
      lessonId: lessons.id,
      moduleId: modules.id,
      moduleTitle: modules.title,
      pathId: learningPaths.id,
      pathTitle: learningPaths.title,
      language: learningPaths.language,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
    .where(and(eq(lessons.id, lessonId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!ctx || ctx.pathId !== pathId) throw new Error("Lección no encontrada");

  // Gating de dominio: si la lección tiene quiz, completar SOLO aprobándolo
  // (gradeQuizAction auto-completa al aprobar). El botón manual es únicamente
  // para lecciones sin quiz; esto bloquea llamadas directas a la action.
  const [quizRow] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .limit(1);
  if (quizRow) {
    const [hasQuestions] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.quizId, quizRow.id))
      .limit(1);
    if (hasQuestions) {
      const [passed] = await db
        .select({ id: quizAttempts.id })
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.userId, user.id),
            eq(quizAttempts.quizId, quizRow.id),
            eq(quizAttempts.passed, true),
          ),
        )
        .limit(1);
      if (!passed) {
        throw new Error(
          "Esta lección se completa aprobando su quiz (60%+).",
        );
      }
    }
  }

  const result = await db.transaction(async (tx) =>
    processLessonCompletion(tx, {
      userId: user.id,
      pathId: ctx.pathId,
      pathTitle: ctx.pathTitle,
      moduleId: ctx.moduleId,
      moduleTitle: ctx.moduleTitle,
      lessonId: ctx.lessonId,
    }),
  );

  if (result.moduleCompleted || result.pathCompleted) {
    const pct = await pathProgressPct(user.id, ctx.pathId);
    await emitMilestoneEmails(user.id, result, ctx, pct);
  }
  return result;
}
