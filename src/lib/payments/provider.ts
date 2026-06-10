import { env } from "@/lib/env";

/**
 * Proveedor ACTIVO de pagos one-time. Decisión por env (PAYMENT_PROVIDER):
 * cambiar de Flow ↔ Mercado Pago es editar una variable en Vercel, sin tocar
 * código. Si el elegido no tiene credenciales, cae al que sí las tenga.
 */
export function activeProvider(): "flow" | "mercadopago" {
  if (env.PAYMENT_PROVIDER === "flow" && env.FLOW_API_KEY && env.FLOW_SECRET_KEY) {
    return "flow";
  }
  if (env.MP_ACCESS_TOKEN) return "mercadopago";
  return "flow";
}

export function providerLabel(): string {
  return activeProvider() === "flow" ? "Flow" : "Mercado Pago";
}
