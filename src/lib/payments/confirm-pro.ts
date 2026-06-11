import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pathPurchases, profiles, subscriptions } from "@/db/schema";
import { convertPendingIntent } from "@/lib/payments/convert-pending-intent";
import { sendCapiPurchase } from "@/lib/analytics/meta-capi";
import { env } from "@/lib/env";

/*
  PRO MANUAL: un cobro único = 30 días de Pro completo, SIN cobro automático
  (Flow aún no activa el PAT). La renovación es otra compra igual — extiende
  desde el vencimiento vigente, así renovar antes no regala ni quita días.

  Punto ÚNICO de verdad para confirmar la compra prom_<purchaseId>: webhook y
  pro-return contienden — el lock FOR UPDATE sobre la compra garantiza que
  solo UNO activa (at-least-once sin meses duplicados).
*/

const PRO_MANUAL_DAYS = 30;

export async function confirmProMonthPaid(args: {
  purchaseId: string;
  /** Monto REAL cobrado según Flow (la verdad contable). */
  chargedAmountClp: number;
}): Promise<{ kind: "activated" | "already" | "not-found"; userId?: string }> {
  const result = await db.transaction(async (tx) => {
    const [purchase] = await tx
      .select()
      .from(pathPurchases)
      .where(eq(pathPurchases.id, args.purchaseId))
      .for("update");
    if (!purchase || purchase.kind !== "pro_month") {
      return { kind: "not-found" as const };
    }
    if (purchase.status === "paid") {
      return { kind: "already" as const, userId: purchase.userId };
    }

    await tx
      .update(pathPurchases)
      .set({ status: "paid" })
      .where(eq(pathPurchases.id, purchase.id));

    if (args.chargedAmountClp && args.chargedAmountClp !== purchase.amount) {
      console.error(
        `[pro] ALERTA: monto Flow ${args.chargedAmountClp} ≠ compra ${purchase.amount} (${purchase.id})`,
      );
    }

    // Vigente → extiende desde period_end; vencido/nuevo → desde hoy.
    const [sub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, purchase.userId))
      .limit(1);
    const base =
      sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
        ? sub.currentPeriodEnd
        : new Date();
    const periodEnd = new Date(base.getTime() + PRO_MANUAL_DAYS * 86_400_000);

    await tx
      .insert(subscriptions)
      .values({
        userId: purchase.userId,
        plan: "pro",
        status: "active",
        provider: "flow",
        providerSubscriptionId: null, // manual: NO hay suscripción en Flow
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true, // termina solo — nadie cobra de nuevo
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          plan: "pro",
          status: "active",
          provider: "flow",
          providerSubscriptionId: null,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: true,
          updatedAt: new Date(),
        },
      });
    return { kind: "activated" as const, userId: purchase.userId };
  });

  // Venía comprando una ruta → ahora es Pro → su ruta se crea YA (fuera de
  // la transacción; convertPendingIntent es idempotente con su propio lock).
  if (result.kind === "activated" && result.userId) {
    await convertPendingIntent(result.userId);

    // Meta Conversions API (best-effort, gateada por META_CAPI_ACCESS_TOKEN):
    // MISMO eventID que el Purchase del navegador (`purchase-prom-<id>`) →
    // Meta deduplica. Un fallo aquí JAMÁS toca la activación de Pro.
    try {
      const [prof] = await db
        .select({ email: profiles.email, phone: profiles.phone })
        .from(profiles)
        .where(eq(profiles.id, result.userId))
        .limit(1);
      await sendCapiPurchase({
        eventId: `purchase-prom-${args.purchaseId}`,
        valueClp: args.chargedAmountClp || env.PRICE_PRO_CLP,
        email: prof?.email,
        phone: prof?.phone,
      });
    } catch (e) {
      console.error("[pro] meta-capi purchase:", e);
    }
  }
  return result;
}

/** Pago Pro rechazado/anulado → 'failed' (solo desde pending). */
export async function markProMonthFailed(purchaseId: string): Promise<void> {
  await db
    .update(pathPurchases)
    .set({ status: "failed" })
    .where(
      sql`${pathPurchases.id} = ${purchaseId} and ${pathPurchases.kind} = 'pro_month' and ${pathPurchases.status} = 'pending'`,
    )
    .catch((e) => console.error("[pro] marcar failed:", e));
}
