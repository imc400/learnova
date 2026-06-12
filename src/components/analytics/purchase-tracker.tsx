"use client";

import { useEffect } from "react";
import { fbqTrack } from "@/lib/analytics/meta";
import { gtagConversion } from "@/lib/analytics/gtag";
import { env } from "@/lib/env";

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
    // Conversión de compra para Meta (Purchase) y Google Ads (conversion), con
    // el MISMO id de compra: eventID en Meta y transaction_id en Google ambos
    // deduplican una recarga con la URL guardada en el historial.
    const fire = () => {
      fbqTrack("Purchase", { value: monto, currency: "CLP" }, `purchase-${compra}`);
      // Google Ads solo si hay etiqueta de conversión de compra configurada.
      if (env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL) {
        gtagConversion(env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL, {
          value: monto,
          currency: "CLP",
          transactionId: `purchase-${compra}`,
        });
      }
    };
    const key = `aulia:purchase-tracked:${compra}`;
    try {
      if (!localStorage.getItem(key)) {
        fire();
        localStorage.setItem(key, "1");
      }
    } catch {
      // localStorage bloqueado: disparar igual — los ids deduplican aguas abajo.
      fire();
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
