import { task } from "@trigger.dev/sdk";
import { extendPathWithModule } from "@/lib/generation/extend";

/**
 * El profesor propuso un módulo EN CLASE → aquí se genera de verdad
 * (módulo + lecciones + videos curados + quizzes) y se avisa por correo.
 * Reintentos seguros: extendPathWithModule dedupea por título teacher
 * existente y el outbox dedupea el correo por moduleId.
 */
export const extendPathTask = task({
  id: "extend-path",
  maxDuration: 1800, // un módulo fresco con digests puede tomar varios minutos
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
  },
  run: async (payload: {
    pathId: string;
    sessionId: string;
    title: string;
    reason: string;
  }) => {
    const result = await extendPathWithModule({
      pathId: payload.pathId,
      sessionId: payload.sessionId,
      requestedTitle: payload.title,
      reason: payload.reason,
    });
    console.log(`[trigger] extend-path ${payload.pathId}: ${result}`);
    return { result };
  },
});
