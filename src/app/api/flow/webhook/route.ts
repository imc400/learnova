import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
    if (!token) return NextResponse.json({ ok: false }, { status: 400 });

    const status = await getPaymentStatus(token);

    // status === 2 → pagado
    if (status.status === 2) {
      const order = status.commerceOrder;

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
          if (intent.status !== "pending_payment" && intent.status !== "paid") {
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
          await enqueuePathGeneration(result.pathId).catch((e) =>
            console.error(
              `[flow webhook] CRÍTICO: ruta ${result.pathId} creada pero generación no encolada:`,
              e,
            ),
          );
          await db
            .insert(pathPurchases)
            .values({
              userId: result.intent.userId,
              pathId: result.pathId,
              provider: "flow",
              amount: result.intent.amountClp ?? (Number(status.amount) || 0),
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
