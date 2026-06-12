import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/lib/env";
import { getYoutubeUnitsToday, youtubeQuotaDay } from "@/lib/ops/quota";

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

/* ====================================================================
   PANEL DE SALUD OPERATIVA (Track E — E-P1.3 / E-P1.7)
   ==================================================================== */

export interface OpsIncidentRow {
  id: string;
  severity: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

/** Incidentes ABIERTOS (banner rojo): sin resolver, últimos 7 días. */
export async function getOpenIncidents(limit = 20): Promise<OpsIncidentRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select id, severity, title, detail, created_at
    from ops_incidents
    where resolved_at is null and created_at > now() - interval '7 days'
    order by created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    severity: String(r.severity),
    title: String(r.title),
    detail: (r.detail as string) ?? null,
    createdAt: String(r.created_at),
  }));
}

export interface AiCostSummary {
  costTodayUsd: number;
  callsToday: number;
  cacheHitPct: number; // % de tokens de entrada servidos desde caché de prompts
  costPerPathP50Usd: number; // rutas de los últimos 14 días
  costPerPathP95Usd: number;
}

/**
 * Costo real de la API de Anthropic desde ai_usage (E-P1.7 — antes era fe).
 * Tarifas USD/MTok (2026-05): Opus 4.8 $5/$25 · Sonnet 4.6 $3/$15 ·
 * Haiku 4.5 $1/$5. Cache read = 0.1× input; cache write = 1.25× (TTL 5 min).
 */
export async function getAiCostSummary(): Promise<AiCostSummary> {
  const priced = sql`
    select
      created_at, path_id,
      input_tokens, output_tokens, cache_read, cache_write,
      case when model ilike '%opus%' then 5.0
           when model ilike '%sonnet%' then 3.0
           else 1.0 end as p_in,
      case when model ilike '%opus%' then 25.0
           when model ilike '%sonnet%' then 15.0
           else 5.0 end as p_out
    from ai_usage
  `;
  const [row] = await db.execute<Record<string, unknown>>(sql`
    with priced as (${priced}),
    costed as (
      select created_at, path_id, input_tokens, cache_read,
        (input_tokens * p_in + output_tokens * p_out
         + cache_read * p_in * 0.1 + cache_write * p_in * 1.25) / 1e6 as usd
      from priced
    ),
    hoy as (
      select coalesce(sum(usd), 0) as cost, count(*) as calls,
             coalesce(sum(cache_read), 0) as cr,
             coalesce(sum(input_tokens), 0) as it
      from costed
      where (created_at at time zone 'America/Santiago')::date
            = (now() at time zone 'America/Santiago')::date
    ),
    por_ruta as (
      select path_id, sum(usd) as ruta_usd
      from costed
      where path_id is not null and created_at > now() - interval '14 days'
      group by path_id
    )
    select
      (select cost from hoy) as cost_today,
      (select calls from hoy) as calls_today,
      (select case when cr + it > 0 then round(cr::numeric / (cr + it) * 100) else 0 end from hoy) as cache_hit_pct,
      coalesce((select percentile_cont(0.5) within group (order by ruta_usd) from por_ruta), 0) as p50,
      coalesce((select percentile_cont(0.95) within group (order by ruta_usd) from por_ruta), 0) as p95
  `);
  return {
    costTodayUsd: Number(row?.cost_today ?? 0),
    callsToday: Number(row?.calls_today ?? 0),
    cacheHitPct: Number(row?.cache_hit_pct ?? 0),
    costPerPathP50Usd: Number(row?.p50 ?? 0),
    costPerPathP95Usd: Number(row?.p95 ?? 0),
  };
}

export interface QuotaSummary {
  day: string; // día de cuota (hora Pacífico = reloj de Google)
  youtubeUnits: number;
  youtubeDailyLimit: number;
  youtubeSoftLimit: number;
  geminiRequests: number;
  backfillPending: number;
}

