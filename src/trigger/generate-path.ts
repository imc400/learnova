import { task } from "@trigger.dev/sdk";
import { runPathGeneration } from "@/lib/generation/run";

/** Job de generación de ruta (Opus → Sonnet → Haiku + curación de video). */
export const generatePathTask = task({
  id: "generate-path",
  // 45 min: el pipeline con digests de video + coverage gate + quiz grounded
  // supera los 20 min en rutas frescas de ~25 lecciones. Si aún así se corta,
  // el reintento RESUME vía lesson_content_cache (lo hecho no se re-paga).
  maxDuration: 2700,
  // Backoff exponencial (evita golpear el rate limit de Anthropic en 429).
  // Seguro reintentar porque runPathGeneration es idempotente (upserts + guard).
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000 },
  onFailure: async ({ payload, error }) => {
    console.error("[trigger] generate-path falló definitivamente", {
      pathId: payload.pathId,
      error,
    });
  },
  run: async (payload: { pathId: string }) => {
    await runPathGeneration(payload.pathId);
    return { pathId: payload.pathId, ok: true };
  },
});
