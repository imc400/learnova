import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { quotaUsage, videoBackfillQueue } from "@/db/schema";
import { env } from "@/lib/env";
import { alertFounder } from "@/lib/ops/alert";

/*
  Contador de cuota de APIs externas (E-P0.4).

  YouTube Data API: search.list = 100 unidades, videos.list = 1 unidad.
  Con 10K unidades/día el techo es ~4 rutas frescas/día — el contador alimenta:
  1. el circuit-breaker (sobre YOUTUBE_QUOTA_SOFT_LIMIT no se busca: la lección
     se encola en video_backfill_queue y NO se cachea canon degradado),
  2. la alerta al 80% del límite diario,
  3. la evidencia para pedir aumento de cuota a Google (task #20).

  El "día" se calcula en hora del Pacífico (America/Los_Angeles): la cuota de
  Google resetea a medianoche PT, no UTC ni Chile — si contáramos en otra zona,
  el breaker se abriría/cerraría desfasado del límite real.

  Gemini: solo conteo de requests (gemini_requests) para diagnóstico de 429
  (E-P2). El incremento lo llama Track A desde insights.ts.

  TODOS los helpers de tracking son never-throw: perder una cuenta de cuota
  jamás puede romper una generación pagada.
*/

const PT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día actual de cuota (YYYY-MM-DD en hora del Pacífico = reloj de Google). */
export function youtubeQuotaDay(): string {
  return PT_DAY.format(new Date());
}

/** Error tipado del circuit-breaker: Track A lo distingue de un fallo genérico
 *  para encolar backfill y NO cachear canon degradado. */
export class YouTubeQuotaError extends Error {
  /** true = breaker preventivo (soft limit); false = Google devolvió 403 quotaExceeded. */
  readonly breaker: boolean;
  constructor(message: string, breaker: boolean) {
    super(message);
    this.name = "YouTubeQuotaError";
    this.breaker = breaker;
  }
}

/** Suma unidades al día actual y devuelve el total del día (-1 si la BD falló). */
export async function trackYoutubeUnits(units: number): Promise<number> {
  try {
    const [row] = await db
      .insert(quotaUsage)
      .values({ day: youtubeQuotaDay(), youtubeUnits: units })
      .onConflictDoUpdate({
        target: quotaUsage.day,
        set: { youtubeUnits: sql`${quotaUsage.youtubeUnits} + ${units}` },
      })
      .returning({ units: quotaUsage.youtubeUnits });
    return row?.units ?? -1;
  } catch (e) {
    console.error("[quota] trackYoutubeUnits falló (no propaga):", e);
    return -1;
  }
}

/** Unidades de YouTube consumidas hoy (0 si no hay fila / la BD falló). */
export async function getYoutubeUnitsToday(): Promise<number> {
  try {
    const [row] = await db
      .select({ units: quotaUsage.youtubeUnits })
      .from(quotaUsage)
      .where(eq(quotaUsage.day, youtubeQuotaDay()))
      .limit(1);
    return row?.units ?? 0;
  } catch (e) {
    console.error("[quota] getYoutubeUnitsToday falló:", e);
    return 0;
  }
}

/**
 * Guard PRE-search (circuit breaker): si el día ya está sobre el soft limit,
 * lanza YouTubeQuotaError en vez de quemar las 100 unidades. Alerta al 80%
 * del límite duro (deduplicada por hora vía ops_incidents).
 * Un error de BD NO bloquea la búsqueda (fail-open con log).
 */
