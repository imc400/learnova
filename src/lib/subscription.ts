import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";

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

  const isPro = sub?.plan === "pro" && sub.status === "active";
  return { plan: isPro ? "pro" : "free", isPro };
}

/** Límite de rutas del tier gratuito (ajustable según política de negocio). */
export const FREE_PATH_LIMIT = 1;
