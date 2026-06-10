import { and, countDistinct, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  progress,
  lessons,
  modules,
  quizAttempts,
  xpEvents,
  achievements,
  userAchievements,
  type Achievement,
} from "@/db/schema";

/*
  Motor de gamificación de Aulia.
  Principios (ver docs/engagement-y-correos-plan.md):
  - XP por DOMINIO (lección, quiz, módulo, ruta), nunca por tiempo (evita
    erosionar la motivación intrínseca — Deci & Ryan).
  - Idempotencia real: el ledger xp_events tiene UNIQUE(user, source, ref);
    recompletar/reaprobar no duplica XP aunque la action se reintente.
  - La racha SIEMPRE tiene válvula de escape (streak freeze) — un día perdido
    se perdona automáticamente si quedan freezes.
  - Todas las escrituras corren dentro de la transacción del caller.
*/

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------- XP por evento ----------
export const XP = {
  lesson_completed: 10,
  quiz_passed: 25,
  quiz_perfect: 15, // bono sobre quiz_passed cuando el score es 100%
  module_completed: 50,
  path_completed: 200,
} as const;

// Curva de nivel cuadrática suave: nivel 2 a 100 XP, 3 a 400, 4 a 900, 5 a 1600…
export function levelForXp(totalXp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, totalXp) / 100)) + 1;
}
/** XP total necesario para alcanzar un nivel (inicio del nivel). */
export function xpForLevel(level: number): number {
  return Math.max(0, level - 1) ** 2 * 100;
}

// ---------- Fechas en la zona horaria del usuario ----------
const DEFAULT_TZ = "America/Santiago";

