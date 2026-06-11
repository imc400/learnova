import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { env } from "@/lib/env";

/** Cliente Anthropic singleton (para los jobs de generación del servidor).
 *  maxRetries 4 + timeout 120s (A-P1.8): el pipeline corre en Trigger.dev sin
 *  un usuario esperando la respuesta — preferimos reintentar 429/529 con el
 *  backoff del SDK a tumbar una lección por un pico de carga. */
let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      maxRetries: 4,
      timeout: 120_000,
    });
  }
  return _client;
}

/**
 * System prompt de UN bloque con cache_control.
 *
 * REALIDAD del prompt caching (el comentario anterior era falso): el prefijo
 * mínimo cacheable es 2048 tokens en Sonnet 4.6 y 4096 en Opus 4.8 / Haiku
 * 4.5 — bajo eso el marcador se IGNORA en silencio (cache_creation = 0, sin
 * error). Los prompts cortos que usan este helper (wizard, persona, ranker,
 * emails) NO cachean nada; se conserva por compatibilidad de call-sites de
 * otros tracks y porque el marcador ignorado es inocuo.
 * Para el volumen real (lección + quiz en Sonnet, ~50 llamadas/ruta fresca)
 * usa cachedSharedSystem: su bloque compartido SÍ supera el mínimo.
 * TTL 5 min (write 1.25x) y no 1h (write 2x): las llamadas de una ruta caen
 * dentro de la misma ventana — el TTL largo solo encarecía la escritura.
 */
export function cachedSystem(text: string) {
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/**
 * System de DOS bloques para el volumen Sonnet (lección, quiz, módulo de
 * refuerzo) — A-P1.2:
 * [0] bloque COMPARTIDO y estable (pedagogía + reglas de coherencia + few-shot
 *     de lección excelente; >2048 tokens A PROPÓSITO) con cache_control →
 *     se escribe 1 vez por ventana de 5 min y todas las llamadas de la ruta
 *     lo leen a ~0.1x. Se comparte entre lección y quiz porque el caché es
 *     por PREFIJO: ambos requests (mismo modelo, sin tools) abren con bytes
 *     idénticos hasta el breakpoint.
 * [1] bloque específico de la tarea, DESPUÉS del breakpoint → variarlo no
 *     invalida el prefijo compartido.
 * Verificación: columna cache_read de ai_usage (>0 = por fin cachea).
 */
export function cachedSharedSystem(shared: string, taskSpecific: string) {
  return [
    {
      type: "text" as const,
      text: shared,
      cache_control: { type: "ephemeral" as const },
    },
    { type: "text" as const, text: taskSpecific },
  ];
}

/** Metadatos de tracking de una llamada. label opcional: cada generador de
 *  generate.ts pone su etiqueta por defecto (planner.skeleton, generator.lesson…). */
export type AiTracking = { label?: string; pathId?: string | null };

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Persiste res.usage en ai_usage (instrumentación del track A): costo real
 * por ruta fresca vs cacheada y % de cache-hit de prompts. JAMÁS lanza — la
 * contabilidad no puede tumbar la generación que contabiliza.
 */
export async function trackUsage(
  meta: AiTracking,
  model: string,
  usage: UsageLike | null | undefined,
): Promise<void> {
  if (!usage) return;
  const row = {
    label: meta.label ?? "sin_label",
    pathId: meta.pathId ?? null,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
  // Log de verificación del prompt caching (A-P1.2): cacheRead > 0 = cachea.
  console.log(
    `[ai] ${row.label} ${model} in=${row.inputTokens} out=${row.outputTokens} cacheRead=${row.cacheRead} cacheWrite=${row.cacheWrite}`,
  );
  try {
    await db.insert(aiUsage).values(row);
  } catch (e) {
    console.error("[ai] ai_usage no registrado (no propaga):", e);
  }
}
