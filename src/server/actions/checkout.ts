"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { createPayment } from "@/lib/payments/flow";
import { createPreference } from "@/lib/payments/mercadopago";
import { activeProvider } from "@/lib/payments/provider";
import { env } from "@/lib/env";

/**
 * Checkout de un INTENT de ruta (paywall pre-generación): crea el pago en
 * Flow y redirige. El webhook (intent_<id>) confirma, crea la ruta y dispara
 * la generación — la plata SIEMPRE llega antes que el costo de generar.
 */
export async function startIntentCheckoutAction(intentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [intent] = await db
    .select()
    .from(routeIntents)
    .where(and(eq(routeIntents.id, intentId), eq(routeIntents.userId, user.id)))
    .limit(1);
  if (!intent) redirect("/app/crear");
  if (intent.pathId) redirect(`/app/rutas/${intent.pathId}`);
  // failed = pago rechazado/anulado → se puede reintentar.
  if (intent.status !== "pending_payment" && intent.status !== "failed") {
    redirect("/app");
  }

  const amount = intent.amountClp ?? env.PRICE_ROUTE_CLP;
  // Flow devuelve al navegador con POST cross-site (sin cookies) → SIEMPRE
  // por el puente público /api/flow/retorno, que convierte a GET con sesión.
  const returnUrl = `${env.NEXT_PUBLIC_SITE_URL}/api/flow/retorno?intent=${intent.id}`;
  let redirectUrl: string;
  try {
    if (activeProvider() === "mercadopago") {
      // Mercado Pago (preferido): Checkout Pro vía external_reference.
      const pref = await createPreference({
        externalReference: `intent_${intent.id}`,
        title: `Aulia — Ruta: ${intent.topic.slice(0, 60)}`,
        amountCLP: amount,
        payerEmail: user.email!,
        returnUrl,
        notificationUrl: `${env.NEXT_PUBLIC_SITE_URL}/api/mp/webhook`,
      });
      redirectUrl = pref.initPoint;
    } else {
      const payment = await createPayment({
        commerceOrder: `intent_${intent.id}`,
        subject: `Aulia — Ruta: ${intent.topic.slice(0, 60)}`,
        amountCLP: amount,
        email: user.email!,
        urlConfirmation: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/webhook`,
        urlReturn: returnUrl,
      });
      redirectUrl = payment.redirectUrl;
    }
  } catch (e) {
    console.error("[checkout] crear pago falló:", e);
    redirect(`/app/pagar/${intent.id}?error=pago`);
  }
  redirect(redirectUrl);
}

/* Las acciones legacy de compra por ruta existente (path_) y suscripción por
   cargo único (sub_) se eliminaron: el paywall pre-generación (intent_) y el
   Pro manual (prom_, en actions/subscription.ts) son los únicos checkouts. */
