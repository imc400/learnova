import { env } from "@/lib/env";
import type { YouTubeCandidate } from "./types";

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
 */
export async function searchVideos(
  query: string,
  opts: { maxResults?: number; language?: string } = {},
): Promise<string[]> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(opts.maxResults ?? 15),
    relevanceLanguage: (opts.language ?? "es").slice(0, 2),
    videoEmbeddable: "true", // solo videos que permiten embedding
    safeSearch: "moderate",
    fields: "items(id/videoId)", // minimización: solo el ID que usamos
    key: key(),
  });

  const res = await fetch(`${API}/search?${params}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`YouTube search falló: ${res.status} ${await res.text()}`);
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

/** Verifica qué IDs siguen disponibles (para el job anti link-rot). */
export async function checkAvailability(ids: string[]): Promise<Set<string>> {
  const details = await getVideoDetails(ids);
  return new Set(details.map((d) => d.videoId));
}

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
