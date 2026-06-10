import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions } from "@/db/schema";
import {
  getRegisterStatus,
  createSubscription,
  cancelSubscription,
} from "@/lib/payments/flow";
import { convertPendingIntent } from "@/lib/payments/convert-pending-intent";
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
    if (reg.status !== "1" || !reg.customerId) {
      return to("/app/planes?error=tarjeta");
    }

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
      const pathId = await convertPendingIntent(me.id);
      return to(pathId ? `/app/rutas/${pathId}?pro=bienvenida` : "/app/perfil?ok=pro");
    }

    const sub = await createSubscription({
      planId: env.FLOW_PLAN_ID,
      customerId: reg.customerId,
    });

    // BLINDAJE DEL PRIMER COBRO: Flow puede devolver la suscripción "activa"
    // con el primer cargo RECHAZADO (morose=1) o una respuesta degenerada sin
    // id. Sin cobro confirmado NO hay Pro ni ruta — se cancela al tiro.
    if (!sub?.subscriptionId) {
      console.error("[pro] createSubscription sin subscriptionId:", sub);
      return to("/app/planes?error=pago");
    }
    if (Number(sub.morose) === 1) {
      console.error(
        `[pro] primer cobro RECHAZADO (morose=1) — cancelando ${sub.subscriptionId}`,
      );
      await cancelSubscription(sub.subscriptionId, false).catch((e) =>
        console.error("[pro] cancelación post-rechazo falló:", e),
      );
      return to("/app/planes?error=cobro");
    }

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
    // Venía comprando una ruta → ahora es Pro → su ruta se crea YA.
    // Sin intent pendiente → directo a crear su primera ruta Pro (no al perfil).
    const pathId = await convertPendingIntent(me.id);
    return to(pathId ? `/app/rutas/${pathId}?pro=bienvenida` : "/app/crear?pro=bienvenida");
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
