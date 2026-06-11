import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runReconciliation } from "@/lib/ops/reconcile";
import { isAdminUser } from "@/lib/admin";

/*
  Doble disparador de la reconciliación (E-P0.3): el cron principal vive en
  Trigger.dev, pero si Trigger está caído su cron también — este endpoint lo
  invoca un Vercel Cron (vercel.json) DESDE OTRO dominio de fallo.

  Auth (cualquiera de las dos):
  - Vercel Cron: header `Authorization: Bearer ${CRON_SECRET}` (Vercel lo
    añade solo cuando la env CRON_SECRET existe en el proyecto).
  - Un admin logueado (para el botón "Correr reconciliación" o curl manual).

  CRON_SECRET vacío = el camino por secret queda deshabilitado (solo admin).
  runReconciliation es idempotente: chocar con el cron de Trigger es seguro.
*/

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

async function authorized(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization");
  if (env.CRON_SECRET && header === `Bearer ${env.CRON_SECRET}`) return true;
  return Boolean(await isAdminUser().catch(() => null));
}

export async function GET(req: Request) {
  if (!(await authorized(req))) {
    // 404 (no 401): no revelar que el endpoint existe a quien escanee rutas.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const report = await runReconciliation();
  return NextResponse.json(report);
}

export async function POST(req: Request) {
  return GET(req);
}
