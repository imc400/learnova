import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { routeIntents, learningPaths, pathPurchases } from "@/db/schema";
import { buildPathInsertValues } from "@/lib/paths/create";
import { enqueuePathGeneration } from "@/lib/generation/run";

/*
  Confirmación de pago de un INTENT — punto ÚNICO de verdad, agnóstico del
  proveedor (Flow, Mercado Pago, el que venga). Transacción con lock de fila:
  los webhooks son at-least-once y solo UNA ejecución crea la ruta. Si la
  creación falla, el intent queda 'paid' SIN pathId → el siguiente reintento
  del proveedor vuelve a intentar (un pago JAMÁS se pierde).
*/

export async function confirmIntentPaid(args: {
  intentId: string;
  provider: "flow" | "mercadopago";
  /** Monto REAL cobrado según el proveedor (la verdad contable). */
  chargedAmountClp: number;
}): Promise<"created" | "already" | "not-found"> {
  const result = await db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(routeIntents)
      .where(eq(routeIntents.id, args.intentId))
      .for("update");
    if (!intent) return { kind: "not-found" as const };
    if (intent.pathId) return { kind: "already" as const };
    // Claimables: pendiente, pagado-sin-ruta (reintento tras fallo de
    // creación) y failed (el usuario reintentó el pago y ahora SÍ pagó).
    if (!["pending_payment", "paid", "failed"].includes(intent.status)) {
      return { kind: "already" as const };
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
    return { kind: "created" as const, intent, pathId: path.id };
  });

  if (result.kind !== "created") return result.kind;

  // Side-effects fuera de la transacción, con reintentos propios.
  let enqueued = false;
  for (let i = 0; i < 3 && !enqueued; i++) {
    try {
      await enqueuePathGeneration(result.pathId);
      enqueued = true;
    } catch (e) {
      console.error(
        `[pagos] enqueue intento ${i + 1}/3 falló (ruta ${result.pathId}):`,
        e,
      );
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  if (!enqueued) {
    console.error(
      `[pagos] CRÍTICO: ruta ${result.pathId} pagada SIN generación encolada — intervenir`,
    );
  }

  if (
    result.intent.amountClp &&
    args.chargedAmountClp &&
    args.chargedAmountClp !== result.intent.amountClp
  ) {
    console.error(
      `[pagos] ALERTA: monto ${args.provider} ${args.chargedAmountClp} ≠ intent ${result.intent.amountClp} (${args.intentId})`,
    );
  }
  await db
    .insert(pathPurchases)
    .values({
      userId: result.intent.userId,
      pathId: result.pathId,
      provider: args.provider,
      amount: args.chargedAmountClp || result.intent.amountClp || 0,
      currency: "CLP",
      status: "paid",
    })
    .catch((e) => console.error("[pagos] registro contable:", e));
  return "created";
}

/** Pago rechazado/anulado → 'failed' (solo desde pending; reintenta cuando quiera). */
export async function markIntentFailed(intentId: string): Promise<void> {
  await db
    .update(routeIntents)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(eq(routeIntents.id, intentId), eq(routeIntents.status, "pending_payment")),
    )
    .catch((e) => console.error("[pagos] marcar failed:", e));
}
