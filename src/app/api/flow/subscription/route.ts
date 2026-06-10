import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions } from "@/db/schema";
import { getPaymentStatus, getSubscription } from "@/lib/payments/flow";

/*
  urlCallback del PLAN aulia_pro: Flow avisa cada cobro recurrente con un
  POST {token}. La verdad se consulta firmada (getPaymentStatus) y el período
  se extiende desde subscription/get — idempotente: reprocesar el mismo aviso
  re-escribe el mismo period_end.
*/

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    if (!/^[\w-]{8,128}$/.test(token)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const status = await getPaymentStatus(token);
    if (status.status !== 2) return NextResponse.json({ ok: true }); // no pagado: nada

    // El pago de plan llega con el email del pagador → usuario → suscripción.
    const payerEmail = (status.payer ?? "").toLowerCase();
    if (!payerEmail) return NextResponse.json({ ok: true });

    const [me] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, payerEmail))
      .limit(1);
    if (!me) {
      console.error(`[flow sub] pago de plan sin usuario: ${payerEmail}`);
      return NextResponse.json({ ok: true });
    }

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, me.id))
      .limit(1);
    if (!sub?.providerSubscriptionId) return NextResponse.json({ ok: true });

    // Período real desde Flow (la fuente de verdad).
    const fresh = await getSubscription(sub.providerSubscriptionId);
    await db
      .update(subscriptions)
      .set({
        status: fresh.status === 4 ? "canceled" : "active",
        currentPeriodEnd: fresh.period_end ? new Date(fresh.period_end) : sub.currentPeriodEnd,
        cancelAtPeriodEnd: fresh.cancel_at_period_end === 1,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, me.id));

    console.log(
      `[flow sub] renovación acreditada: ${payerEmail} hasta ${fresh.period_end} ($${status.amount} CLP)`,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[flow sub webhook]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
