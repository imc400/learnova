"use server";

import { asc, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { questions, quizAttempts, progress } from "@/db/schema";

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation: string;
}
export interface GradeResult {
  score: number;
  passed: boolean;
  results: QuestionResult[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/**
 * Corrige un cuestionario en el SERVIDOR (las respuestas correctas nunca llegan
 * al cliente). Registra el intento. Las preguntas abiertas se dan por válidas
 * en v1 (la corrección con Haiku es una mejora de fase 2).
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

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(asc(questions.orderIndex));

  let correctCount = 0;
  const results: QuestionResult[] = qs.map((q) => {
    const correctIds = (q.correctAnswer as string[] | null) ?? [];
    const selected = answers[q.id] ?? [];
    const correct =
      q.type === "open" ? true : sameSet(selected, correctIds);
    if (correct) correctCount++;
    return {
      questionId: q.id,
      correct,
      correctOptionIds: correctIds,
      explanation: q.explanation ?? "",
    };
  });

  const score = qs.length ? correctCount / qs.length : 0;
  const passed = score >= 0.6;

  await db.insert(quizAttempts).values({
    userId: user.id,
    quizId,
    answers,
    score,
    passed,
    feedback: results,
  });

  return { score, passed, results };
}

/** Marca una lección como completada (upsert sobre el índice único). */
export async function completeLessonAction(pathId: string, lessonId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  await db
    .insert(progress)
    .values({
      userId: user.id,
      pathId,
      lessonId,
      status: "completed",
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.lessonId],
      set: { status: "completed", completedAt: new Date(), updatedAt: new Date() },
    });
}
