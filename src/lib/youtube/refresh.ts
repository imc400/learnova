import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { videoCandidates, youtubeSearchCache, videoBackfillQueue } from "@/db/schema";
import { getVideoDetails } from "./client";
import { enqueueVideoBackfill } from "@/lib/ops/quota";

// Refrescar antes del límite de 30 días que exige la política de YouTube.
const REFRESH_AFTER_DAYS = 25;

/*
  Link-rot con 2 STRIKES EN DÍAS DISTINTOS (E-P1.6): una ausencia puede ser
  geobloqueo o un hipo transitorio de la API (task #22) — desactivar a la
  primera mataba videos vivos. El ledger del strike vive en
  video_backfill_queue con reason `link_rot_strike:<videoId>` y processed_at
  YA seteado (no es trabajo pendiente: el cron de drain lo ignora).

  - Strike 1: se registra el ledger y NO se toca lastCheckedAt → el candidato
    sigue "stale" y el cron diario lo re-verifica mañana.
  - Reaparece: se borra el ledger (un flap no acumula strikes eternos).
  - Strike 2 (≥20 h después = día distinto): se desactiva; si era el rank 0,
    la lección entra a la cola REAL de backfill (reason 'link_rot') para que
    backfill-videos la re-ancle al respaldo con digest y quiz coherentes.
*/
const STRIKE_MIN_GAP_MS = 20 * 60 * 60 * 1000; // "días distintos" tolerando jitter del cron
const strikeReason = (videoId: string) => `link_rot_strike:${videoId}`;

/**
 * Refresca (o desactiva) metadatos de videos guardados para CUMPLIR la política
 * de almacenamiento de YouTube (refrescar/borrar metadatos antes de 30 días) y
 * detectar videos caídos (link-rot). Procesa en lotes de 50 (1 unidad de cuota).
 */
export async function refreshStaleVideos(
  limit = 200,
): Promise<{ checked: number; refreshed: number; disabled: number; firstStrikes: number }> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000);

  // Cumplimiento: purga búsquedas cacheadas con > 30 días (no retener datos de la API).
  await db
    .delete(youtubeSearchCache)
    .where(
      lt(
        youtubeSearchCache.updatedAt,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      ),
    );

  const stale = await db
    .select()
    .from(videoCandidates)
    .where(
      and(
        eq(videoCandidates.isActive, true),
        or(
          isNull(videoCandidates.lastCheckedAt),
          lt(videoCandidates.lastCheckedAt, cutoff),
        ),
      ),
    )
    // Drena siempre lo más viejo primero (cumplimiento: que nada cruce los 30 días).
    .orderBy(sql`${videoCandidates.lastCheckedAt} asc nulls first`)
    .limit(limit);
  if (stale.length === 0) return { checked: 0, refreshed: 0, disabled: 0, firstStrikes: 0 };

  let refreshed = 0;
  let disabled = 0;
  let firstStrikes = 0;
  // Lotes de 50 (límite de videos.list; 1 unidad de cuota por lote).
  for (let i = 0; i < stale.length; i += 50) {
    const batch = stale.slice(i, i + 50);
    const details = await getVideoDetails(batch.map((v) => v.youtubeVideoId));
    const byId = new Map(details.map((d) => [d.videoId, d]));
    const now = new Date();
    for (const v of batch) {
      const d = byId.get(v.youtubeVideoId);
      if (d) {
        await db
          .update(videoCandidates)
          .set({
            title: d.title,
            channelTitle: d.channelTitle,
            durationSeconds: d.durationSeconds,
            language: d.defaultLanguage ?? v.language,
            lastCheckedAt: now,
          })
          .where(eq(videoCandidates.id, v.id));
        refreshed++;
        // Reapareció tras un strike (geobloqueo/hipo transitorio): limpiar ledger.
        await db
          .delete(videoBackfillQueue)
          .where(
            and(
              eq(videoBackfillQueue.lessonId, v.lessonId),
              eq(videoBackfillQueue.reason, strikeReason(v.youtubeVideoId)),
            ),
          )
          .catch(() => {});
      } else {
        // No disponible (borrado/privado/bloqueo regional): 2 strikes en días
        // distintos antes de desactivar.
        const [strike] = await db
          .select({ id: videoBackfillQueue.id, createdAt: videoBackfillQueue.createdAt })
          .from(videoBackfillQueue)
          .where(
            and(
              eq(videoBackfillQueue.lessonId, v.lessonId),
              eq(videoBackfillQueue.reason, strikeReason(v.youtubeVideoId)),
            ),
          )
          .limit(1);

        if (!strike) {
          // Strike 1: ledger (processed_at seteado = el drain lo ignora) y
          // lastCheckedAt SIN tocar → mañana se re-verifica.
          await db.insert(videoBackfillQueue).values({
            lessonId: v.lessonId,
            reason: strikeReason(v.youtubeVideoId),
            processedAt: now,
          });
          firstStrikes++;
        } else if (now.getTime() - strike.createdAt.getTime() >= STRIKE_MIN_GAP_MS) {
          // Strike 2 confirmado en día distinto → desactivar de verdad.
          await db
            .update(videoCandidates)
            .set({ isActive: false, lastCheckedAt: now })
            .where(eq(videoCandidates.id, v.id));
          disabled++;
          // Cayó el rank 0 → la UI promovería un respaldo cuya guía/quiz no
          // corresponden: encolar re-anclaje real para el cron diario.
          if (v.rank === 0) {
            await enqueueVideoBackfill(v.lessonId, "link_rot");
          }
        }
        // strike < 20h: mismo día — esperar al cron de mañana.
      }
    }
  }
  return { checked: stale.length, refreshed, disabled, firstStrikes };
}