/** Cuota YouTube del día + cola de backfill (insumo del circuit breaker). */
export async function getQuotaSummary(): Promise<QuotaSummary> {
  const day = youtubeQuotaDay();
  const units = await getYoutubeUnitsToday();
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      (select coalesce(gemini_requests, 0) from quota_usage where day = ${day}) as gemini,
      (select count(*) from video_backfill_queue
        where processed_at is null and reason not like 'link_rot_strike:%') as backfill
  `);
  return {
    day,
    youtubeUnits: units,
    youtubeDailyLimit: env.YOUTUBE_QUOTA_DAILY_LIMIT,
    youtubeSoftLimit: env.YOUTUBE_QUOTA_SOFT_LIMIT,
    geminiRequests: Number(row?.gemini ?? 0),
    backfillPending: Number(row?.backfill ?? 0),
  };
}

export interface ProblemPathRow {
  id: string;
  title: string;
  email: string | null;
  status: string;
  generationProgress: number;
  problema: "falló" | "colgada" | "incompleta" | "draft";
  createdAt: string;
}

/** Generaciones con problemas (failed + colgadas + incompletas + draft viejas). */
export async function getProblemPaths(limit = 30): Promise<ProblemPathRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select lp.id, lp.title, lp.status, lp.generation_progress, lp.created_at,
      coalesce(p.email, u.email) as email,
      case
        when lp.status = 'failed' then 'falló'
        when lp.status = 'generating' then 'colgada'
        when lp.status = 'draft' then 'draft'
        else 'incompleta'
      end as problema
    from learning_paths lp
    join profiles p on p.id = lp.user_id
    left join auth.users u on u.id = p.id
    where lp.created_at > now() - interval '14 days' and (
      lp.status = 'failed'
      or (lp.status = 'generating' and lp.generation_started_at < now() - interval '50 minutes')
      or (lp.status = 'draft' and lp.created_at < now() - interval '10 minutes')
      or (lp.status = 'ready' and lp.generation_progress < 100 and lp.updated_at < now() - interval '30 minutes')
    )
    order by lp.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    email: (r.email as string) ?? null,
    status: String(r.status),
    generationProgress: Number(r.generation_progress ?? 0),
    problema: r.problema as ProblemPathRow["problema"],
    createdAt: String(r.created_at),
  }));
}

export interface PaidIntentWithoutPathRow {
  id: string;
  topic: string;
  email: string | null;
  amountClp: number | null;
  paidAt: string | null;
}

/** Plata cobrada SIN ruta: lo que la reconciliación repara cada 5 min. */
export async function getPaidIntentsWithoutPath(): Promise<PaidIntentWithoutPathRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ri.id, ri.topic, ri.amount_clp, ri.paid_at, coalesce(p.email, u.email) as email
    from route_intents ri
    join profiles p on p.id = ri.user_id
    left join auth.users u on u.id = p.id
    where ri.status = 'paid' and ri.path_id is null
    order by ri.paid_at desc nulls last
    limit 20
  `);
  return rows.map((r) => ({
    id: String(r.id),
    topic: String(r.topic),
    email: (r.email as string) ?? null,
    amountClp: r.amount_clp == null ? null : Number(r.amount_clp),
    paidAt: r.paid_at ? String(r.paid_at) : null,
  }));
}

export interface ContinuationKpis {
  sugerenciasEmitidas: number;
  porVia: { via: string; intents: number; pagados: number }[];
}

/** KPI del funnel de continuación (columnas source_path_id + clicked_via de Track D). */
export async function getContinuationKpis(): Promise<ContinuationKpis> {
  const [tot] = await db.execute<Record<string, unknown>>(sql`
    select count(*) as sugerencias from next_path_suggestions
  `);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select coalesce(clicked_via, 'directo') as via,
      count(*) as intents,
      count(*) filter (where path_id is not null or status in ('paid', 'bypassed')) as pagados
    from route_intents
    where source_path_id is not null
    group by 1
    order by intents desc
  `);
  return {
    sugerenciasEmitidas: Number(tot?.sugerencias ?? 0),
    porVia: rows.map((r) => ({
      via: String(r.via),
      intents: Number(r.intents ?? 0),
      pagados: Number(r.pagados ?? 0),
    })),
  };
}

export interface ProSourceRow {
  source: string;
  compras: number;
}

/** Atribución de compras Pro por CTA (path_purchases.source — Track D la puebla). */
export async function getProBySource(): Promise<ProSourceRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select coalesce(source, 'sin atribución') as source, count(*) as compras
    from path_purchases
    where kind = 'pro_month' and status = 'paid'
    group by 1
    order by compras desc
  `);
  return rows.map((r) => ({ source: String(r.source), compras: Number(r.compras ?? 0) }));
}

/* ====================================================================
   PULSO EN VIVO (pedido del fundador 2026-06-12: "ver todo lo que pasa
   con los usuarios — cómo avanzan, qué se crea, quién está en clase")
   ==================================================================== */

export interface LiveNowRow {
  sessionId: string;
  email: string | null;
  name: string | null;
  pathTitle: string;
  kind: string;
  teacher: string | null;
  elapsedMin: number;
}