/** YYYY-MM-DD de "hoy" en la zona horaria dada (en-CA formatea ISO). */
export function todayInTz(tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Lunes (YYYY-MM-DD) de la semana del día dado — ancla de XP semanal/ligas. */
export function mondayOf(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  const sinceMonday = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - sinceMonday);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ---------- Resultado que consumen las server actions / UI ----------
export interface GamificationResult {
  xpGained: number;
  totalXp: number;
  level: number;
  /** Nivel nuevo si esta acción subió de nivel; null si no. */
  levelUp: number | null;
  streak: number;
  /** true si hoy extendió la racha (primer evento del día). */
  streakExtended: boolean;
  /** true si un freeze perdonó un día perdido en esta actualización. */
  usedFreeze: boolean;
  newAchievements: Pick<Achievement, "code" | "title" | "description" | "icon" | "xpReward">[];
  moduleCompleted: { id: string; title: string } | null;
  pathCompleted: { id: string; title: string } | null;
}

// ---------- Primitivas ----------

/** Inserta en el ledger; devuelve los puntos si el evento es nuevo, 0 si ya existía. */
async function awardXp(
  tx: Tx,
  userId: string,
  source: (typeof xpEvents.$inferInsert)["source"],
  refId: string,
  points: number,
  weekStart: string,
): Promise<number> {
  const inserted = await tx
    .insert(xpEvents)
    .values({ userId, source, refId, points, weekStart })
    .onConflictDoNothing({
      target: [xpEvents.userId, xpEvents.source, xpEvents.refId],
    })
    .returning({ id: xpEvents.id });
  return inserted.length ? points : 0;
}

/** Actualiza la racha del usuario (con freeze automático). Devuelve el estado. */
async function touchStreak(
  tx: Tx,
  userId: string,
  today: string,
): Promise<{ streak: number; extended: boolean; usedFreeze: boolean }> {
  // Lock de la fila del perfil: serializa rachas/XP del mismo usuario.
  const [p] = await tx
    .select({
      currentStreak: profiles.currentStreak,
      longestStreak: profiles.longestStreak,
      lastActiveDay: profiles.lastActiveDay,
      streakFreezes: profiles.streakFreezes,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("update");
  if (!p) return { streak: 0, extended: false, usedFreeze: false };

  if (p.lastActiveDay === today) {
    return { streak: p.currentStreak, extended: false, usedFreeze: false };
  }

  let streak: number;
  let usedFreeze = false;
  const gap = p.lastActiveDay ? daysBetween(p.lastActiveDay, today) : Infinity;

  if (gap === 1) {
    streak = p.currentStreak + 1; // día consecutivo
  } else if (gap === 2 && p.streakFreezes > 0) {
    streak = p.currentStreak + 1; // un día perdido, lo cubre el freeze
    usedFreeze = true;
  } else {
    streak = 1; // racha nueva (primer día o hueco sin freeze)
  }

  await tx
    .update(profiles)
    .set({
      currentStreak: streak,
      longestStreak: sql`greatest(${profiles.longestStreak}, ${streak})`,
      lastActiveDay: today,
      ...(usedFreeze
        ? { streakFreezes: sql`greatest(${profiles.streakFreezes} - 1, 0)` }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, userId));

  return { streak, extended: true, usedFreeze };
}

/** Detecta si, con la lección dada completada, se cerró el módulo y/o la ruta. */
async function detectMilestones(
  tx: Tx,
  userId: string,
  pathId: string,
  moduleId: string,
): Promise<{ moduleDone: boolean; pathDone: boolean }> {
  const [mod] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
    })
    .from(lessons)
    .leftJoin(
      progress,
      and(eq(progress.lessonId, lessons.id), eq(progress.userId, userId)),
    )
    .where(eq(lessons.moduleId, moduleId));

  const [path] = await tx
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

  return {
    moduleDone: !!mod && mod.total > 0 && mod.done >= mod.total,
    pathDone: !!path && path.total > 0 && path.done >= path.total,
  };
}

/** Evalúa el catálogo de logros contra los contadores reales y desbloquea. */
async function evaluateAchievements(
  tx: Tx,
  userId: string,
  weekStart: string,
  streak: number,
): Promise<{ xp: number; unlocked: GamificationResult["newAchievements"] }> {
  const [counters] = await tx
    .select({
      lessonsDone: sql<number>`count(*) filter (where ${progress.status} = 'completed')::int`,
      distinctPaths: countDistinct(
        sql`case when ${progress.status} = 'completed' then ${progress.pathId} end`,
      ),
    })
    .from(progress)
    .where(eq(progress.userId, userId));

  const [quizCounters] = await tx
    .select({
      passed: countDistinct(
        sql`case when ${quizAttempts.passed} then ${quizAttempts.quizId} end`,
      ),
    })
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, userId));

  // Hitos y "perfecto" desde el ledger: ya deduplicados e idempotentes
  // (quiz_perfect solo se emite cuando el quiz completo era verificable).
  const [milestones] = await tx
    .select({
      modulesDone: sql<number>`count(*) filter (where ${xpEvents.source} = 'module_completed')::int`,
      pathsDone: sql<number>`count(*) filter (where ${xpEvents.source} = 'path_completed')::int`,
      perfect: sql<number>`count(*) filter (where ${xpEvents.source} = 'quiz_perfect')::int`,
    })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId));

  const meets: Record<string, boolean> = {
    first_lesson: (counters?.lessonsDone ?? 0) >= 1,
    first_module: (milestones?.modulesDone ?? 0) >= 1,
    first_path: (milestones?.pathsDone ?? 0) >= 1,
    five_quizzes: Number(quizCounters?.passed ?? 0) >= 5,
    perfect_quiz: (milestones?.perfect ?? 0) >= 1,
    streak_7: streak >= 7,
    streak_30: streak >= 30,
    polymath: Number(counters?.distinctPaths ?? 0) >= 2,
  };

  const catalog = await tx.select().from(achievements);
  let xp = 0;
  const unlocked: GamificationResult["newAchievements"] = [];

  for (const a of catalog) {
    if (!meets[a.code]) continue;
    const inserted = await tx
      .insert(userAchievements)
      .values({ userId, achievementId: a.id })
      .onConflictDoNothing({
        target: [userAchievements.userId, userAchievements.achievementId],
      })
      .returning({ id: userAchievements.id });
    if (!inserted.length) continue; // ya lo tenía
    unlocked.push({
      code: a.code,
      title: a.title,
      description: a.description,
      icon: a.icon,
      xpReward: a.xpReward,
    });
    if (a.xpReward > 0) {
      xp += await awardXp(tx, userId, "achievement", a.id, a.xpReward, weekStart);
    }
  }
  return { xp, unlocked };
}

/** Aplica el XP ganado al perfil y recalcula nivel. */
async function applyXpToProfile(
  tx: Tx,
  userId: string,
  gained: number,
): Promise<{ totalXp: number; level: number; levelUp: number | null }> {
  const [before] = await tx
    .select({ totalXp: profiles.totalXp, level: profiles.level })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("update"); // lock: dos completions concurrentes no pisan el nivel
  const prevLevel = before?.level ?? 1;

  if (gained <= 0) {
    return { totalXp: before?.totalXp ?? 0, level: prevLevel, levelUp: null };
  }

  const [after] = await tx
    .update(profiles)
    .set({ totalXp: sql`${profiles.totalXp} + ${gained}`, updatedAt: new Date() })
    .where(eq(profiles.id, userId))
    .returning({ totalXp: profiles.totalXp });

  const totalXp = after?.totalXp ?? gained;
  const level = levelForXp(totalXp);
  if (level !== prevLevel) {
    await tx
      .update(profiles)
      .set({ level, updatedAt: new Date() })
      .where(eq(profiles.id, userId));
  }
  return { totalXp, level, levelUp: level > prevLevel ? level : null };
}

