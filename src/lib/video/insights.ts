import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { videoInsights } from "@/db/schema";
import { env } from "@/lib/env";

/*
  Entendimiento de video ToS-SAFE (el corazón de la coherencia lección↔video↔quiz).
  - Provider primario: Gemini 2.5 Flash-Lite con la URL de YouTube como input
    (Google procesando su propio contenido — la ÚNICA vía legal; PROHIBIDO
    scraping de transcripts: violaría la auditoría de la Data API).
  - El digest se cachea por (videoId, idioma) SIN TTL: es output de Gemini, no
    metadato de la Data API (la regla de 30 días no aplica). Se calcula UNA vez
    en la vida de la plataforma y se comparte entre rutas y usuarios.
  - Post-validación obligatoria (hallazgo del spike): Gemini puede alucinar
    timestamps más allá de la duración real → se filtran en código.
  - Nunca lanza: si Gemini falla/timeout, devuelve null y la lección se genera
    sin anclaje (igual que hoy). El pipeline jamás se frena por un digest.
*/

// outline y quizAnchors son el corazón (estrictos); el resto tolera la forma
// imperfecta que Gemini a veces emite (catch → default, no se pierde el digest).
export const videoDigestSchema = z.object({
  outline: z.array(
    z.object({ timestampSeconds: z.coerce.number(), topic: z.coerce.string() }),
  ),
  keyConcepts: z.array(z.coerce.string()).catch([]),
  examples: z
    .array(
      z.object({
        timestampSeconds: z.coerce.number(),
        description: z.coerce.string(),
      }),
    )
    .catch([]),
  terminology: z.array(z.coerce.string()).catch([]),
  quizAnchors: z.array(
    z.object({
      timestampSeconds: z.coerce.number(),
      fact: z.coerce.string(),
      questionIdea: z.coerce.string().catch(""),
    }),
  ),
  coverage: z.coerce
    .number()
    .catch(0.7)
    .describe("0-1: cuánto del objetivo de la lección cubre el video"),
  coverageNotes: z.coerce.string().catch(""),
  apparentLevel: z.coerce.string().catch(""),
  audioLanguage: z.coerce
    .string()
    .catch("es")
    .describe("idioma del AUDIO hablado (ISO 639-1)"),
});
export type VideoDigest = z.infer<typeof videoDigestSchema>;

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_TIMEOUT_MS = 75_000; // videos de ~25 min tardan ~30-40s

function digestPrompt(lessonSummary: string, language: string): string {
  return [
    "Analiza este video educativo de YouTube y devuelve SOLO un JSON válido (sin markdown, sin texto extra) con esta forma exacta:",
    `{"outline":[{"timestampSeconds":number,"topic":string}],"keyConcepts":[string],"examples":[{"timestampSeconds":number,"description":string}],"terminology":[string],"quizAnchors":[{"timestampSeconds":number,"fact":string,"questionIdea":string}],"coverage":number,"coverageNotes":string,"apparentLevel":string,"audioLanguage":string}`,
    "",
    `Todo el texto en ${language === "es" ? "español" : language}. Reglas:`,
    "- outline: temario real del video con el segundo donde empieza cada tema.",
    "- quizAnchors: 6-10 hechos CITABLES que el video realmente afirma, distribuidos por TODO el video, cada uno con su timestamp y una idea de pregunta.",
    "- terminology: términos exactos que usa el creador (para que la lección hable su mismo idioma).",
    `- coverage: número 0-1 de cuánto cubre el video este objetivo de lección: "${lessonSummary}".`,
    "  IMPORTANTE: si el video enseña el tema con un MEDIO/HERRAMIENTA distinta a la del objetivo (p.ej. cámara DSLR cuando el objetivo dice celular, u otra app/software), el coverage MÁXIMO es 0.4 — el estudiante necesita ver SU herramienta.",
    "- coverageNotes: qué del objetivo NO cubre el video (para que la lección lo complemente).",
    "- audioLanguage: idioma del AUDIO hablado (código ISO 639-1, ej: es, en).",
    "- timestampSeconds SIEMPRE dentro de la duración real del video.",
  ].join("\n");
}