/** Quién está EN EL AULA ahora mismo (in_progress dentro de la ventana viva). */
export async function getLiveNow(): Promise<LiveNowRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ls.id, ls.kind, coalesce(p.email, u.email) as email, p.full_name,
      lp.title as path_title, ra.name as teacher,
      ceil(extract(epoch from now() - coalesce(ls.started_at, ls.created_at)) / 60)::int as elapsed_min
    from live_sessions ls
    join profiles p on p.id = ls.user_id
    left join auth.users u on u.id = p.id
    join learning_paths lp on lp.id = ls.path_id
    left join route_agents ra on ra.cache_key = coalesce(lp.skeleton_cache_key, 'path-' || lp.id)
    where ls.status = 'in_progress'
      and ls.created_at > now() - interval '35 minutes'
    order by ls.created_at desc
    limit 20
  `);
  return rows.map((r) => ({
    sessionId: String(r.id),
    email: (r.email as string) ?? null,
    name: (r.full_name as string) ?? null,
    pathTitle: String(r.path_title),
    kind: String(r.kind),
    teacher: (r.teacher as string) ?? null,
    elapsedMin: Number(r.elapsed_min ?? 0),
  }));
}

export interface RecentClassRow {
  sessionId: string;
  email: string | null;
  pathTitle: string;
  kind: string;
  status: string;
  teacher: string | null;
  durationMin: number;
  hasSummary: boolean;
  endedAt: string | null;
}

/** Últimas clases (terminadas o perdidas) con duración real y si hubo resumen. */
export async function getRecentClasses(limit = 12): Promise<RecentClassRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select ls.id, ls.kind, ls.status, ls.duration_sec, ls.ended_at,
      (ls.summary is not null) as has_summary,
      coalesce(p.email, u.email) as email, lp.title as path_title, ra.name as teacher
    from live_sessions ls
    join profiles p on p.id = ls.user_id
    left join auth.users u on u.id = p.id
    join learning_paths lp on lp.id = ls.path_id
    left join route_agents ra on ra.cache_key = coalesce(lp.skeleton_cache_key, 'path-' || lp.id)
    where ls.status in ('completed', 'missed')
    order by coalesce(ls.ended_at, ls.updated_at) desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    sessionId: String(r.id),
    email: (r.email as string) ?? null,
    pathTitle: String(r.path_title),
    kind: String(r.kind),
    status: String(r.status),
    teacher: (r.teacher as string) ?? null,
    durationMin: Math.ceil(Number(r.duration_sec ?? 0) / 60),
    hasSummary: Boolean(r.has_summary),
    endedAt: r.ended_at ? String(r.ended_at) : null,
  }));
}

export interface TodayPulse {
  signupsToday: number;
  pathsToday: number;
  lessonsToday: number;
  activeUsersToday: number;
  classesToday: number;
  classMinutesToday: number;
  topToday: { email: string | null; lessons: number }[];
}

/** El día de HOY (hora Chile) en una mirada: quién hizo qué. */
export async function getTodayPulse(): Promise<TodayPulse> {
  const [row] = await db.execute<Record<string, unknown>>(sql`
    with hoy as (select (now() at time zone 'America/Santiago')::date as d)
    select
      (select count(*) from profiles
        where (created_at at time zone 'America/Santiago')::date = (select d from hoy)) as signups,
      (select count(*) from learning_paths
        where (created_at at time zone 'America/Santiago')::date = (select d from hoy)) as paths,
      (select count(*) from progress
        where status = 'completed'
          and (completed_at at time zone 'America/Santiago')::date = (select d from hoy)) as lessons,
      (select count(distinct user_id) from progress
        where status = 'completed'
          and (completed_at at time zone 'America/Santiago')::date = (select d from hoy)) as active_users,
      (select count(*) from live_sessions
        where status in ('completed', 'in_progress')
          and (created_at at time zone 'America/Santiago')::date = (select d from hoy)) as classes,
      (select coalesce(sum(duration_sec), 0) / 60 from live_sessions
        where status = 'completed'
          and (created_at at time zone 'America/Santiago')::date = (select d from hoy)) as class_minutes
  `);
  const top = await db.execute<Record<string, unknown>>(sql`
    with hoy as (select (now() at time zone 'America/Santiago')::date as d)
    select coalesce(p.email, u.email) as email, count(*) as lessons
    from progress pr
    join profiles p on p.id = pr.user_id
    left join auth.users u on u.id = p.id
    where pr.status = 'completed'
      and (pr.completed_at at time zone 'America/Santiago')::date = (select d from hoy)
    group by 1
    order by lessons desc
    limit 5
  `);
  return {
    signupsToday: Number(row?.signups ?? 0),
    pathsToday: Number(row?.paths ?? 0),
    lessonsToday: Number(row?.lessons ?? 0),
    activeUsersToday: Number(row?.active_users ?? 0),
    classesToday: Number(row?.classes ?? 0),
    classMinutesToday: Number(row?.class_minutes ?? 0),
    topToday: top.map((r) => ({
      email: (r.email as string) ?? null,
      lessons: Number(r.lessons ?? 0),
    })),
  };
}
