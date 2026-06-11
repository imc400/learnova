import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, cachedSystem } from "@/lib/ai/client";
import { MODELS, MAX_TOKENS } from "@/lib/ai/models";
import { VIDEO_RANKING_INSTRUCTIONS } from "@/lib/ai/prompts";
import { videoRankingSchema } from "@/lib/ai/schemas";
import { searchVideos, getVideoDetails } from "./client";
import type { CuratedVideo } from "./types";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { youtubeSearchCache } from "@/db/schema";

const SEARCH_CACHE_TTL_MS = 21 * 24 * 60 * 60 * 1000; // 21 días
// Resultados VACÍOS también se cachean, con TTL corto (E-P2): una query de
// nicho sin resultados re-quemaba 100-200 unidades en CADA generación.
const EMPTY_SEARCH_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 días

/**
 * Búsqueda en YouTube con CACHÉ (conserva cuota: search.list = 100 unidades).
 * Cachea los IDs por (query normalizada + idioma). Las políticas de YouTube
 * permiten almacenar IDs a largo plazo; el TTL es solo para frescura.
 */
async function cachedSearchIds(
  query: string,
  language: string,
  force = false,
): Promise<string[]> {
  const lang = (language || "es").slice(0, 2).toLowerCase();
  const cacheKey = `${query.toLowerCase().trim().replace(/\s+/g, " ")}::${lang}`;
  const [hit] = await db
    .select()
    .from(youtubeSearchCache)
    .where(eq(youtubeSearchCache.cacheKey, cacheKey))
    .limit(1);
  if (hit && Array.isArray(hit.videoIds)) {
    const age = Date.now() - hit.updatedAt.getTime();
    // Vacío fresco: NO re-buscar — ni siquiera con force (el force existe
    // para IDs caídos; un vacío reciente seguirá vacío y cuesta 100 u.).
    if (hit.videoIds.length === 0 && age < EMPTY_SEARCH_TTL_MS) {
      return [];
    }
    if (!force && hit.videoIds.length && age < SEARCH_CACHE_TTL_MS) {
      await db
        .update(youtubeSearchCache)
        .set({ timesReused: sql`${youtubeSearchCache.timesReused} + 1` })
        .where(eq(youtubeSearchCache.id, hit.id));
      return hit.videoIds;
    }
  }
  const ids = await searchVideos(query, { maxResults: 15, language });
  // Upsert SIEMPRE (incluso []): cachear el vacío es lo que protege la cuota.
  await db
    .insert(youtubeSearchCache)
    .values({ cacheKey, query, language: lang, videoIds: ids })
    .onConflictDoUpdate({
      target: youtubeSearchCache.cacheKey,
      set: { videoIds: ids, updatedAt: new Date() },
    });
  return ids;
}

/**
 * Cura el mejor video de YouTube para un paso de la ruta + alternativas.
 * Flujo: search (1 llamada) → videos.list (1 llamada) → ranking con Haiku
 * usando SOLO metadatos oficiales (sin transcripciones / sin scraping).
 */
export async function curateVideoForLesson(args: {
  query: string;
  objective: string;
  language: string;
  /** Tema de la RUTA — la relevancia temática manda sobre el idioma. */
  routeTopic?: string;
  /** Videos ya usados en la ruta (no repetir el mismo video entre lecciones). */
  excludeVideoIds?: Set<string>;
  keep?: number; // cuántos guardar (principal + alternativas)
}): Promise<CuratedVideo[]> {
  const keep = args.keep ?? 3;

  const target = (args.language || "es").slice(0, 2).toLowerCase();

  // Sesgar la búsqueda al idioma objetivo: un hint ("en español") surfacea
  // contenido en ese idioma aunque la query traiga jerga en inglés (CAPI, ABO…).
  // Si la query con hint no devuelve nada (frase rara), reintentamos sin hint.
  const HINTS: Record<string, string> = {
    es: "en español",
    pt: "em português",
    fr: "en français",
    it: "in italiano",
    de: "auf Deutsch",
  };
  const hint = HINTS[target];
  let ids = await cachedSearchIds(
    hint ? `${args.query} ${hint}` : args.query,
    args.language,
  );
  let allCandidates = await getVideoDetails(ids);
  if (allCandidates.length === 0) {
    // La query con hint no dio nada, o la caché devolvió IDs ya caídos:
    // fuerza una búsqueda fresca (sin caché) con la query base.
    ids = await cachedSearchIds(args.query, args.language, true);
    allCandidates = await getVideoDetails(ids);
  }
  // No repetir videos ya usados en otras lecciones de la misma ruta.
  if (args.excludeVideoIds?.size) {
    allCandidates = allCandidates.filter(
      (c) => !args.excludeVideoIds!.has(c.videoId),
    );
  }
  if (allCandidates.length === 0) return [];

  // --- FILTRO DE IDIOMA (suave cuando hay pocos candidatos) ---
  // defaultLanguage = idioma de AUDIO real. Preferimos el idioma del
  // estudiante, PERO la relevancia temática la decide el ranker: si solo hay
  // 1-2 "matches" de idioma, pasamos TODOS los candidatos para que un video
  // del tema correcto en otro idioma le gane a uno irrelevante en español
  // (caso real: video de ansiedad ganándole a tutoriales de fotografía).
  const langOf = (c: (typeof allCandidates)[number]) =>
    (c.defaultLanguage || "").slice(0, 2).toLowerCase();
  const matched = allCandidates.filter((c) => langOf(c) === target);
  const unknown = allCandidates.filter((c) => !c.defaultLanguage);
  const byLanguage =
    matched.length >= 3
      ? [...matched, ...unknown] // idioma abundante → excluye otros idiomas
      : allCandidates; // escasez → el ranker decide con relevancia primero

  // --- FILTRO DURO DE DURACIÓN (anti-Shorts) ---
  // Un Short no sostiene una lección: exige un mínimo real de contenido.
  // Solo si NO existe nada más largo se aceptan cortos (mejor algo que nada).
  const MIN_LESSON_SECONDS = 180;
  const longEnough = byLanguage.filter(
    (c) => (c.durationSeconds ?? 0) >= MIN_LESSON_SECONDS,
  );
  const candidates = longEnough.length ? longEnough : byLanguage;

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
          args.routeTopic ? `TEMA DE LA RUTA: ${args.routeTopic}` : "",
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
              // E-P1.5: el criterio de "recencia" del prompt del ranker se
              // alucinaba — ahora ve la fecha real de publicación.
              publishedAt: c.publishedAt,
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
        // Guardamos la señal REAL de YouTube (idioma de audio), no la de Haiku.
        language: c.defaultLanguage ?? r.language ?? args.language,
        score: r.score,
        reason: r.reason,
        rank: i, // 0 = principal
      } satisfies CuratedVideo;
    });
}
