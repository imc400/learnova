import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, subscriptions, routeIntents, learningPaths } from "@/db/schema";
import {
  getRegisterStatus,
  createSubscription,
  cancelSubscription,
} from "@/lib/payments/flow";
import { buildPathInsertValues } from "@/lib/paths/create";
import { enqueuePathGeneration } from "@/lib/generation/run";
import { env } from "@/lib/env";

/**
 * Si el usuario venía de un paywall (intent pendiente) y AHORA es Pro, su
 * ruta se crea de inmediato consumiendo 1 cupo del mes — el "me suscribo
 * para esta ruta" termina EN la ruta, no en el perfil.
 *
 * TRANSACCIÓN + FOR UPDATE: el webhook de pago del mismo intent contiende
 * por el mismo lock de fila — solo UNO convierte (jamás dos rutas, jamás
 * duplicado en reintentos: estado y pathId se escriben en el mismo commit
 * que crea la ruta).
 */
async function convertPendingIntent(userId: string): Promise<string | null> {
  const result = await db
    .transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(routeIntents)
        .where(
          and(
            eq(routeIntents.userId, userId),
            eq(routeIntents.status, "pending_payment"),
          ),
        )
        .orderBy(desc(routeIntents.createdAt))
        .limit(1)
        .for("update");
      if (!intent || intent.pathId) return null;

      const [path] = await tx
        .insert(learningPaths)
        .values(
          buildPathInsertValues({
            userId,
            intake: {
              topic: intent.topic,
              goal: intent.goal,
              level: intent.level as "principiante" | "intermedio" | "avanzado",
              language: intent.language,
              priorExperience: intent.priorExperience ?? undefined,
              weeklyHours: intent.weeklyHours ?? undefined,
            },
            sourcePathId: intent.sourcePathId,
          }),
        )
        .returning({ id: learningPaths.id });
      if (!path) throw new Error("insert de ruta falló");

      await tx
        .update(routeIntents)
        .set({ status: "bypassed", pathId: path.id, updatedAt: new Date() })
        .where(eq(routeIntents.id, intent.id));
      return path.id;
    })
    .catch((e) => {
      console.error("[pro] conversión de intent pendiente falló:", e);
      return null;
    });

  if (result) {
    await enqueuePathGeneration(result).catch((e) =>
      console.error(`[pro] enqueue de ruta ${result} falló:`, e),
    );
  }
  return result;
}

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
