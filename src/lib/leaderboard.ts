import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, xpEvents, progress, learningPaths } from "@/db/schema";
import { mondayOf, todayInTz } from "@/lib/gamification";

/*
  Leaderboard global de la comunidad (server-side vía Drizzle; PostgREST nunca
  expone estos datos — profiles_self sigue intacta para el browser).
  Reglas del spec:
  - PII cero: nombre de pila + inicial, o alias. Nunca email/apellido/meta.
  - Solo usuarios leaderboard_visible (los ocultos NO existen para el ranking).
  - Anti-gaming: cap de 300 XP/día por usuario dentro del cómputo semanal
    (el ledger ya es idempotente por dominio; esto frena el grind extremo).
  - "Estudiando: {topic}" = el TEMA de su ruta con actividad más reciente,
    nunca la meta personal (goal).
*/

const DAILY_XP_CAP = 300;
const BOARD_LIMIT = 50;

export interface BoardRow {
  userId: string;
  displayName: string;
  level: number;
  streak: number;
  xp: number; // semanal o total según el board
  studying: string | null;
  rank: number;
}

/** Nombre público: alias si existe; si no, nombre de pila + inicial. */
function displayNameExpr() {
  return sql<string>`coalesce(
    nullif(trim(${profiles.leaderboardAlias}), ''),
    case
      when ${profiles.fullName} is null or trim(${profiles.fullName}) = '' then 'Estudiante'
      else split_part(trim(${profiles.fullName}), ' ', 1) ||
        case
          when split_part(trim(${profiles.fullName}), ' ', 2) <> ''
          then ' ' || left(split_part(trim(${profiles.fullName}), ' ', 2), 1) || '.'
          else ''
        end
    end
  )`;
}

/** Tema de la ruta con actividad más reciente del usuario (solo el topic).
 *  OJO: la referencia externa va calificada ("profiles"."id") — sin calificar,
 *  Postgres la resuelve contra las tablas internas (ambigua o, peor, errónea). */
const studyingExpr = sql<string | null>`(
  select lp.topic from ${progress} pr
  join ${learningPaths} lp on lp.id = pr.path_id
  where pr.user_id = "profiles"."id"
  order by pr.updated_at desc limit 1
)`;

/** XP semanal por usuario con cap diario: sum(LEAST(xp_del_día, 300)). */
function weeklyXpSubquery(weekStart: string) {
  const daily = db
    .select({
      userId: xpEvents.userId,
      dayXp: sql<number>`sum(${xpEvents.points})`.as("day_xp"),
    })
    .from(xpEvents)
    .where(eq(xpEvents.weekStart, weekStart))
    .groupBy(xpEvents.userId, sql`${xpEvents.createdAt}::date`)
    .as("daily");

  return db
    .select({
      userId: daily.userId,
      xp: sql<number>`sum(least(${daily.dayXp}, ${DAILY_XP_CAP}))::int`.as("xp"),
    })
    .from(daily)
    .groupBy(daily.userId)
    .as("weekly");
}

/** Ranking SEMANAL: XP de la semana en curso con cap diario anti-gaming. */
export async function getWeeklyBoard(): Promise<{
  rows: BoardRow[];
  weekStart: string;
  totalParticipants: number;
}> {
  const weekStart = mondayOf(todayInTz());
  const weekly = weeklyXpSubquery(weekStart);

  const rows = await db
    .select({
      userId: profiles.id,
      displayName: displayNameExpr(),
      level: profiles.level,
      streak: profiles.currentStreak,
      xp: weekly.xp,
      studying: studyingExpr,
    })
    .from(weekly)
    .innerJoin(profiles, eq(profiles.id, weekly.userId))
    .where(eq(profiles.leaderboardVisible, true))
    .orderBy(desc(weekly.xp), desc(profiles.totalXp))
    .limit(BOARD_LIMIT);

  const weekly2 = weeklyXpSubquery(weekStart);
  const [totals] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(weekly2)
    .innerJoin(profiles, eq(profiles.id, weekly2.userId))
    .where(eq(profiles.leaderboardVisible, true));

  return {
    rows: rows.map((r, i) => ({ ...r, xp: Number(r.xp), rank: i + 1 })),
    weekStart,
    totalParticipants: Number(totals?.total ?? 0),
  };
}

/** Ranking histórico (XP total acumulado). */
export async function getAllTimeBoard(): Promise<{
  rows: BoardRow[];
  totalParticipants: number;
}> {
  const rows = await db
    .select({
      userId: profiles.id,
      displayName: displayNameExpr(),
      level: profiles.level,
      streak: profiles.currentStreak,
      xp: profiles.totalXp,
      studying: studyingExpr,
    })
    .from(profiles)
    .where(and(eq(profiles.leaderboardVisible, true), gt(profiles.totalXp, 0)))
    .orderBy(desc(profiles.totalXp))
    .limit(BOARD_LIMIT);

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(profiles)
    .where(and(eq(profiles.leaderboardVisible, true), gt(profiles.totalXp, 0)));

  return {
    rows: rows.map((r, i) => ({ ...r, xp: Number(r.xp), rank: i + 1 })),
    totalParticipants: Number(total),
  };
}

/** Posición del usuario actual ("estás #47 de 1.203") en el board semanal. */
export async function getMyWeeklyRank(userId: string): Promise<{
  rank: number | null;
  xp: number;
  total: number;
} | null> {
  const weekStart = mondayOf(todayInTz());

  const myDaily = db
    .select({
      dayXp: sql<number>`sum(${xpEvents.points})`.as("day_xp"),
    })
    .from(xpEvents)
    .where(and(eq(xpEvents.weekStart, weekStart), eq(xpEvents.userId, userId)))
    .groupBy(sql`${xpEvents.createdAt}::date`)
    .as("my_daily");
  const [me] = await db
    .select({
      xp: sql<number>`coalesce(sum(least(${myDaily.dayXp}, ${DAILY_XP_CAP})), 0)::int`,
    })
    .from(myDaily);
  const myXp = Number(me?.xp ?? 0);

  // Cuántos visibles me superan esta semana (+1 = mi posición).
  const weekly = weeklyXpSubquery(weekStart);
  const [counts] = await db
    .select({
      ahead: sql<number>`count(*) filter (where ${weekly.xp} > ${myXp})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(weekly)
    .innerJoin(profiles, eq(profiles.id, weekly.userId))
    .where(eq(profiles.leaderboardVisible, true));

  return {
    rank: myXp > 0 ? Number(counts?.ahead ?? 0) + 1 : null,
    xp: myXp,
    total: Number(counts?.total ?? 0),
  };
}
