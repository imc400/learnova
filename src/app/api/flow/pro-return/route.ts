import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { routeIntents } from "@/db/schema";
import { getPaymentStatus } from "@/lib/payments/flow";
import { confirmProMonthPaid, markProMonthFailed } from "@/lib/payments/confirm-pro";
import { convertPendingIntent } from "@/lib/payments/convert-pending-intent";
import { env } from "@/lib/env";

/*
  Retorno del PAGO ÚNICO de Pro manual (prom_). Flow devuelve el navegador
  vía POST cross-site con token. Confirmamos contra la API FIRMADA (jamás el
  body) — confirm-pro es idempotente, así que da igual si el webhook llegó
  primero. El usuario aterriza con su Pro activo y, si venía del paywall,
  directo EN su ruta recién creada.
*/

async function handle(token: string | null): Promise<NextResponse> {
  const to = (path: string) =>
    NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}${path}`, 303);

  if (!token || !/^[\w-]{8,128}$/.test(token)) return to("/app/planes?error=pago");

  try {
    const status = await getPaymentStatus(token);
    const order = status.commerceOrder;
    if (!order.startsWith("prom_")) return to("/app");
    const purchaseId = order.slice(5);

    if (status.status === 3 || status.status === 4) {
      await markProMonthFailed(purchaseId);
      return to("/app/planes?error=pago");
    }
    if (status.status !== 2) {
      // 1 = pendiente (p. ej. transferencia): el webhook cerrará después.
      return to("/app/perfil?pro=pendiente");
    }

    const result = await confirmProMonthPaid({
      purchaseId,
      chargedAmountClp: Number(status.amount) || 0,
    });
    if (result.kind === "not-found" || !result.userId) {
      console.error(`[pro-return] compra ${purchaseId} no encontrada`);
      return to("/app/planes?error=pago");
    }

    // Params de compra para el Purchase de Meta en el aterrizaje (mismo
    // eventID `purchase-prom-<id>` que manda la CAPI → Meta deduplica).
    const montoPro = Number(status.amount) || env.PRICE_PRO_CLP;
    const compraQs = `compra=prom-${purchaseId}&monto=${montoPro}`;

    // ¿Venía del paywall? Su ruta ya se creó (o se crea AQUÍ si el convert
    // del webhook falló — es idempotente) → aterriza EN la ruta.
    const pathId = await convertPendingIntent(result.userId);
    if (pathId) return to(`/app/rutas/${pathId}?pro=bienvenida&${compraQs}`);

    // Sin pending: quizá el webhook ya lo convirtió hace segundos.
    const [last] = await db
      .select({ pathId: routeIntents.pathId, updatedAt: routeIntents.updatedAt })
      .from(routeIntents)
      .where(
        and(
          eq(routeIntents.userId, result.userId),
          eq(routeIntents.status, "bypassed"),
        ),
      )
      .orderBy(desc(routeIntents.updatedAt))
      .limit(1);
    const recienConvertida =
      last?.pathId && Date.now() - last.updatedAt.getTime() < 15 * 60_000;
    if (recienConvertida) {
      return to(`/app/rutas/${last.pathId}?pro=bienvenida&${compraQs}`);
    }

    return to("/app/crear?pro=bienvenida");
  } catch (e) {
    console.error("[flow pro-return]", e);
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
