import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { videoCandidates, youtubeSearchCache } from "@/db/schema";
import { getVideoDetails } from "./client";

// Refrescar antes del límite de 30 días que exige la política de YouTube.
const REFRESH_AFTER_DAYS = 25;

/**
 * Refresca (o desactiva) metadatos de videos guardados para CUMPLIR la política
 * de almacenamiento de YouTube (refrescar/borrar metadatos antes de 30 días) y
 * detectar videos caídos (link-rot). Procesa en lotes de 50 (1 unidad de cuota).
 */
export async function refreshStaleVideos(
  limit = 200,
): Promise<{ checked: number; refreshed: number; disabled: number }> {
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
  if (stale.length === 0) return { checked: 0, refreshed: 0, disabled: 0 };

  let refreshed = 0;
  let disabled = 0;
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
      } else {
        // Ya no disponible (borrado/privado/bloqueo regional) → desactivar.
        await db
          .update(videoCandidates)
          .set({ isActive: false, lastCheckedAt: now })
          .where(eq(videoCandidates.id, v.id));
        disabled++;
      }
    }
  }
  return { checked: stale.length, refreshed, disabled };
}
