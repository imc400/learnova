import { task } from "@trigger.dev/sdk/v3";
import { runPathGeneration } from "@/lib/generation/run";

/** Job de generación de ruta (Opus → Sonnet → Haiku + curación de video). */
export const generatePathTask = task({
  id: "generate-path",
  maxDuration: 1200,
  // Backoff exponencial (evita golpear el rate limit de Anthropic en 429).
  // Seguro reintentar porque runPathGeneration es idempotente (upserts + guard).
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000 },
  onFailure: async (payload: { pathId: string }, error: unknown) => {
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
