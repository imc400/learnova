"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions, pathPurchases } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomer,
  registerCard,
  cancelSubscription,
  createPayment,
} from "@/lib/payments/flow";
import { env } from "@/lib/env";

/*
  Suscripción Aulia Pro vía Flow — DOS modos según PRO_SUBSCRIPTION_ENABLED:

  "true" (PAT activo): customer → registrar tarjeta → /api/flow/card-return
  crea la suscripción con cobro automático mensual.

  "false" (PRO MANUAL, mientras Flow activa el PAT): cobro único de
  PRICE_PRO_CLP = 30 días de Pro completo, SIN cobro automático. La
  renovación es otra compra igual (el fundador recuerda renovar). El webhook
  o /api/flow/pro-return confirman vía confirmProMonthPaid.
*/

export async function subscribeProAction(intentId: string | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [me] = await db
    .select({
      fullName: profiles.fullName,
      email: profiles.email,
      flowCustomerId: profiles.flowCustomerId,
    })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  // Pro vigente con cobro automático real → jamás cobrar de nuevo. El Pro
  // MANUAL vigente sí puede volver a pagar: es renovación anticipada y
  // extiende desde su vencimiento (confirmProMonthPaid).
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);
  const vigente =
    sub?.plan === "pro" &&
    sub.status === "active" &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > Date.now());
  if (vigente && sub?.providerSubscriptionId) redirect("/app/perfil");

  if (env.PRO_SUBSCRIPTION_ENABLED !== "true") {
    return startProMonthCheckout({
      userId: user.id,
      email: me?.email || user.email!,
      intentId,
    });
  }

  let customerId = me?.flowCustomerId ?? null;
  if (!customerId) {
    try {
      const c = await createCustomer({
        name: me?.fullName || "Estudiante Aulia",
        email: me?.email || user.email!,
        externalId: user.id,
      });
      customerId = c.customerId;
      await db
        .update(profiles)
        .set({ flowCustomerId: customerId, updatedAt: new Date() })
        .where(eq(profiles.id, user.id));
    } catch (e) {
      console.error("[pro] customer/create falló:", e);
      // Flow VERIFICA que el buzón exista de verdad: correo inventado o con
      // typo → mensaje accionable, no error genérico.
      if ((e as Error).message?.includes("email is not valid")) {
        redirect("/app/planes?error=email");
      }
      redirect("/app/planes?error=pago");
    }
  }

  let redirectUrl: string;
  try {
    const r = await registerCard({
      customerId,
      urlReturn: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/card-return`,
    });
    redirectUrl = r.redirectUrl;
  } catch (e) {
    console.error("[pro] customer/register falló:", e);
    // Error 7001 de Flow: el comercio aún no tiene contrato de cobro
    // automático (se activa con Flow una vez) — mensaje honesto, no genérico.
    if ((e as Error).message?.includes("7001")) {
      redirect("/app/planes?error=disponible");
    }
    redirect("/app/planes?error=pago");
  }
  redirect(redirectUrl);
}

/** PRO MANUAL: crea la compra pending + pago único en Flow y redirige. */
async function startProMonthCheckout(args: {
  userId: string;
  email: string;
  intentId: string | null;
}) {
  const back = args.intentId ? `/app/pagar/${args.intentId}` : "/app/planes";

  const [purchase] = await db
    .insert(pathPurchases)
    .values({
      userId: args.userId,
      pathId: null,
      kind: "pro_month",
      provider: "flow",
      amount: env.PRICE_PRO_CLP,
      currency: "CLP",
      status: "pending",
    })
    .returning({ id: pathPurchases.id });
  if (!purchase) redirect(`${back}?error=pago`);

  let redirectUrl: string;
  try {
    const payment = await createPayment({
      commerceOrder: `prom_${purchase.id}`,
      subject: "Aulia Pro — 1 mes (sin cobro automático)",
      amountCLP: env.PRICE_PRO_CLP,
      email: args.email,
      urlConfirmation: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/webhook`,
      urlReturn: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/pro-return`,
    });
    await db
      .update(pathPurchases)
      .set({ providerPaymentId: String(payment.flowOrder) })
      .where(eq(pathPurchases.id, purchase.id));
    redirectUrl = payment.redirectUrl;
  } catch (e) {
    console.error("[pro] pago único Pro falló:", e);
    // Flow verifica que el buzón EXISTA (error 1620): typo en el correo →
    // mensaje accionable, no un "algo falló" genérico.
    if ((e as Error).message?.includes("is not valid")) {
      redirect(`${back}?error=email`);
    }
    redirect(`${back}?error=pago`);
  }
  redirect(redirectUrl);
}

/** Cancela Pro al final del período (el acceso se conserva hasta esa fecha). */
export async function cancelProAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);
  if (!sub?.providerSubscriptionId || sub.plan !== "pro") redirect("/app/perfil");

  try {
    const r = await cancelSubscription(sub.providerSubscriptionId, true);
    await db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: r.period_end ? new Date(r.period_end) : sub.currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, user.id));
  } catch (e) {
    console.error("[pro] cancel falló:", e);
    redirect("/app/perfil?error=cancelacion");
  }
  redirect("/app/perfil?ok=cancelada");
}
