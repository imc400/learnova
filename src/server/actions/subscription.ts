"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomer,
  registerCard,
  cancelSubscription,
} from "@/lib/payments/flow";
import { env } from "@/lib/env";

/*
  Suscripción Aulia Pro vía Flow:
  subscribeProAction → asegura customer → redirige a Flow a registrar la
  tarjeta → Flow vuelve a /api/flow/card-return → ahí se crea la suscripción
  (primer cobro automático) → perfil. Cancelación: al final del período.
*/

export async function subscribeProAction() {
  // Hasta que Flow active el contrato de cobro automático (PAT), Pro no se
  // vende — guard server-side por si el form llega desde una página cacheada.
  if (env.PRO_SUBSCRIPTION_ENABLED !== "true") {
    redirect("/app/planes?error=disponible");
  }

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

  // ¿Ya es Pro activo? No cobrar dos veces.
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);
  if (sub?.plan === "pro" && sub.status === "active") redirect("/app/perfil");

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