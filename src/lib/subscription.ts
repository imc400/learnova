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

export interface ProPeriodWindow {
  start: Date;
  end: Date | null;
}

/**
 * UNA sola ventana del período Pro para TODOS los cupos (rutas y minutos de
 * clase): el PERÍODO pagado, no el mes calendario. Cierra el exploit de
 * comprar el 25 y duplicar cupo el 1, y alinea lo que la UI muestra con lo
 * que el servidor aplica. No existe columna current_period_start, así que se
 * deriva del período manual de 30 días (end − 30d). Si hubo renovación
 * anticipada (los días se suman y el inicio derivado caería en el futuro),
 * se usa una ventana móvil de 30 días — solo lectura, no toca pagos.
 */
export async function proPeriodWindow(userId: string): Promise<ProPeriodWindow> {
  const [sub] = await db
    .select({ end: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const THIRTY_D = 30 * 86_400_000;
  const end = sub?.end ?? null;
  const fallbackStart = new Date(Date.now() - THIRTY_D);
  const derived = end ? new Date(end.getTime() - THIRTY_D) : fallbackStart;
  return {
    start: derived.getTime() > Date.now() ? fallbackStart : derived,
    end,
  };
}

/**
 * Cupo Pro de rutas nuevas del PERÍODO en curso (intents 'bypassed' = rutas
 * que el suscriptor creó sin pagar). Las extra pagan precio normal por ruta.
 */
export async function proRoutesLeftThisMonth(userId: string): Promise<number> {
  const { start } = await proPeriodWindow(userId);
  const [used] = await db
    .select({ n: count() })
    .from(routeIntents)
    .where(
      and(
        eq(routeIntents.userId, userId),
        eq(routeIntents.status, "bypassed"),
        gte(routeIntents.createdAt, start),
      ),
    );
  return Math.max(0, env.PRO_ROUTES_PER_MONTH - Number(used?.n ?? 0));
}

/** Límite de rutas del tier gratuito (ajustable según política de negocio). */
export const FREE_PATH_LIMIT = 1;
