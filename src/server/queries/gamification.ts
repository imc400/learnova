import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, achievements, userAchievements } from "@/db/schema";
import { xpForLevel, todayInTz, daysBetween } from "@/lib/gamification";

/** Stats de gamificación del usuario para header/dashboard. */
export async function getUserStats(userId: string) {
  const [p] = await db
    .select({
      totalXp: profiles.totalXp,
      level: profiles.level,
      currentStreak: profiles.currentStreak,
      longestStreak: profiles.longestStreak,
      streakFreezes: profiles.streakFreezes,
      lastActiveDay: profiles.lastActiveDay,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!p) return null;

  // Racha EFECTIVA para mostrar: la almacenada solo se recalcula al completar
  // algo, así que aquí se decae en lectura para nunca mostrar una racha rota.
  // gap<=1: viva. gap==2 con freeze disponible: aún salvable (en riesgo).
  const gap = p.lastActiveDay
    ? daysBetween(p.lastActiveDay, todayInTz())
    : Infinity;
  const streakAlive = gap <= 1 || (gap === 2 && p.streakFreezes > 0);
  const effectiveStreak = streakAlive ? p.currentStreak : 0;

  // Progreso hacia el siguiente nivel (para la barra del header).
  const currentFloor = xpForLevel(p.level);
  const nextFloor = xpForLevel(p.level + 1);
  const levelProgress =
    nextFloor > currentFloor
      ? Math.min(
          100,
          Math.round(((p.totalXp - currentFloor) / (nextFloor - currentFloor)) * 100),
        )
      : 100;

  return {
    ...p,
    currentStreak: effectiveStreak,
    streakAtRisk: streakAlive && gap === 2,
    levelProgress,
    xpToNextLevel: Math.max(0, nextFloor - p.totalXp),
  };
}

/** Catálogo completo de logros + cuáles desbloqueó el usuario. */
export async function getUserAchievements(userId: string) {
  const [catalog, unlocked] = await Promise.all([
    db.select().from(achievements).orderBy(asc(achievements.createdAt)),
    db
      .select({
        achievementId: userAchievements.achievementId,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.unlockedAt)),
  ]);
  const unlockedMap = new Map(unlocked.map((u) => [u.achievementId, u.unlockedAt]));
  return catalog.map((a) => ({
    ...a,
    unlockedAt: unlockedMap.get(a.id) ?? null,
  }));
}
