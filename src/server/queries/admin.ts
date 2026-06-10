import { sql } from "drizzle-orm";
import { db } from "@/db";

/*
  Métricas del dashboard admin. Todo en SQL agregado (cero N+1): cada sección
  es UNA query. Los números alimentan decisiones de negocio (ads, remarketing),
  así que se calculan desde las tablas fuente, nunca desde contadores derivados.
*/

export interface AdminKpis {
  usersTotal: number;
  users7d: number;
  pathsTotal: number;
  paths7d: number;
  lessonsCompleted: number;
  activationPct: number; // % de usuarios con ≥1 lección completada
  liveClasses: number;
  liveMinutes: number;
  intentsTotal: number;
  intentsPending: number;
  intentsPaid: number;
  revenueClp: number;
}

export async function getAdminKpis(): Promise<AdminKpis> {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from profiles) as users_total,
      (select count(*) from profiles where created_at > now() - interval '7 days') as users_7d,
      (select count(*) from learning_paths) as paths_total,
      (select count(*) from learning_paths where created_at > now() - interval '7 days') as paths_7d,
      (select count(*) from progress where status = 'completed') as lessons_completed,
      (select count(distinct user_id) from progress where status = 'completed') as users_active,
      (select count(*) from live_sessions where status = 'completed') as live_classes,
      (select coalesce(sum(duration_sec), 0) / 60 from live_sessions where status = 'completed') as live_minutes,
      (select count(*) from route_intents) as intents_total,
      (select count(*) from route_intents where status = 'pending_payment') as intents_pending,
      (select count(*) from route_intents where status = 'paid') as intents_paid,
      -- Libro contable real: rutas pagadas Y meses de Pro manual (kind).
      (select coalesce(sum(amount), 0) from path_purchases where status = 'paid' and currency = 'CLP') as revenue_clp
  `);
  const n = (k: string) => Number(row?.[k] ?? 0);
  const usersTotal = n("users_total");
  return {
    usersTotal,
    users7d: n("users_7d"),
    pathsTotal: n("paths_total"),
    paths7d: n("paths_7d"),
    lessonsCompleted: n("lessons_completed"),
    activationPct: usersTotal ? Math.round((n("users_active") / usersTotal) * 100) : 0,
    liveClasses: n("live_classes"),
    liveMinutes: n("live_minutes"),
    intentsTotal: n("intents_total"),
    intentsPending: n("intents_pending"),
    intentsPaid: n("intents_paid"),
    revenueClp: n("revenue_clp"),
  };
}

export interface FunnelStep {
  label: string;
  count: number;
}

/** Embudo: registro → formulario → ruta → empezó → 40% (clase) → completó. */
export async function getFunnel(): Promise<FunnelStep[]> {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    with per_path as (
      select
        lp.user_id,
        lp.id,
        (select count(*) from progress pr
          where pr.path_id = lp.id and pr.status = 'completed') as done,
        (select count(*) from lessons l
          join modules m on m.id = l.module_id where m.path_id = lp.id) as total
      from learning_paths lp
    )
    select
      (select count(*) from profiles) as registered,
      (select count(distinct user_id) from (
        select user_id from route_intents
        union select user_id from learning_paths
      ) f) as filled_form,
      (select count(distinct user_id) from learning_paths) as has_path,
      (select count(distinct user_id) from per_path where done > 0) as started,
      (select count(distinct user_id) from per_path
        where total > 0 and done::float / total >= 0.4) as reached_40,
      (select count(distinct user_id) from per_path
        where total > 0 and done >= total) as completed
  `);
  const n = (k: string) => Number(row?.[k] ?? 0);
  return [
    { label: "Registrados", count: n("registered") },
    { label: "Completaron el formulario", count: n("filled_form") },
    { label: "Con ruta creada", count: n("has_path") },
    { label: "Empezaron (≥1 lección)", count: n("started") },
    { label: "Llegaron al 40% (clase)", count: n("reached_40") },
    { label: "Completaron una ruta", count: n("completed") },
  ];
}

export interface DayCount {
  day: string;
  signups: number;
  paths: number;
}

