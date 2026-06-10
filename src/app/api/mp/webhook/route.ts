import { NextResponse } from "next/server";
import { getPayment } from "@/lib/payments/mercadopago";
import { confirmIntentPaid, markIntentFailed } from "@/lib/payments/confirm-intent";

/*
  Webhook de Mercado Pago. MP notifica de dos formas (ambas soportadas):
  - Webhooks: POST con body { type: "payment", data: { id } }
  - IPN clásico: POST con query ?topic=payment&id=<paymentId>
  La notificación es solo un AVISO: la verdad se consulta a la API de MP con
  nuestro access token. La lógica de dinero vive en confirm-intent.ts
  (idempotente, compartida con Flow).
*/

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    let paymentId =
      url.searchParams.get("data.id") ??
      (url.searchParams.get("topic") === "payment"
        ? url.searchParams.get("id")
        : null);

    if (!paymentId) {
      const body = (await req.json().catch(() => null)) as {
        type?: string;
        action?: string;
        data?: { id?: string | number };
      } | null;
      if (body?.type === "payment" || body?.action?.startsWith("payment.")) {
        paymentId = String(body.data?.id ?? "");
      }
    }
    // Notificaciones que no son de pago (merchant_order, etc.) → 200 y listo.
    if (!paymentId || !/^\d{5,20}$/.test(paymentId)) {
      return NextResponse.json({ ok: true });
    }

    const payment = await getPayment(paymentId);
    if (!payment) return NextResponse.json({ ok: true });

    const ref = payment.externalReference ?? "";
    if (!ref.startsWith("intent_")) return NextResponse.json({ ok: true });
    const intentId = ref.slice(7);
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return NextResponse.json({ ok: true });

    if (payment.status === "approved") {
      await confirmIntentPaid({
        intentId,
        provider: "mercadopago",
        chargedAmountClp: Math.round(payment.transactionAmount),
      });
    } else if (payment.status === "rejected" || payment.status === "cancelled") {
      await markIntentFailed(intentId);
    }
    // pending / in_process: no hacer nada — MP volverá a notificar.

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mp webhook]", err);
    // 500 → MP reintenta con backoff (confirmIntentPaid es idempotente).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
