import { task } from "@trigger.dev/sdk";
import { summarizeClass } from "@/lib/live/summarize";

/**
 * Post-clase: transcripción → resumen + tareas + memoria + correo.
 * Reintentos seguros: summarizeClass es idempotente (guard por summary ya
 * escrita y dedupe del outbox por sessionId).
 */
export const summarizeClassTask = task({
  id: "summarize-class",
  maxDuration: 300,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 15_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { sessionId: string }) => {
    const result = await summarizeClass(payload.sessionId);
    console.log(`[trigger] summarize-class ${payload.sessionId}: ${result}`);
    return { result };
  },
});
