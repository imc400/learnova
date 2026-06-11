import { schedules } from "@trigger.dev/sdk";
import { runReconciliation } from "@/lib/ops/reconcile";
import { alertFounder } from "@/lib/ops/alert";

/**
 * Cron de reconciliación (E-P0.3): cada 5 minutos repara pagos sin ruta,
 * webhooks perdidos, generaciones colgadas y correos atascados.
 *
 * Este cron vive DENTRO de Trigger.dev — si Trigger está caído (el peor
 * escenario: pagos quedan en draft), el doble disparador de vercel.json
 * (/api/admin/reconcile con CRON_SECRET) corre la misma lógica desde Vercel.
 * runReconciliation es idempotente: ambos pueden correr a la vez.
 */
export const reconcileTask = schedules.task({
  id: "reconcile",
  cron: "*/5 * * * *",
  maxDuration: 300,
  onFailure: async ({ error }) => {
    // La reconciliación es la red de seguridad: si ELLA falla, hay que saberlo.
    await alertFounder({
      severidad: "critical",
      titulo: "El cron de reconciliación FALLÓ",
      detalle:
        "runReconciliation lanzó un error no controlado. Mientras no corra, 'dinero cobrado sin producto' vuelve a ser invisible. Revisar el run en Trigger.dev. El cron de Vercel sigue cubriendo si está configurado CRON_SECRET.",
      contexto: { error: String(error).slice(0, 300) },
    });
  },
  run: async () => {
    const report = await runReconciliation();
    return report;
  },
});
