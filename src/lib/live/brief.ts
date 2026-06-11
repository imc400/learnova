import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
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
  nextPathSuggestions,
  tutorConversations,
  tutorMessages,
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
  /** Tareas pendientes EN EL MISMO ORDEN que el brief las numera (1..N):
   *  la pizarra del aula y la tool marcar_tarea usan estos ids. */
  pendingHomework: { id: string; task: string }[];
}

/** Perfil del alumno (learner_profiles.profile) — lo escribe summarize.ts. */
interface LearnerProfileShape {
  lastClassAt?: string;
  lastHighlight?: string;
  recentStruggles?: string[];
  classCount?: number;
  lastExitTicket?: string;
  difficulty?: { direccion: "subir" | "bajar"; motivo: string };
}

export async function buildClassBrief(
  userId: string,
  pathId: string,
  teacherGreeting: string,
): Promise<ClassBrief> {
  const [[path], [prof], mods, attempts, pendingHw, doneHw, [learner], tutorQuestions] = await Promise.all([
    db
      .select({
        title: learningPaths.title,
        goal: learningPaths.goal,
        level: learningPaths.level,
        language: learningPaths.language,
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
    // PENDIENTES, numeradas: orden determinista (createdAt desc, id asc como
    // desempate — los inserts en lote comparten timestamp) para que el número
    // que dice el profesor calce con el de la pizarra y el de marcar_tarea.
    db
      .select({ id: homeworkItems.id, task: homeworkItems.task })
      .from(homeworkItems)
      .where(
        and(
          eq(homeworkItems.userId, userId),
          eq(homeworkItems.pathId, pathId),
          eq(homeworkItems.done, false),
        ),
      )
      .orderBy(desc(homeworkItems.createdAt), asc(homeworkItems.id))
      .limit(5),
    // COMPLETADAS desde la última clase (done y aún no celebradas): el
    // profesor las celebra con especificidad — el loop de tareas se cierra.
    db
      .select({ task: homeworkItems.task })
      .from(homeworkItems)
      .where(
        and(
          eq(homeworkItems.userId, userId),
          eq(homeworkItems.pathId, pathId),
          eq(homeworkItems.done, true),
          isNull(homeworkItems.reviewedInSessionId),
        ),
      )
      .orderBy(desc(homeworkItems.createdAt), asc(homeworkItems.id))
      .limit(3),
    db
      .select({ profile: learnerProfiles.profile })
      .from(learnerProfiles)
      .where(and(eq(learnerProfiles.userId, userId), eq(learnerProfiles.pathId, pathId)))
      .limit(1),
    // Puente texto→voz: lo que más preguntó al TUTOR DE TEXTO esta semana
    // (misma persona, otro canal). Solo mensajes del alumno, recientes.
    db
      .select({ content: tutorMessages.content })
      .from(tutorMessages)
      .innerJoin(
        tutorConversations,
        eq(tutorConversations.id, tutorMessages.conversationId),
      )
      .where(
        and(
          eq(tutorConversations.userId, userId),
          eq(tutorConversations.pathId, pathId),
          eq(tutorMessages.role, "user"),
          gt(tutorMessages.createdAt, sql`now() - interval '7 days'`),
        ),
      )
      .orderBy(desc(tutorMessages.createdAt))
      .limit(8),
  ]);

  const firstName = (prof?.fullName ?? "").trim().split(" ")[0] || "estudiante";
  const doneMods = mods.filter((m) => m.done >= m.total && m.total > 0);
  const currentMod = mods.find((m) => m.done < m.total);

  // Ruta completada → buscar la sugerencia de "Siguiente paso" para que el
  // profesor la presente en la clase de cierre (upsell pedagógico, no de vendedor).
  const [nextSuggestion] = !currentMod
    ? await db
        .select({
          topic: nextPathSuggestions.topic,
          reasons: nextPathSuggestions.reasons,
        })
        .from(nextPathSuggestions)
        .where(
          and(
            eq(nextPathSuggestions.sourcePathId, pathId),
            eq(nextPathSuggestions.userId, userId),
          ),
        )
        .limit(1)
    : [];
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

  // Memoria del profesor, renderizada LEGIBLE (jamás JSON crudo cortado):
  // el modelo cita mejor líneas en español que un blob serializado.
  const lp = (learner?.profile ?? null) as LearnerProfileShape | null;
  const memoryLines: string[] = [];
  if (lp) {
    if (lp.classCount) {
      memoryLines.push(
        `- Clases previas contigo: ${lp.classCount}${lp.lastClassAt ? ` (última: ${lp.lastClassAt.slice(0, 10)})` : ""}.`,
      );
    }
    if (lp.lastHighlight) memoryLines.push(`- Su último logro destacado: ${lp.lastHighlight}`);
    if (lp.recentStruggles?.length) {
      memoryLines.push(`- Trabas que arrastra de clases anteriores: ${lp.recentStruggles.join("; ")}.`);
    }
    if (lp.lastExitTicket) {
      memoryLines.push(`- Lo que dijo haber aprendido al cierre de la última clase: "${lp.lastExitTicket}".`);
    }
    if (lp.difficulty) {
      memoryLines.push(
        lp.difficulty.direccion === "bajar"
          ? `- PIDIÓ RITMO MÁS PAUSADO (${lp.difficulty.motivo}): usa más ejemplos y avanza de a poco.`
          : `- PIDIÓ MÁS DESAFÍO (${lp.difficulty.motivo}): sube el nivel y dale problemas más duros.`,
      );
    }
  }

  // Preguntas al tutor de texto, solo primeras líneas, presupuesto ~600 chars
  // (es color para la clase, no el plato principal del brief).
  const tutorTopics: string[] = [];
  let tutorTopicChars = 0;
  for (const q of tutorQuestions) {
    const line = (q.content.split("\n")[0] ?? "").trim().slice(0, 90);
    if (!line) continue;
    if (tutorTopicChars + line.length > 600) break;
    tutorTopicChars += line.length;
    tutorTopics.push(line);
  }

  // Módulos numerados desde 0: el índice exacto que espera `enfocar_modulo`
  // (sin esto el profesor adivina y enfoca el módulo equivocado).
  const moduleIndexLine = mods.length
    ? `- MÓDULOS (índice para enfocar_modulo): ${mods
        .map((m, i) => `${i}. "${m.title}" (${m.done}/${m.total})`)
        .join(" · ")}`
    : "";

  const briefText = [
    `BRIEF DEL ALUMNO (datos reales — tu memoria de él/ella):`,
    `- Nombre: ${firstName}. Meta personal: "${path?.goal ?? "—"}". Nivel: ${path?.level}.`,
    `- Avance: ${doneMods.length}/${mods.length} módulos completados${doneMods.length ? ` (${doneMods.map((m) => m.title).join("; ")})` : ""}.`,
    currentMod
      ? `- Módulo actual: "${currentMod.title}" (${currentMod.done}/${currentMod.total} lecciones).`
      : "- ¡COMPLETÓ TODA LA RUTA! Esta es la CLASE DE CIERRE: celebra su logro con detalles concretos, consolida lo esencial, y al final preséntale con entusiasmo su SIGUIENTE RUTA sugerida (abajo) como tu recomendación pedagógica — dile que la puede crear desde su pantalla al terminar.",
    moduleIndexLine,
    nextSuggestion
      ? `- SIGUIENTE RUTA SUGERIDA (para el cierre): "${nextSuggestion.topic}" — ${nextSuggestion.reasons.slice(0, 2).join("; ")}.`
      : "",
    concreteErrors.length
      ? `- Trabas detectadas: ${concreteErrors.join("; ")}.`
      : attempts.length
        ? "- Sus quizzes recientes van aprobados."
        : "- Aún no rinde quizzes.",
    doneHw.length
      ? `- TAREAS QUE COMPLETÓ desde la última clase (celébralas con especificidad, una por una): ${doneHw.map((h) => `"${h.task}"`).join(" | ")}`
      : "",
    pendingHw.length
      ? `- Tareas PENDIENTES (numeradas — usa marcar_tarea con este número cuando te cuente que hizo una): ${pendingHw
          .map((h, i) => `${i + 1}. ${h.task}`)
          .join(" | ")}`
      : doneHw.length
        ? "- Sin tareas pendientes: las hizo todas."
        : "- Sin tareas pendientes (¿primera clase?).",
    tutorTopics.length
      ? `- Temas que más preguntó al tutor de texto esta semana (eres tú por chat — retómalos si ayudan): ${tutorTopics.map((t) => `"${t}"`).join(" | ")}`
      : "",
    prof?.streak ? `- Racha: ${prof.streak} días. XP: ${prof.totalXp}.` : "",
    ...memoryLines,
  ]
    .filter(Boolean)
    .join("\n");

  // Saludo guionizado: el primer turno demuestra memoria, no improvisa.
  // Para rutas EN INGLÉS el saludo va en inglés (la clase ES en inglés —
  // el primer turno no puede contradecir la regla del prompt).
  const isEnglishRoute = (path?.language ?? "es").slice(0, 2) === "en";
  const scriptedGreeting = isEnglishRoute
    ? pendingHw.length
      ? `Hi ${firstName}, great to see you back! Last class I left you ${pendingHw.length === 1 ? "one task" : `${pendingHw.length} tasks`} — tell me, did you get to ${pendingHw.length === 1 ? "it" : "them"}?`
      : currentMod
        ? `Hi ${firstName}, great to see you! I saw you're working on "${currentMod.title}" — how has that module been going?`
        : `Hi ${firstName}! You finished the whole path — congratulations! Today we'll consolidate the essentials.`
    : pendingHw.length
      ? `¡Hola ${firstName}! ${teacherGreeting} La clase pasada te dejé ${pendingHw.length === 1 ? "una tarea" : `${pendingHw.length} tareas`} — cuéntame, ¿alcanzaste a hacer${pendingHw.length === 1 ? "la" : "las"}?`
      : currentMod
        ? `¡Hola ${firstName}! ${teacherGreeting} Vi que vas en "${currentMod.title}" — ¿cómo te has sentido con ese módulo?`
        : `¡Hola ${firstName}! ${teacherGreeting} ¡Completaste toda la ruta! Hoy vamos a consolidar lo más importante.`;

  return { briefText, scriptedGreeting, studentFirstName: firstName, pendingHomework: pendingHw };
}
