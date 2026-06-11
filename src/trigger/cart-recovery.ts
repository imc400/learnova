import { schedules } from "@trigger.dev/sdk";
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { env } from "@/lib/env";
import { enqueueProgressEmail } from "@/lib/email/enqueue";

/*
  Recuperación de carros abandonados (cron horario) — el upsell de mayor ROI:
  el usuario ya completó el wizard, ya tiene cuenta y ya vio SU temario; el
  intent guarda preview.modules + hook (el asset de conversión perfecto) y
  hasta hoy solo existía un wa.me manual en el admin.

  Secuencia de 2 toques sobre route_intents pending_payment sin ruta:
  - T+1h:  su temario con 🔒 (idéntico al paywall) + "sigue reservado".
  - T+24h: garantía 7 días (real: está en el paywall) + ángulo Pro.
  SIN descuentos: la marca es "sin trucos"; la garantía es el cierre.

  Idempotencia: dedupeKey {intentId}-1h / {intentId}-24h contra el UNIQUE del
  outbox; process.ts re-chequea el intent al ENVIAR (si pagó entre medio, skip).
  Ventanas anchas (no exactas) para sobrevivir corridas perdidas del cron.

  GATING (decisión fundador): con LIFECYCLE_EMAILS_ENABLED != "true" el cron
  corre y loguea cuántos encolaría, pero NO encola nada.
*/

const MAX_AGE_HOURS = 49; // tras ~2 días el carro está frío; no perseguimos más

export const cartRecoveryTask = schedules.task({
  id: "cart-recovery",
  cron: "0 * * * *", // cada hora, al minuto 0
  maxDuration: 300,
  run: async () => {
    const now = Date.now();
    const enabled = env.LIFECYCLE_EMAILS_ENABLED === "true";

    const candidates = await db
      .select({
        id: routeIntents.id,
        userId: routeIntents.userId,
        topic: routeIntents.topic,
        preview: routeIntents.preview,
        amountClp: routeIntents.amountClp,
        language: routeIntents.language,
        createdAt: routeIntents.createdAt,
      })
      .from(routeIntents)
      .where(
        and(
          eq(routeIntents.status, "pending_payment"),
          isNull(routeIntents.pathId),
          lte(routeIntents.createdAt, new Date(now - 1 * 3_600_000)),
          gt(routeIntents.createdAt, new Date(now - MAX_AGE_HOURS * 3_600_000)),
        ),
      )
      .orderBy(desc(routeIntents.createdAt));

    // Un usuario indeciso genera varios intents (re-pasadas por el wizard):
    // se persigue SOLO el más reciente — los demás ensucian la secuencia.
    const seen = new Set<string>();
    const carts = candidates.filter((c) =>
      seen.has(c.userId) ? false : (seen.add(c.userId), true),
    );

    const touches = carts.map((c) => ({
      cart: c,
      touch: (c.createdAt.getTime() <= now - 24 * 3_600_000 ? "24h" : "1h") as
        | "1h"
        | "24h",
    }));

    if (!enabled) {
      const t1 = touches.filter((t) => t.touch === "1h").length;
      console.log(
        `[lifecycle] LIFECYCLE_EMAILS_ENABLED=false — encolaría ${touches.length} cart_recovery (T+1h: ${t1}, T+24h: ${touches.length - t1}). Nada se encoló; el fundador enciende la env tras aprobar los copys.`,
      );
      return { gated: true, candidates: touches.length };
    }

    let queued = 0;
    for (const { cart, touch } of touches) {
      // El dedupe del outbox absorbe re-corridas; un intent de >24 h que nunca
      // recibió el T+1h recibe SOLO el T+24h (no dos correos de golpe).
      await enqueueProgressEmail(cart.userId, "cart_recovery", `${cart.id}-${touch}`, {
        touch,
        intentId: cart.id,
        topic: cart.topic,
        previewHook: cart.preview?.hook,
        previewModules: cart.preview?.modules ?? [],
        amountClp: cart.amountClp ?? env.PRICE_ROUTE_CLP,
        language: cart.language,
      });
      queued++;
    }

    console.log(`[lifecycle] cart-recovery: ${queued} correos encolados.`);
    return { gated: false, queued };
  },
});
