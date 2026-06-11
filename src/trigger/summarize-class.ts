import { task } from "@trigger.dev/sdk";
import { summarizeClass } from "@/lib/live/summarize";
import { alertFounder } from "@/lib/ops/alert";

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
  onFailure: async ({ payload, error }) => {
    // El correo de tareas es el pedido #1 del fundador: si murió tras 3
    // intentos, se entera él — no el silencio. summarize-class re-disparado
    // a mano (o por el cron de barrido) sigue siendo idempotente.
    console.error("[trigger] summarize-class falló definitivamente", {
      sessionId: payload.sessionId,
      error,
    });
    await alertFounder({
      titulo: "Resumen de clase MURIÓ tras 3 intentos (correo de tareas no enviado)",
      detalle:
        "El destilado post-clase falló definitivamente: el alumno NO recibió su correo de resumen y tareas. Revisar el run en Trigger.dev; re-disparar summarize-class es seguro (idempotente).",
      contexto: { sessionId: payload.sessionId, error: String(error).slice(0, 300) },
    });
  },
  run: async (payload: { sessionId: string }) => {
    const result = await summarizeClass(payload.sessionId);
    console.log(`[trigger] summarize-class ${payload.sessionId}: ${result}`);
    return { result };
  },
});
