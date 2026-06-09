import { task } from "@trigger.dev/sdk";
import { processOutboxEmail } from "@/lib/email/process";

/**
 * Envía un correo de avance desde el outbox. Reintentos exponenciales; la
 * idempotencia vive en la BD (UNIQUE del outbox + claim por status), así que
 * at-least-once del runtime se vuelve effectively-once para el usuario.
 */
export const sendProgressEmailTask = task({
  id: "send-progress-email",
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },
  run: async (payload: { outboxId: string }) => {
    const result = await processOutboxEmail(payload.outboxId);
    console.log(`[trigger] send-progress-email ${payload.outboxId}: ${result}`);
    return { result };
  },
});
