import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  learningPaths,
  modules,
  lessons,
  progress,
  quizAttempts,
  quizzes,
  profiles,
  homeworkItems,
  learnerProfiles,
} from "@/db/schema";

/*
  Brief pre-clase (300-500 tokens): TODO lo que el profesor debe saber ANTES de
  abrir la boca — para que demuestre memoria y pregunte menos. 100% derivado en
  el servidor de datos reales (jamás input del cliente → sin prompt injection).
*/

export interface ClassBrief {
  briefText: string;
  scriptedGreeting: string;
  studentFirstName: string;
}

export async function buildClassBrief(
  userId: string,
  pathId: string,
  teacherGreeting: string,
): Promise<ClassBrief> {
  const [[path], [prof], mods, attempts, pendingHw, [learner]] = await Promise.all([
    db
      .select({
        title: learningPaths.title,
        goal: learningPaths.goal,
        level: learningPaths.level,
        intake: learningPaths.intake,
      })
      .from(learningPaths)
      .where(eq(learningPaths.id, pathId))
      .limit(1),
    db
      .select({
        fullName: profiles.fullName,
        streak: profiles.currentStreak,
        totalXp: profiles.totalXp,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
    // Avance por módulo (completadas/total + títulos completados recientes).
    db
      .select({
        title: modules.title,
        orderIndex: modules.orderIndex,
        total: sql<number>`count(${lessons.id})::int`,
        done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
      })
      .from(modules)
      .innerJoin(lessons, eq(lessons.moduleId, modules.id))
      .leftJoin(
        progress,
        and(eq(progress.lessonId, lessons.id), eq(progress.userId, userId)),
      )
      .where(eq(modules.pathId, pathId))
      .groupBy(modules.id, modules.title, modules.orderIndex)
      .orderBy(modules.orderIndex),
    // Últimos intentos de quiz con errores concretos (la mina de oro).
    db
      .select({
        passed: quizAttempts.passed,
        score: quizAttempts.score,
        feedback: quizAttempts.feedback,
        quizTitle: quizzes.title,
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
      .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(and(eq(quizAttempts.userId, userId), eq(modules.pathId, pathId)))
      .orderBy(desc(quizAttempts.createdAt))
      .limit(5),
    db
      .select({ task: homeworkItems.task, done: homeworkItems.done })
      .from(homeworkItems)
      .where(
        and(
          eq(homeworkItems.userId, userId),
          eq(homeworkItems.pathId, pathId),
          eq(homeworkItems.done, false),
        ),
      )
      .limit(5),
    db
      .select({ profile: learnerProfiles.profile })
      .from(learnerProfiles)
      .where(and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.pathId, pathId)))
      .limit(1),
  ]);

  const firstName = (prof?.fullName ?? "").trim().split(" ")[0] || "estudiante";
  const doneMods = mods.filter((m) => m.done >= m.total && m.total > 0);
  const currentMod = mods.find((m) => m.done < m.total);
  const failedQuizzes = attempts.filter((a) => !a.passed);

  // Errores específicos: pregunta fallada → de qué quiz.
  const concreteErrors: string[] = [];
  for (const a of failedQuizzes.slice(0, 2)) {
    const fb = (a.feedback as { correct: boolean }[] | null) ?? [];
    const wrong = fb.filter((f) => !f.correct).length;
    if (wrong > 0) {
      concreteErrors.push(`falló ${wrong} pregunta(s) en "${a.quizTitle}" (score ${Math.round((a.score ?? 0) * 100)}%)`);
    }
  }

  const learnerNotes = learner?.profile
    ? JSON.stringify(learner.profile).slice(0, 400)
    : null;

  const briefText = [
    `BRIEF DEL ALUMNO (datos reales — tu memoria de él/ella):`,
    `- Nombre: ${firstName}. Meta personal: "${path?.goal ?? "—"}". Nivel: ${path?.level}.`,
    `- Avance: ${doneMods.length}/${mods.length} módulos completados${doneMods.length ? ` (${doneMods.map((m) => m.title).join("; ")})` : ""}.`,
    currentMod
      ? `- Módulo actual: "${currentMod.title}" (${currentMod.done}/${currentMod.total} lecciones).`
      : "- ¡Completó toda la ruta! La clase es de consolidación.",
    concreteErrors.length
      ? `- Trabas detectadas: ${concreteErrors.join("; ")}.`
      : attempts.length
        ? "- Sus quizzes recientes van aprobados."
        : "- Aún no rinde quizzes.",
    pendingHw.length
      ? `- Tareas pendientes de la clase anterior: ${pendingHw.map((h) => h.task).join(" | ")}`
      : "- Sin tareas pendientes (¿primera clase?).",
    prof?.streak ? `- Racha: ${prof.streak} días. XP: ${prof.totalXp}.` : "",
    learnerNotes ? `- Notas de clases anteriores: ${learnerNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Saludo guionizado: el primer turno demuestra memoria, no improvisa.
  const scriptedGreeting = pendingHw.length
    ? `¡Hola ${firstName}! ${teacherGreeting} La clase pasada te dejé ${pendingHw.length === 1 ? "una tarea" : `${pendingHw.length} tareas`} — cuéntame, ¿alcanzaste a hacer${pendingHw.length === 1 ? "la" : "las"}?`
    : currentMod
      ? `¡Hola ${firstName}! ${teacherGreeting} Vi que vas en "${currentMod.title}" — ¿cómo te has sentido con ese módulo?`
      : `¡Hola ${firstName}! ${teacherGreeting} ¡Completaste toda la ruta! Hoy vamos a consolidar lo más importante.`;

  return { briefText, scriptedGreeting, studentFirstName: firstName };
}