// ---------- Orquestadores (la API que usan las server actions) ----------

export interface LessonCompletionInput {
  userId: string;
  pathId: string;
  pathTitle: string;
  moduleId: string;
  moduleTitle: string;
  lessonId: string;
  /** Zona horaria del usuario para el corte de día de la racha. */
  timezone?: string;
  /** XP extra ya ganado en esta misma acción (p.ej. quiz aprobado). */
  extraXp?: number;
}

/**
 * Procesa la completitud de una lección dentro de una transacción:
 * progreso → racha → XP → hitos (módulo/ruta) → logros → perfil.
 * Idempotente de punta a punta: repetirla no duplica nada.
 */
export async function processLessonCompletion(
  tx: Tx,
  input: LessonCompletionInput,
): Promise<GamificationResult> {
  const today = todayInTz(input.timezone);
  const weekStart = mondayOf(today);

  // 1) Progreso (upsert sobre el índice único user+lesson).
  await tx
    .insert(progress)
    .values({
      userId: input.userId,
      pathId: input.pathId,
      lessonId: input.lessonId,
      status: "completed",
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.lessonId],
      set: {
        status: "completed",
        // Conserva la fecha original de la primera completación.
        completedAt: sql`coalesce(${progress.completedAt}, now())`,
        updatedAt: new Date(),
      },
    });

  // 2) Racha (con freeze automático).
  const streakState = await touchStreak(tx, input.userId, today);

  // 3) XP de la lección (0 si ya la había completado antes).
  let gained = input.extraXp ?? 0;
  gained += await awardXp(
    tx,
    input.userId,
    "lesson_completed",
    input.lessonId,
    XP.lesson_completed,
    weekStart,
  );

  // 4) Hitos: ¿se cerró el módulo? ¿la ruta?
  const { moduleDone, pathDone } = await detectMilestones(
    tx,
    input.userId,
    input.pathId,
    input.moduleId,
  );
  let moduleCompleted: GamificationResult["moduleCompleted"] = null;
  let pathCompleted: GamificationResult["pathCompleted"] = null;

  if (moduleDone) {
    const pts = await awardXp(
      tx,
      input.userId,
      "module_completed",
      input.moduleId,
      XP.module_completed,
      weekStart,
    );
    gained += pts;
    if (pts > 0) moduleCompleted = { id: input.moduleId, title: input.moduleTitle };
  }
  if (pathDone) {
    const pts = await awardXp(
      tx,
      input.userId,
      "path_completed",
      input.pathId,
      XP.path_completed,
      weekStart,
    );
    gained += pts;
    if (pts > 0) pathCompleted = { id: input.pathId, title: input.pathTitle };
  }

  // 5) Logros (idempotente vía UNIQUE).
  const ach = await evaluateAchievements(tx, input.userId, weekStart, streakState.streak);
  gained += ach.xp;

  // 6) Perfil (agregados).
  const prof = await applyXpToProfile(tx, input.userId, gained);

  return {
    xpGained: gained,
    totalXp: prof.totalXp,
    level: prof.level,
    levelUp: prof.levelUp,
    streak: streakState.streak,
    streakExtended: streakState.extended,
    usedFreeze: streakState.usedFreeze,
    newAchievements: ach.unlocked,
    moduleCompleted,
    pathCompleted,
  };
}

/**
 * XP del quiz (aprobar / perfecto). Devuelve los puntos ganados; el caller los
 * pasa como extraXp a processLessonCompletion para una sola pasada de perfil.
 * `perfectEligible` la decide el corrector: true solo si el 100% del quiz es
 * verificable (sin preguntas abiertas) y correcto.
 */
export async function awardQuizXp(
  tx: Tx,
  userId: string,
  quizId: string,
  score: number,
  perfectEligible: boolean,
  timezone?: string,
): Promise<number> {
  const weekStart = mondayOf(todayInTz(timezone));
  let gained = await awardXp(tx, userId, "quiz_passed", quizId, XP.quiz_passed, weekStart);
  if (score >= 1 && perfectEligible) {
    gained += await awardXp(tx, userId, "quiz_perfect", quizId, XP.quiz_perfect, weekStart);
  }
  return gained;
}
