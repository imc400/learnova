import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pathPurchases, subscriptions } from "@/db/schema";
import { getPaymentStatus } from "@/lib/payments/flow";

/**
 * Webhook de confirmación de Flow (server-to-server). Flow envía `token`;
 * consultamos el estado real y actualizamos la DB. Nunca confiamos en el cliente.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    if (!token) return NextResponse.json({ ok: false }, { status: 400 });

    const status = await getPaymentStatus(token);

    // status === 2 → pagado
    if (status.status === 2) {
      const order = status.commerceOrder;

      if (order.startsWith("path_")) {
        await db
          .update(pathPurchases)
          .set({ status: "paid" })
          .where(eq(pathPurchases.id, order.slice(5)));
      } else if (order.startsWith("sub_")) {
        const userId = order.slice(4);
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await db
          .update(subscriptions)
          .set({
            plan: "pro",
            status: "active",
            provider: "flow",
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[flow webhook]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
