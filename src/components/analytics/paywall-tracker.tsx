"use client";

import { useEffect, type ReactNode } from "react";
import { fbqTrack } from "@/lib/analytics/meta";

/*
  Medición del PAYWALL (/app/pagar/[intentId]) para campañas de Meta:
  - ViewContent + Lead al montar. El eventID (`vc-`/`lead-` + intentId)
    deduplica recargas en Meta; Lead además se guarda en sessionStorage
    para no re-disparar en la misma sesión (la página se auto-refresca
    mientras se escribe el temario).
  - TrackCheckout: wrapper de los forms de oferta — InitiateCheckout en
    onClickCapture, que corre ANTES del submit de la server action sin
    tocarla (cero cambios en la lógica de pago).
*/

export function PaywallTracker({
  intentId,
  amountClp,
}: {
  intentId: string;
  amountClp: number;
}) {
  useEffect(() => {
    fbqTrack(
      "ViewContent",
      {
        value: amountClp,
        currency: "CLP",
        content_ids: [intentId],
        content_type: "product",
      },
      `vc-${intentId}`,
    );

    const leadKey = `aulia:meta-lead:${intentId}`;
    try {
      if (!sessionStorage.getItem(leadKey)) {
        fbqTrack("Lead", { value: amountClp, currency: "CLP" }, `lead-${intentId}`);
        sessionStorage.setItem(leadKey, "1");
      }
    } catch {
      // sessionStorage bloqueado (modo privado estricto): se dispara igual
      // sin guard local — el eventID sigue deduplicando en Meta.
      fbqTrack("Lead", { value: amountClp, currency: "CLP" }, `lead-${intentId}`);
    }
  }, [intentId, amountClp]);

  return null;
}

/** Envuelve un form de oferta: el click dispara InitiateCheckout y deja
 *  seguir el submit normal. `plan` separa el eventID de ruta y Pro (dos
 *  señales distintas que no deben deduplicarse entre sí). */
export function TrackCheckout({
  intentId,
  amountClp,
  plan,
  children,
}: {
  intentId: string;
  amountClp: number;
  plan: "ruta" | "pro";
  children: ReactNode;
}) {
  const eventId = plan === "pro" ? `ic-pro-${intentId}` : `ic-${intentId}`;
  return (
    <div
      onClickCapture={() =>
        fbqTrack("InitiateCheckout", { value: amountClp, currency: "CLP" }, eventId)
      }
    >
      {children}
    </div>
  );
}
