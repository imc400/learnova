import { env } from "@/lib/env";

/*
  Cliente de Mercado Pago (Checkout Pro, Chile).
  - createPreference: crea la preferencia y devuelve el init_point (URL de pago).
  - getPayment: consulta un pago por id — la ÚNICA fuente de verdad para el
    webhook (jamás se confía en el body de la notificación).
  Doc: https://www.mercadopago.cl/developers/es/docs/checkout-pro
*/

const MP_BASE = "https://api.mercadopago.com";

function authHeaders() {
  if (!env.MP_ACCESS_TOKEN) throw new Error("[mp] Falta MP_ACCESS_TOKEN en .env");
  return {
    Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export interface CreatePreferenceInput {
  externalReference: string; // "intent_<uuid>"
  title: string;
  amountCLP: number;
  payerEmail: string;
  returnUrl: string; // a dónde vuelve el usuario
  notificationUrl: string; // webhook server-to-server
}

export async function createPreference(
  input: CreatePreferenceInput,
): Promise<{ initPoint: string; preferenceId: string }> {
  const res = await fetch(`${MP_BASE}/checkout/preferences`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      // Idempotencia: reintentar la MISMA preferencia no crea duplicados.
      "X-Idempotency-Key": input.externalReference,
    },
    body: JSON.stringify({
      items: [
        {
          id: input.externalReference,
          title: input.title,
          quantity: 1,
          currency_id: "CLP",
          unit_price: Math.round(input.amountCLP),
        },
      ],
      external_reference: input.externalReference,
      payer: { email: input.payerEmail },
      back_urls: {
        success: input.returnUrl,
        pending: input.returnUrl,
        failure: input.returnUrl,
      },
      auto_return: "approved",
      notification_url: input.notificationUrl,
      statement_descriptor: "AULIA",
      metadata: { source: "aulia-route-intent" },
    }),
  });
  if (!res.ok) {
    throw new Error(`[mp] preferences ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { id: string; init_point: string };
  return { initPoint: json.init_point, preferenceId: json.id };
}

export interface MpPayment {
  id: number;
  status: string; // approved | rejected | cancelled | in_process | pending | refunded
  externalReference: string | null;
  transactionAmount: number;
}

/** Consulta el pago real a la API (con NUESTRO token — la verdad). */
export async function getPayment(paymentId: string): Promise<MpPayment | null> {
  const res = await fetch(`${MP_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`[mp] get payment ${res.status}`);
  const j = (await res.json()) as {
    id: number;
    status: string;
    external_reference?: string | null;
    transaction_amount?: number;
  };
  return {
    id: j.id,
    status: j.status,
    externalReference: j.external_reference ?? null,
    transactionAmount: Number(j.transaction_amount ?? 0),
  };
}
