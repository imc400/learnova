import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, routeIntents } from "@/db/schema";
import { env } from "@/lib/env";

export interface Entitlement {
  plan: "free" | "pro";
  isPro: boolean;
}

/** Devuelve el plan del usuario (gating freemium). */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  // Activa Y dentro del período pagado (+3 días de gracia por reintentos de
  // cobro de Flow) — un webhook perdido no regala meses de acceso.
  const inPeriod =
    !sub?.currentPeriodEnd ||
    sub.currentPeriodEnd.getTime() > Date.now() - 3 * 86_400_000;
  const isPro = sub?.plan === "pro" && sub.status === "active" && inPeriod;
  return { plan: isPro ? "pro" : "free", isPro };
}

/**
 * Cupo Pro de rutas nuevas del MES en curso (intents 'bypassed' = rutas que
 * el suscriptor creó sin pagar). Las extra pagan precio normal por ruta.
 */
export async function proRoutesLeftThisMonth(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [used] = await db
    .select({ n: count() })
    .from(routeIntents)
    .where(
      and(
        eq(routeIntents.userId, userId),
        eq(routeIntents.status, "bypassed"),
        gte(routeIntents.createdAt, monthStart),
      ),
    );
  return Math.max(0, env.PRO_ROUTES_PER_MONTH - Number(used?.n ?? 0));
}

/** Límite de rutas del tier gratuito (ajustable según política de negocio). */
export const FREE_PATH_LIMIT = 1;
