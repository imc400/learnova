import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  pathPurchases,
  subscriptions,
  routeIntents,
  learningPaths,
} from "@/db/schema";
import { getPaymentStatus } from "@/lib/payments/flow";
import { buildPathInsertValues } from "@/lib/paths/create";
import { enqueuePathGeneration } from "@/lib/generation/run";

/**
 * Webhook de confirmación de Flow (server-to-server). Flow envía `token`;
 * consultamos el estado real y actualizamos la DB. Nunca confiamos en el cliente.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    // Solo formatos de token plausibles llegan a Flow (anti banging del endpoint).
    if (!/^[\w-]{8,128}$/.test(token)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // La verdad SIEMPRE se consulta a Flow con petición firmada (HMAC con
    // nuestra secret) — jamás se confía en el body del webhook.
    const status = await getPaymentStatus(token);
    const order = status.commerceOrder;

    // status 3 (rechazado) / 4 (anulado) → el intent queda 'failed' para que
    // el usuario vea qué pasó y pueda reintentar (jamás un limbo silencioso).
    if ((status.status === 3 || status.status === 4) && order.startsWith("intent_")) {
      await db
        .update(routeIntents)
        .set({ status: "failed", updatedAt: new Date() })
        .where(
          and(
            eq(routeIntents.id, order.slice(7)),
            eq(routeIntents.status, "pending_payment"),
          ),
        )
        .catch((e) => console.error("[flow webhook] marcar failed:", e));
      return NextResponse.json({ ok: true });
    }

    // status === 2 → pagado
    if (status.status === 2) {

      if (order.startsWith("intent_")) {
        // PAYWALL PRE-GENERACIÓN. Transacción con lock de fila: Flow reenvía
        // el webhook (at-least-once) y solo UNA ejecución crea la ruta. Si la
        // creación falla, el intent queda 'paid' SIN pathId → el siguiente
        // reintento de Flow vuelve a intentar crear (el pago jamás se pierde).
        const intentId = order.slice(7);
        const result = await db.transaction(async (tx) => {
          const [intent] = await tx
            .select()
            .from(routeIntents)
            .where(eq(routeIntents.id, intentId))
            .for("update");
          if (!intent || intent.pathId) return null; // ya procesado
          // Claimables: pendiente, pagado-sin-ruta (reintento tras fallo de
          // creación) y failed (el usuario reintentó el pago y ahora SÍ pagó).
          if (!["pending_payment", "paid", "failed"].includes(intent.status)) {
            return null;
          }
          const [path] = await tx
            .insert(learningPaths)
            .values(
              buildPathInsertValues({
                userId: intent.userId,
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
            .set({
              status: "paid",
              paidAt: intent.paidAt ?? new Date(),
              pathId: path.id,
              updatedAt: new Date(),
            })
            .where(eq(routeIntents.id, intent.id));
          return { intent, pathId: path.id };
        });

        if (result) {
          // Fuera de la transacción: side-effects no transaccionales.
          // La generación se reintenta aquí mismo (sin ella, ruta huérfana).
          let enqueued = false;
          for (let i = 0; i < 3 && !enqueued; i++) {
            try {
              await enqueuePathGeneration(result.pathId);
              enqueued = true;
            } catch (e) {
              console.error(
                `[flow webhook] enqueue intento ${i + 1}/3 falló (ruta ${result.pathId}):`,
                e,
              );
              await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
            }
          }
          if (!enqueued) {
            console.error(
              `[flow webhook] CRÍTICO: ruta ${result.pathId} pagada SIN generación encolada — intervenir manualmente`,
            );
          }
          // Contabilidad: el monto REAL cobrado por Flow es la verdad; si
          // difiere del intent, queda alerta (jamás divergencia silenciosa).
          const flowAmount = Number(status.amount) || 0;
          if (result.intent.amountClp && flowAmount && flowAmount !== result.intent.amountClp) {
            console.error(
              `[flow webhook] ALERTA: monto Flow ${flowAmount} ≠ intent ${result.intent.amountClp} (intent ${intentId})`,
            );
          }
          await db
            .insert(pathPurchases)
            .values({
              userId: result.intent.userId,
              pathId: result.pathId,
              provider: "flow",
              amount: flowAmount || result.intent.amountClp || 0,
              currency: "CLP",
              status: "paid",
            })
            .catch((e) => console.error("[flow webhook] registro contable:", e));
        }
      } else if (order.startsWith("path_")) {
        await db
          .update(pathPurchases)
          .set({ status: "paid" })
          .where(eq(pathPurchases.id, order.slice(5)));
      } else if (order.startsWith("sub_")) {
        const userId = order.slice(4);
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await db
          .update(subscriptions)
          .set({
            plan: "pro",
            status: "active",
            provider: "flow",
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[flow webhook]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
