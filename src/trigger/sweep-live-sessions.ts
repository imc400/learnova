import { schedules } from "@trigger.dev/sdk";
import { sweepOrphanSessions, recoverMissingSummaries } from "@/lib/live/sweep";

/**
 * Cron cada 15 min: cierra sesiones de clase huérfanas (pestaña muerta) con
 * su duración REAL y dispara el resumen + correo de tareas — el correo llega
 * aunque el alumno jamás vuelva a la plataforma (pedido #1 del fundador).
 * Segundo paso: re-dispara resúmenes de sesiones cerradas que quedaron sin
 * resumen (enqueue perdido). Todo idempotente: claim por `summary` + outbox.
 */
export const sweepLiveSessionsTask = schedules.task({
  id: "sweep-live-sessions",
  cron: "*/15 * * * *",
  maxDuration: 300,
  run: async () => {
    const sweep = await sweepOrphanSessions();
    const recovered = await recoverMissingSummaries();
    console.log("[trigger] sweep-live-sessions:", { ...sweep, recovered });
    return { ...sweep, recovered };
  },
});
