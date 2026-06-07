import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS, MAX_TOKENS } from "@/lib/ai/models";
import { VIDEO_RANKING_INSTRUCTIONS } from "@/lib/ai/prompts";
import { videoRankingSchema } from "@/lib/ai/schemas";
import { searchVideos, getVideoDetails } from "./client";
import type { CuratedVideo } from "./types";

/**
 * Cura el mejor video de YouTube para un paso de la ruta + alternativas.
 * Flujo: search (1 llamada) → videos.list (1 llamada) → ranking con Haiku
 * usando SOLO metadatos oficiales (sin transcripciones / sin scraping).
 */
export async function curateVideoForLesson(args: {
  query: string;
  objective: string;
  language: string;
  keep?: number; // cuántos guardar (principal + alternativas)
}): Promise<CuratedVideo[]> {
  const keep = args.keep ?? 3;

  const ids = await searchVideos(args.query, {
    maxResults: 15,
    language: args.language,
  });
  const candidates = await getVideoDetails(ids);
  if (candidates.length === 0) return [];

  const client = getAnthropic();
  const res = await client.messages.parse({
    model: MODELS.ranker,
    max_tokens: MAX_TOKENS.ranker,
    system: cachedSystem(VIDEO_RANKING_INSTRUCTIONS),
    output_config: { format: zodOutputFormat(videoRankingSchema) },
    messages: [
      {
        role: "user",
        content: [
          `OBJETIVO DEL PASO: ${args.objective}`,
          `IDIOMA DEL ESTUDIANTE: ${args.language}`,
          "",
          "CANDIDATOS (metadatos oficiales):",
          JSON.stringify(
            candidates.map((c) => ({
              videoId: c.videoId,
              title: c.title,
              channel: c.channelTitle,
              description: c.description.slice(0, 400),
              durationSeconds: c.durationSeconds,
              language: c.defaultLanguage,
              views: c.viewCount,
              likes: c.likeCount,
              captions: c.hasCaptions,
            })),
          ),
          "",
          "Rankea del mejor al peor y devuelve el array `ranked`.",
        ].join("\n"),
      },
    ],
  });

  const byId = new Map(candidates.map((c) => [c.videoId, c]));
  // Si Haiku devuelve refusal/JSON inválido, no rompemos la ruta: lección sin video.
  if (!res.parsed_output) return [];
  return res.parsed_output.ranked
    .filter((r) => byId.has(r.videoId))
    .slice(0, keep)
    .map((r, i) => {
      const c = byId.get(r.videoId)!;
      return {
        videoId: r.videoId,
        title: c.title,
        channelTitle: c.channelTitle,
        durationSeconds: c.durationSeconds,
        language: r.language,
        score: r.score,
        reason: r.reason,
        rank: i, // 0 = principal
      } satisfies CuratedVideo;
    });
}
