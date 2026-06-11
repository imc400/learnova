"use client";

import { useEffect } from "react";
import { fbqTrack } from "@/lib/analytics/meta";

/*
  Purchase del lado del navegador — el evento clave de las campañas.
  Se monta en /app/rutas/[pathId] cuando los redirects post-pago llegan con
  ?compra=<id>&monto=<clp>:
  - compra = intentId (ruta) o `prom-<purchaseId>` (Pro manual).
  - eventID `purchase-<compra>` ES el mismo que manda la Conversions API
    (sendCapiPurchase) → Meta deduplica navegador vs servidor.
  - Guard en localStorage por id de compra: una visita repetida con la URL
    guardada en el historial no re-dispara.
  - Limpia compra/monto de la URL con history.replaceState (ni se ve fea
    ni queda re-disparable al compartirla).
*/

export function PurchaseTracker({
  compra,
  monto,
}: {
  compra: string;
  monto: number;
}) {
  useEffect(() => {
    const key = `aulia:meta-purchase:${compra}`;
    try {
      if (!localStorage.getItem(key)) {
        fbqTrack(
          "Purchase",
          { value: monto, currency: "CLP" },
          `purchase-${compra}`,
        );
        localStorage.setItem(key, "1");
      }
    } catch {
      // localStorage bloqueado: disparar igual — el eventID deduplica en Meta.
      fbqTrack("Purchase", { value: monto, currency: "CLP" }, `purchase-${compra}`);
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("compra");
      url.searchParams.delete("monto");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Nada: la URL fea no rompe nada.
    }
  }, [compra, monto]);

  return null;
}
