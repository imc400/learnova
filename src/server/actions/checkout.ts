"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { pathPurchases, learningPaths, routeIntents } from "@/db/schema";
import { createPayment } from "@/lib/payments/flow";
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
  if (intent.status === "paid" && intent.pathId) redirect(`/app/rutas/${intent.pathId}`);
  if (intent.status !== "pending_payment") redirect("/app");

  const amount = intent.amountClp ?? env.PRICE_ROUTE_CLP;
  let redirectUrl: string;
  try {
    const payment = await createPayment({
      commerceOrder: `intent_${intent.id}`,
      subject: `Aulia — Ruta: ${intent.topic.slice(0, 60)}`,
      amountCLP: amount,
      email: user.email!,
      urlConfirmation: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/webhook`,
      urlReturn: `${env.NEXT_PUBLIC_SITE_URL}/app/pagar/${intent.id}/retorno`,
    });
    redirectUrl = payment.redirectUrl;
  } catch (e) {
    console.error("[checkout] Flow create falló:", e);
    redirect(`/app/pagar/${intent.id}?error=pago`);
  }
  redirect(redirectUrl);
}

/*
  Precios en CLP (Flow cobra en pesos chilenos). Ajusta según tu conversión y
  estrategia. Referencia: Pro ≈ $15 USD/mes, Ruta única ≈ $19 USD.
*/
const PRICES_CLP = { pro: 13990, single: 17990 };

/** Inicia la compra one-time de una ruta ($19). Redirige a Flow. */
export async function startPathPurchaseAction(pathId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // IDOR: solo se puede comprar una ruta PROPIA.
  const [owned] = await db
    .select({ id: learningPaths.id })
    .from(learningPaths)
    .where(and(eq(learningPaths.id, pathId), eq(learningPaths.userId, user.id)))
    .limit(1);
  if (!owned) redirect("/app");

  const [purchase] = await db
    .insert(pathPurchases)
    .values({
      userId: user.id,
      pathId,
      provider: "flow",
      amount: PRICES_CLP.single,
      currency: "CLP",
      status: "pending",
    })
    .returning();
  if (!purchase) throw new Error("No se pudo iniciar la compra");

  const payment = await createPayment({
    commerceOrder: `path_${purchase.id}`,
    subject: "Aulia — Ruta de aprendizaje",
    amountCLP: PRICES_CLP.single,
    email: user.email!,
    urlConfirmation: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/webhook`,
    urlReturn: `${env.NEXT_PUBLIC_SITE_URL}/app/rutas/${pathId}`,
  });

  await db
    .update(pathPurchases)
    .set({ providerPaymentId: String(payment.flowOrder) })
    .where(eq(pathPurchases.id, purchase.id));

  redirect(payment.redirectUrl);
}

/**
 * Inicia la suscripción Pro. NOTA: esto crea un cargo de UN período. Para el
 * cobro recurrente real, migrar a la API de suscripciones de Flow (crear plan +
 * customer). El webhook ya activa el plan "pro" al confirmarse el pago.
 */
export async function startProSubscriptionAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const payment = await createPayment({
    commerceOrder: `sub_${user.id}`,
    subject: "Aulia Pro — Suscripción mensual",
    amountCLP: PRICES_CLP.pro,
    email: user.email!,
    urlConfirmation: `${env.NEXT_PUBLIC_SITE_URL}/api/flow/webhook`,
    urlReturn: `${env.NEXT_PUBLIC_SITE_URL}/app`,
  });

  redirect(payment.redirectUrl);
}
