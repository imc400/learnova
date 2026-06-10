import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions } from "@/db/schema";
import {
  getRegisterStatus,
  createSubscription,
} from "@/lib/payments/flow";
import { env } from "@/lib/env";

/*
  Retorno del REGISTRO DE TARJETA de Flow (POST con token, a veces GET).
  Confirmamos contra la API (jamás confiamos en el redirect), creamos la
  suscripción (primer cobro automático) y activamos Pro.
*/

async function handle(token: string | null): Promise<NextResponse> {
  const to = (path: string) =>
    NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}${path}`, 303);

  if (!token || !/^[\w-]{8,128}$/.test(token)) return to("/app/planes?error=tarjeta");

  try {
    const reg = await getRegisterStatus(token);
    if (reg.status !== "1") return to("/app/planes?error=tarjeta");

    // Usuario dueño de ese customer.
    const [me] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.flowCustomerId, reg.customerId))
      .limit(1);
    if (!me) return to("/app/planes?error=pago");

    // Idempotencia: si ya está activa (doble retorno), no crear otra.
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, me.id))
      .limit(1);
    if (existing?.plan === "pro" && existing.status === "active") {
      return to("/app/perfil?ok=pro");
    }

    const sub = await createSubscription({
      planId: env.FLOW_PLAN_ID,
      customerId: reg.customerId,
    });

    const values = {
      plan: "pro" as const,
      status: "active" as const,
      provider: "flow" as const,
      providerSubscriptionId: sub.subscriptionId,
      currentPeriodEnd: sub.period_end ? new Date(sub.period_end) : null,
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(subscriptions).set(values).where(eq(subscriptions.userId, me.id));
    } else {
      await db.insert(subscriptions).values({ userId: me.id, ...values });
    }
    return to("/app/perfil?ok=pro");
  } catch (e) {
    console.error("[flow card-return]", e);
    return to("/app/planes?error=pago");
  }
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  return handle(form ? String(form.get("token") ?? "") : null);
}

export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams.get("token"));
}
