import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/*
  Meta Conversions API (server-side) — fase 2 de la medición de ads.
  Manda el Purchase desde el servidor con el MISMO event_id que el píxel del
  navegador (`purchase-<intentId>` / `purchase-prom-<purchaseId>`): Meta
  deduplica y la conversión se registra aunque el comprador tenga bloqueador
  de ads o jamás aterrice de vuelta en la app.

  Gateada: con META_CAPI_ACCESS_TOKEN vacío es un no-op total. Y JAMÁS lanza
  hacia el flujo de pago — todo el cuerpo está en try/catch.
*/

const GRAPH_URL = "https://graph.facebook.com/v21.0";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalización que exige Meta antes de hashear el email. */
function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

/** Teléfono: solo dígitos, con código de país 56 (Chile) por delante. */
function hashPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  if (!digits.startsWith("56")) digits = `56${digits}`;
  return sha256(digits);
}

export async function sendCapiPurchase(args: {
  /** MISMO eventID que dispara el navegador (dedup en Meta). */
  eventId: string;
  valueClp: number;
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  try {
    const token = env.META_CAPI_ACCESS_TOKEN;
    const pixelId = env.NEXT_PUBLIC_META_PIXEL_ID;
    if (!token || !pixelId) return; // fase 2 apagada

    const userData: Record<string, string[]> = {};
    if (args.email?.trim()) userData.em = [hashEmail(args.email)];
    const ph = args.phone ? hashPhone(args.phone) : null;
    if (ph) userData.ph = [ph];

    const body = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: args.eventId,
          action_source: "website",
          user_data: userData,
          custom_data: { value: args.valueClp, currency: "CLP" },
        },
      ],
    };

    const res = await fetch(
      `${GRAPH_URL}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      console.error(
        `[meta-capi] ${args.eventId}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`,
      );
    }
  } catch (e) {
    // Best-effort: analytics jamás rompe (ni retrasa indefinidamente) un pago.
    console.error(`[meta-capi] ${args.eventId}:`, e);
  }
}