/** Registros y rutas por día (últimos 14 días, incluye días en cero). */
export async function getDailySeries(): Promise<DayCount[]> {
  // Días en hora de CHILE (created_at es UTC; sin conversión, lo de la noche
  // cae al día siguiente y los gráficos mienten).
  const rows = await db.execute<Record<string, unknown>>(sql`
    with hoy as (select (now() at time zone 'America/Santiago')::date as d)
    select
      d.day::date as day,
      (select count(*) from profiles p
        where (p.created_at at time zone 'America/Santiago')::date = d.day) as signups,
      (select count(*) from learning_paths lp
        where (lp.created_at at time zone 'America/Santiago')::date = d.day) as paths
    from generate_series(
      (select d from hoy) - interval '13 days',
      (select d from hoy),
      '1 day'
    ) as d(day)
    order by d.day
  `);
  return rows.map((r) => ({
    day: String(r.day),
    signups: Number(r.signups ?? 0),
    paths: Number(r.paths ?? 0),
  }));
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  paths: number;
  lessonsDone: number;
  avgProgressPct: number;
  totalXp: number;
  lastActiveDay: string | null;
}

/** Usuarios recientes con su actividad agregada. */
export async function getAdminUsers(limit = 30): Promise<AdminUserRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      p.id, p.full_name, coalesce(p.email, u.email) as email, p.phone, p.created_at, p.total_xp, p.last_active_day,
      (select count(*) from learning_paths lp where lp.user_id = p.id) as paths,
      (select count(*) from progress pr
        where pr.user_id = p.id and pr.status = 'completed') as lessons_done,
      coalesce((
        select round(avg(least(done::float / nullif(total, 0), 1)) * 100)
        from (
          select
            (select count(*) from progress pr
              where pr.path_id = lp.id and pr.status = 'completed') as done,
            (select count(*) from lessons l
              join modules m on m.id = l.module_id where m.path_id = lp.id) as total
          from learning_paths lp where lp.user_id = p.id
        ) x where x.total > 0
      ), 0) as avg_pct
    from profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    name: (r.full_name as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    createdAt: String(r.created_at),
    paths: Number(r.paths ?? 0),
    lessonsDone: Number(r.lessons_done ?? 0),
    avgProgressPct: Number(r.avg_pct ?? 0),
    totalXp: Number(r.total_xp ?? 0),
    lastActiveDay: r.last_active_day ? String(r.last_active_day) : null,
  }));
}

export interface AbandonedCartRow {
  id: string;
  topic: string;
  level: string;
  amountClp: number | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  createdAt: string;
}

/** Carros abandonados: intents sin pagar con >30 min de antigüedad. */
export async function getAbandonedCarts(limit = 50): Promise<AbandonedCartRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ri.id, ri.topic, ri.level, ri.amount_clp, ri.created_at, ri.phone,
           coalesce(p.email, u.email) as email, p.full_name
    from route_intents ri
    join profiles p on p.id = ri.user_id
    left join auth.users u on u.id = p.id
    where ri.status = 'pending_payment'
      and ri.created_at < now() - interval '30 minutes'
    order by ri.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    topic: String(r.topic),
    level: String(r.level),
    amountClp: r.amount_clp == null ? null : Number(r.amount_clp),
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    name: (r.full_name as string) ?? null,
    createdAt: String(r.created_at),
  }));
}

export interface AdminPathRow {
  id: string;
  title: string;
  email: string | null;
  generationProgress: number;
  status: string;
  userPct: number;
  createdAt: string;
}

/** Rutas recientes con avance de generación y del alumno. */
export async function getAdminPaths(limit = 20): Promise<AdminPathRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select lp.id, lp.title, lp.status, lp.generation_progress, lp.created_at,
      coalesce(p.email, u.email) as email,
      coalesce(round(
        (select count(*) from progress pr
          where pr.path_id = lp.id and pr.status = 'completed')::float
        / nullif((select count(*) from lessons l
          join modules m on m.id = l.module_id where m.path_id = lp.id), 0) * 100
      ), 0) as user_pct
    from learning_paths lp
    join profiles p on p.id = lp.user_id
    left join auth.users u on u.id = p.id
    order by lp.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    email: (r.email as string) ?? null,
    generationProgress: Number(r.generation_progress ?? 0),
    status: String(r.status),
    userPct: Number(r.user_pct ?? 0),
    createdAt: String(r.created_at),
  }));
}