/** Filtra timestamps imposibles (hallazgo del spike) y normaliza el digest. */
function postValidate(
  digest: VideoDigest,
  durationSeconds: number | null,
): VideoDigest | null {
  const max = durationSeconds ? durationSeconds + 5 : Infinity;
  const inRange = (t: number) => t >= 0 && t <= max;
  const cleaned: VideoDigest = {
    ...digest,
    outline: digest.outline.filter((o) => inRange(o.timestampSeconds)),
    examples: digest.examples.filter((e) => inRange(e.timestampSeconds)),
    quizAnchors: digest.quizAnchors.filter((a) => inRange(a.timestampSeconds)),
    coverage: Math.min(1, Math.max(0, digest.coverage)),
  };
  // Sin un mínimo de anclas válidas el digest no sirve para grounding.
  if (cleaned.quizAnchors.length < 3 || cleaned.outline.length < 2) return null;
  return cleaned;
}

async function fetchGeminiDigest(
  videoId: string,
  lessonSummary: string,
  language: string,
  durationSeconds: number | null,
): Promise<VideoDigest | null> {
  if (!env.GEMINI_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
                { text: digestPrompt(lessonSummary, language) },
              ],
            },
          ],
          generationConfig: {
            mediaResolution: "MEDIA_RESOLUTION_LOW",
            temperature: 0.2,
          },
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[video] Gemini HTTP ${res.status} (video ${videoId})`);
      return null;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "";
    const clean = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = videoDigestSchema.safeParse(JSON.parse(clean));
    if (!parsed.success) {
      console.warn(`[video] digest inválido (video ${videoId}):`, parsed.error.issues[0]?.message);
      return null;
    }
    return postValidate(parsed.data, durationSeconds);
  } catch (err) {
    console.warn(`[video] Gemini falló (video ${videoId}):`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface VideoInsightResult {
  digest: VideoDigest;
  source: string; // gemini | metadata
  cached: boolean;
}

/**
 * Digest de un video, con caché permanente por (videoId, idioma).
 * Devuelve null si no hay key, el video no se pudo procesar o el digest no
 * pasó la post-validación — el caller genera la lección sin anclaje.
 */
export async function getVideoInsights(args: {
  videoId: string;
  lessonSummary: string;
  language: string;
  durationSeconds: number | null;
}): Promise<VideoInsightResult | null> {
  const { videoId, lessonSummary, language, durationSeconds } = args;

  // 1) Caché (hit = gratis, compartido entre todos los usuarios).
  const [hit] = await db
    .select()
    .from(videoInsights)
    .where(
      and(
        eq(videoInsights.youtubeVideoId, videoId),
        eq(videoInsights.language, language),
      ),
    )
    .limit(1);
  if (hit) {
    await db
      .update(videoInsights)
      .set({ timesReused: sql`${videoInsights.timesReused} + 1`, updatedAt: new Date() })
      .where(eq(videoInsights.id, hit.id));
    return {
      digest: hit.digest as VideoDigest,
      source: hit.source,
      cached: true,
    };
  }

  // 2) Gemini (único provider con entendimiento real; sin fallback que invente).
  //    Un reintento: el modelo a veces emite JSON con la forma equivocada y la
  //    segunda pasada suele corregirlo (temperatura baja, mismo prompt).
  let digest = await fetchGeminiDigest(videoId, lessonSummary, language, durationSeconds);
  if (!digest) {
    digest = await fetchGeminiDigest(videoId, lessonSummary, language, durationSeconds);
  }
  if (!digest) return null;

  // 3) Persistir (carrera segura: si otro worker lo insertó, usamos el suyo).
  await db
    .insert(videoInsights)
    .values({
      youtubeVideoId: videoId,
      language,
      source: "gemini",
      digest,
      audioLanguage: digest.audioLanguage,
      durationSeconds,
      model: GEMINI_MODEL,
    })
    .onConflictDoNothing({
      target: [videoInsights.youtubeVideoId, videoInsights.language],
    });

  return { digest, source: "gemini", cached: false };
}
