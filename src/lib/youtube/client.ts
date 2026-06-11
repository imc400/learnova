import { env } from "@/lib/env";
import type { YouTubeCandidate } from "./types";
import {
  guardYoutubeSearch,
  trackYoutubeUnits,
  markYoutubeQuotaExhausted,
  YouTubeQuotaError,
} from "@/lib/ops/quota";

// Re-export: los consumidores (curate, run.ts de Track A) distinguen el error
// de cuota para encolar backfill y NO cachear canon degradado.
export { YouTubeQuotaError };

const API = "https://www.googleapis.com/youtube/v3";

function key(): string {
  if (!env.YOUTUBE_API_KEY) {
    throw new Error(
      "Falta YOUTUBE_API_KEY. Configúrala en .env (ver .env.example) para curar videos.",
    );
  }
  return env.YOUTUBE_API_KEY;
}

/** Convierte duración ISO-8601 (PT1H2M3S) a segundos. */
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/**
 * Busca videos candidatos. OJO: search.list cuesta 100 unidades de cuota
 * (de las 10.000/día). Llamar lo MENOS posible → cachear resultados en DB.
 *
 * Cuota (E-P0.4): ANTES de buscar corre el circuit breaker (sobre el soft
 * limit lanza YouTubeQuotaError en vez de quemar 100 u.); las unidades se
 * cuentan en quota_usage ANTES del fetch (pesimista: Google cobra también
 * las búsquedas que fallan después de aceptarse). Un 403 quotaExceeded fija
 * el día como agotado y también lanza YouTubeQuotaError.
 */
export async function searchVideos(
  query: string,
  opts: { maxResults?: number; language?: string } = {},
): Promise<string[]> {
  await guardYoutubeSearch(); // lanza YouTubeQuotaError si el breaker está abierto

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(opts.maxResults ?? 15),
    relevanceLanguage: (opts.language ?? "es").slice(0, 2),
    // Sesgo de mercado (E-P1.5): resultados relevantes para Chile, gratis.
    regionCode: "CL",
    videoEmbeddable: "true", // solo videos que permiten embedding
    safeSearch: "moderate",
    fields: "items(id/videoId)", // minimización: solo el ID que usamos
    key: key(),
  });

  void trackYoutubeUnits(100);

  const res = await fetch(`${API}/search?${params}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /quota/i.test(body)) {
      await markYoutubeQuotaExhausted();
      throw new YouTubeQuotaError("YouTube devolvió 403 quotaExceeded", false);
    }
    throw new Error(`YouTube search falló: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    items?: { id?: { videoId?: string } }[];
  };
  return (data.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((v): v is string => Boolean(v));
}

/** Detalles en lote (hasta 50 IDs por llamada = 1 unidad de cuota). */
export async function getVideoDetails(
  ids: string[],
): Promise<YouTubeCandidate[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics",
    id: ids.slice(0, 50).join(","),
    // minimización: solo los campos que usamos
    fields:
      "items(id,snippet(title,description,channelTitle,publishedAt,defaultLanguage,defaultAudioLanguage),contentDetails(duration,caption),statistics(viewCount,likeCount))",
    key: key(),
  });

  void trackYoutubeUnits(1);

  const res = await fetch(`${API}/videos?${params}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`YouTube videos.list falló: ${res.status}`);
  }
  const data = (await res.json()) as { items?: YouTubeApiVideo[] };

  return (data.items ?? []).map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    channelTitle: v.snippet.channelTitle,
    description: (v.snippet.description ?? "").slice(0, 1200),
    durationSeconds: parseDuration(v.contentDetails.duration),
    viewCount: Number(v.statistics?.viewCount ?? 0),
    likeCount: Number(v.statistics?.likeCount ?? 0),
    defaultLanguage:
      v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? null,
    hasCaptions: v.contentDetails.caption === "true",
    publishedAt: v.snippet.publishedAt,
  }));
}

/* checkAvailability se eliminó (E-P2): código muerto sin call-sites — el
   anti link-rot real vive en refresh.ts con getVideoDetails directo. */

interface YouTubeApiVideo {
  id: string;
  snippet: {
    title: string;
    description?: string;
    channelTitle: string;
    publishedAt: string;
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  contentDetails: { duration: string; caption?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}