export async function guardYoutubeSearch(): Promise<void> {
  let units = -1;
  try {
    units = await getYoutubeUnitsToday();
  } catch {
    return; // fail-open
  }
  if (units < 0) return;

  if (units + 100 > env.YOUTUBE_QUOTA_SOFT_LIMIT) {
    await alertFounder({
      severidad: "critical",
      titulo: "Cuota YouTube: circuit breaker ABIERTO",
      detalle:
        "Se alcanzó el umbral de seguridad de la cuota diaria de YouTube. Las búsquedas nuevas se suspenden hasta el reseteo (medianoche hora Pacífico); las lecciones afectadas van a video_backfill_queue y se reparan con el cron backfill-videos. El canon NO se cachea degradado.",
      contexto: {
        unidadesHoy: units,
        softLimit: env.YOUTUBE_QUOTA_SOFT_LIMIT,
        limiteDiario: env.YOUTUBE_QUOTA_DAILY_LIMIT,
      },
    });
    throw new YouTubeQuotaError(
      `Circuit breaker de cuota YouTube abierto (${units}/${env.YOUTUBE_QUOTA_SOFT_LIMIT})`,
      true,
    );
  }

  if (units >= env.YOUTUBE_QUOTA_DAILY_LIMIT * 0.8) {
    await alertFounder({
      severidad: "warning",
      titulo: "Cuota YouTube sobre el 80%",
      detalle:
        "El consumo de la YouTube Data API superó el 80% del límite diario. Sobre el soft limit el pipeline pasa a modo sin-video (backfill al día siguiente). Considerar no generar rutas frescas masivas hoy.",
      contexto: {
        unidadesHoy: units,
        limiteDiario: env.YOUTUBE_QUOTA_DAILY_LIMIT,
        softLimit: env.YOUTUBE_QUOTA_SOFT_LIMIT,
      },
    });
  }
}

/**
 * Google devolvió 403 quotaExceeded: fija el contador del día al límite duro
 * (la verdad de Google manda sobre nuestra cuenta) y alerta. Never-throw.
 */
export async function markYoutubeQuotaExhausted(): Promise<void> {
  try {
    await db
      .insert(quotaUsage)
      .values({ day: youtubeQuotaDay(), youtubeUnits: env.YOUTUBE_QUOTA_DAILY_LIMIT })
      .onConflictDoUpdate({
        target: quotaUsage.day,
        set: {
          youtubeUnits: sql`greatest(${quotaUsage.youtubeUnits}, ${env.YOUTUBE_QUOTA_DAILY_LIMIT})`,
        },
      });
  } catch (e) {
    console.error("[quota] markYoutubeQuotaExhausted falló:", e);
  }
  await alertFounder({
    severidad: "critical",
    titulo: "Cuota YouTube AGOTADA (403 de Google)",
    detalle:
      "Google rechazó una búsqueda por quotaExceeded. Las lecciones en vuelo quedan sin video (encoladas en backfill, sin cachear canon). Resetea a medianoche hora Pacífico.",
    contexto: { limiteDiario: env.YOUTUBE_QUOTA_DAILY_LIMIT },
  });
}

/** Cuenta una request a Gemini en el día (E-P2; Track A la llama desde insights.ts). */
export async function trackGeminiRequest(): Promise<void> {
  try {
    await db
      .insert(quotaUsage)
      .values({ day: youtubeQuotaDay(), geminiRequests: 1 })
      .onConflictDoUpdate({
        target: quotaUsage.day,
        set: { geminiRequests: sql`${quotaUsage.geminiRequests} + 1` },
      });
  } catch (e) {
    console.error("[quota] trackGeminiRequest falló:", e);
  }
}

/**
 * Encola una lección para re-curación de video (cuota agotada, link-rot,
 * gate rechazado). Idempotente: no duplica si ya hay un item pendiente con
 * la misma razón. El cron diario backfill-videos drena la cola. Never-throw.
 */
export async function enqueueVideoBackfill(
  lessonId: string,
  reason: "quota_exceeded" | "link_rot" | "gate_rechazado" | (string & {}),
): Promise<void> {
  try {
    const [pending] = await db
      .select({ id: videoBackfillQueue.id })
      .from(videoBackfillQueue)
      .where(
        sql`${videoBackfillQueue.lessonId} = ${lessonId} and ${videoBackfillQueue.reason} = ${reason} and ${videoBackfillQueue.processedAt} is null`,
      )
      .limit(1);
    if (pending) return;
    await db.insert(videoBackfillQueue).values({ lessonId, reason });
  } catch (e) {
    console.error("[quota] enqueueVideoBackfill falló (no propaga):", e);
  }
}
