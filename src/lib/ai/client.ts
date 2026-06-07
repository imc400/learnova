import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/** Cliente Anthropic singleton (para los jobs de generación del servidor). */
let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Construye un system prompt cacheable (prompt caching de Anthropic).
 * Las lecturas de caché cuestan ~0.1x → base de la "caché de cabeza gruesa".
 * TTL 1h para que el system pedagógico (estable) se reutilice entre usuarios.
 */
export function cachedSystem(text: string) {
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
  ];
}
