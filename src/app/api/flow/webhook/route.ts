import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pathPurchases } from "@/db/schema";
import { getPaymentStatus } from "@/lib/payments/flow";
import { confirmIntentPaid, markIntentFailed } from "@/lib/payments/confirm-intent";
import { confirmProMonthPaid, markProMonthFailed } from "@/lib/payments/confirm-pro";

/**
 * Webhook de confirmación de Flow (server-to-server). Flow envía `token`;
 * consultamos el estado real con petición FIRMADA y actualizamos la DB.
 * Nunca confiamos en el body del webhook. La lógica de dinero de los intents
 * vive en confirm-intent.ts (compartida con Mercado Pago).
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    // Solo formatos de token plausibles llegan a Flow (anti banging del endpoint).
    if (!/^[\w-]{8,128}$/.test(token)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const status = await getPaymentStatus(token);
    const order = status.commerceOrder;

    // status 3 (rechazado) / 4 (anulado) → 'failed' (jamás un limbo silencioso).
    if (status.status === 3 || status.status === 4) {
      if (order.startsWith("intent_")) await markIntentFailed(order.slice(7));
      else if (order.startsWith("prom_")) await markProMonthFailed(order.slice(5));
      return NextResponse.json({ ok: true });
    }

    // status === 2 → pagado
    if (status.status === 2) {
      if (order.startsWith("intent_")) {
        await confirmIntentPaid({
          intentId: order.slice(7),
          provider: "flow",
          chargedAmountClp: Number(status.amount) || 0,
        });
      } else if (order.startsWith("prom_")) {
        // Pro manual: 1 cobro = 30 días de Pro (confirm-pro es idempotente).
        await confirmProMonthPaid({
          purchaseId: order.slice(5),
          chargedAmountClp: Number(status.amount) || 0,
        });
      } else if (order.startsWith("path_")) {
        await db
          .update(pathPurchases)
          .set({ status: "paid" })
          .where(eq(pathPurchases.id, order.slice(5)));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[flow webhook]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
