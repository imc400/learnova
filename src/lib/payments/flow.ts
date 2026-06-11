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

/**
 * createPayment con red de seguridad: Flow VERIFICA que el buzón exista
 * (error 1620) y eso convierte un typo del cliente en una venta perdida.
 * Si el correo es rechazado y hay respaldo configurado, se reintenta UNA
 * vez con FLOW_RECEIPT_FALLBACK_EMAIL — la boleta de Flow llega al respaldo
 * y la comunicación real con el cliente va por nuestros propios correos.
 */
export async function createPaymentSafe(
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  try {
    return await createPayment(input);
  } catch (e) {
    const fallback = env.FLOW_RECEIPT_FALLBACK_EMAIL;
    const emailInvalido = (e as Error).message?.includes("is not valid");
    if (!emailInvalido || !fallback || input.email === fallback) throw e;
    console.warn(
      `[flow] correo "${input.email}" rechazado (1620) — reintentando boleta con respaldo`,
    );
    return createPayment({ ...input, email: fallback });
  }
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

/* ============================================================
   SUSCRIPCIONES (plan → customer → tarjeta → subscription)
   Flujo: createCustomer una vez por usuario → registerCard (redirige a Flow
   a guardar la tarjeta) → al volver, getRegisterStatus confirma → SOLO
   entonces createSubscription (cargo automático mensual). Flow notifica cada
   cobro a la urlCallback del PLAN con un POST {token} → verificar con
   getPaymentStatus (firmado). Montos mínimos: 350 CLP.
   ============================================================ */

async function flowPost<T>(path: string, params: Record<string, string>): Promise<T> {
  const { apiKey, secretKey } = creds();
  const all = { ...params, apiKey };
  const s = sign(all, secretKey);
  const res = await fetch(`${env.FLOW_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toForm(all, s),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`[flow] ${path} ${res.status}: ${body.slice(0, 250)}`);
  return JSON.parse(body) as T;
}

async function flowGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const { apiKey, secretKey } = creds();
  const all = { ...params, apiKey };
  const s = sign(all, secretKey);
  const qs = new URLSearchParams({ ...all, s }).toString();
  const res = await fetch(`${env.FLOW_BASE_URL}${path}?${qs}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`[flow] ${path} ${res.status}: ${body.slice(0, 250)}`);
  return JSON.parse(body) as T;
}

/** Crea el plan de suscripción (una vez, vía script). interval 3 = mensual. */
export async function createPlan(args: {
  planId: string;
  name: string;
  amountCLP: number;
  urlCallback: string;
}) {
  return flowPost<{ planId: string; status: number }>("/plans/create", {
    planId: args.planId,
    name: args.name,
    currency: "CLP",
    amount: String(Math.round(args.amountCLP)),
    interval: "3",
    urlCallback: args.urlCallback,
  });
}

/** Customer de Flow (1 por usuario; externalId = UUID de Supabase). */
export async function createCustomer(args: {
  name: string;
  email: string;
  externalId: string;
}): Promise<{ customerId: string }> {
  return flowPost<{ customerId: string }>("/customer/create", {
    name: args.name,
    email: args.email,
    externalId: args.externalId,
  });
}

/** Inicia el registro de tarjeta: devuelve URL de Flow a la que redirigir. */
export async function registerCard(args: {
  customerId: string;
  urlReturn: string;
}): Promise<{ redirectUrl: string }> {
  const r = await flowPost<{ url: string; token: string }>("/customer/register", {
    customerId: args.customerId,
    url_return: args.urlReturn, // snake_case — así lo exige Flow
  });
  return { redirectUrl: `${r.url}?token=${r.token}` };
}

/** Confirma si la tarjeta quedó registrada (status "1" = sí). */
export async function getRegisterStatus(token: string): Promise<{
  status: string;
  customerId: string;
  creditCardType: string | null;
  last4CardDigits: string | null;
}> {
  return flowGet("/customer/getRegisterStatus", { token });
}

export interface FlowSubscription {
  subscriptionId: string;
  planId: string;
  customerId: string;
  status: number; // 0 inactiva · 1 activa · 2 trial · 4 cancelada
  morose: number; // 0 al día · 1 vencidos · 2 pendientes
  period_start: string;
  period_end: string;
  next_invoice_date: string;
  cancel_at_period_end: number;
}

/** Crea la suscripción (cobra YA si hay tarjeta registrada). */
export async function createSubscription(args: {
  planId: string;
  customerId: string;
}): Promise<FlowSubscription> {
  return flowPost<FlowSubscription>("/subscription/create", {
    planId: args.planId,
    customerId: args.customerId,
  });
}

/** Cancela: at_period_end=1 conserva acceso hasta el fin del período. */
export async function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd = true,
): Promise<FlowSubscription> {
  return flowPost<FlowSubscription>("/subscription/cancel", {
    subscriptionId,
    at_period_end: atPeriodEnd ? "1" : "0",
  });
}

/** Estado actual de una suscripción (para webhook y cron de conciliación). */
export async function getSubscription(subscriptionId: string): Promise<FlowSubscription> {
  return flowGet<FlowSubscription>("/subscription/get", { subscriptionId });
}
