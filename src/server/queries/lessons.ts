import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  lessons,
  modules,
  learningPaths,
  videoCandidates,
  quizzes,
  questions,
} from "@/db/schema";

/** Lección con su contexto (módulo + ruta), videos y quiz. Valida propiedad. */
export async function getLessonDetail(lessonId: string, userId: string) {
  const [row] = await db
    .select({ lesson: lessons, module: modules, path: learningPaths })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
    .where(and(eq(lessons.id, lessonId), eq(learningPaths.userId, userId)))
    .limit(1);
  if (!row) return null;

  const videos = await db
    .select()
    .from(videoCandidates)
    .where(
      and(
        eq(videoCandidates.lessonId, lessonId),
        eq(videoCandidates.isActive, true),
        // Cumplimiento YouTube: nunca servir metadatos sin verificar o con > 30 días.
        gt(videoCandidates.lastCheckedAt, sql`now() - interval '30 days'`),
      ),
    )
    .orderBy(asc(videoCandidates.rank));

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .limit(1);

  const quizQuestions = quiz
    ? await db
        .select()
        .from(questions)
        .where(eq(questions.quizId, quiz.id))
        .orderBy(asc(questions.orderIndex))
    : [];

  return {
    lesson: row.lesson,
    module: row.module,
    path: row.path,
    videos,
    quiz: quiz ? { ...quiz, questions: quizQuestions } : null,
  };
}
