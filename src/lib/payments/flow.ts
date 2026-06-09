import crypto from "node:crypto";
import { env } from "@/lib/env";

/*
  Cliente de Flow.cl (pagos en Chile). Flow firma los parámetros con HMAC-SHA256
  sobre los pares ordenados alfabéticamente, usando el secretKey.
  DOC oficial: https://www.flow.cl/docs/api.html
  ⚠️ Verifica endpoints y campos exactos contra la doc vigente de Flow antes de
     producción. Flow cobra en CLP (no USD).
*/

function creds() {
  if (!env.FLOW_API_KEY || !env.FLOW_SECRET_KEY) {
    throw new Error("Faltan FLOW_API_KEY / FLOW_SECRET_KEY en .env");
  }
  return { apiKey: env.FLOW_API_KEY, secretKey: env.FLOW_SECRET_KEY };
}

/** Firma Flow: concatena `${k}${v}` de los params ordenados y aplica HMAC-SHA256. */
function sign(params: Record<string, string>, secretKey: string): string {
  const sorted = Object.keys(params).sort();
  const toSign = sorted.map((k) => `${k}${params[k]}`).join("");
  return crypto.createHmac("sha256", secretKey).update(toSign).digest("hex");
}

function toForm(params: Record<string, string>, s: string): string {
  const body = new URLSearchParams(params);
  body.set("s", s);
  return body.toString();
}

export interface CreatePaymentInput {
  commerceOrder: string; // nuestro id interno (ej. "path_<uuid>")
  subject: string;
  amountCLP: number;
  email: string;
  urlConfirmation: string; // webhook (server-to-server)
  urlReturn: string; // a dónde vuelve el usuario
}

export interface CreatePaymentResult {
  url: string;
  token: string;
  flowOrder: number;
  redirectUrl: string;
}

/** Crea un pago (one-time). Para suscripción ver nota al pie. */
export async function createPayment(
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  const { apiKey, secretKey } = creds();
  const params: Record<string, string> = {
    apiKey,
    commerceOrder: input.commerceOrder,
    subject: input.subject,
    currency: "CLP",
    amount: String(Math.round(input.amountCLP)),
    email: input.email,
    urlConfirmation: input.urlConfirmation,
    urlReturn: input.urlReturn,
    paymentMethod: "9", // todos los medios
  };
  const s = sign(params, secretKey);

  const res = await fetch(`${env.FLOW_BASE_URL}/payment/create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toForm(params, s),
  });
  if (!res.ok) throw new Error(`Flow payment/create falló: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { url: string; token: string; flowOrder: number };
  return { ...data, redirectUrl: `${data.url}?token=${data.token}` };
}

export interface FlowStatus {
  status: number; // 1 pendiente · 2 pagado · 3 rechazado · 4 anulado
  commerceOrder: string;
  flowOrder: number;
  amount: string;
  payer: string;
}

/** Consulta el estado de un pago por su token (usado por el webhook). */
export async function getPaymentStatus(token: string): Promise<FlowStatus> {
  const { apiKey, secretKey } = creds();
  const params: Record<string, string> = { apiKey, token };
  const s = sign(params, secretKey);
  const qs = new URLSearchParams({ ...params, s }).toString();

  const res = await fetch(`${env.FLOW_BASE_URL}/payment/getStatus?${qs}`);
  if (!res.ok) throw new Error(`Flow getStatus falló: ${res.status}`);
  return (await res.json()) as FlowStatus;
}

/*
  SUSCRIPCIÓN RECURRENTE ($15/mes): Flow requiere crear primero un "plan" y un
  "customer" y luego una "subscription" (endpoints /plans, /customer, /subscription).
  Para v1 la suscripción Pro puede modelarse como pago recurrente con el plan de
  Flow; implementar `createSubscription()` siguiendo
  https://www.flow.cl/docs/api.html#tag/subscription una vez creado el plan en el
  panel de Flow. El webhook de abajo ya distingue commerceOrder "sub_…".
*/
