import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { alertFounder } from "@/lib/ops/alert";
import { checkRateLimit } from "@/lib/ratelimit";

/*
  Reporte del error boundary (ops): cuando a un usuario se le cae una pantalla
  en producción, el fundador se entera AL INSTANTE (ops_incidents + correo),
  con el digest exacto para encontrar el stack en los logs de Vercel.

  Nació de la demo universidad 2026-06-12: el aula estuvo caída en vivo y
  estuvimos ciegos ~40 min hasta capturar el digest a mano. Nunca más.

  Anti-abuso: es un endpoint público (el error boundary también cubre a
  usuarios sin sesión) → rate limit por IP + el dedupe por hora de
  alertFounder (mismo título = 1 alerta/hora). Sin PII en el payload.
*/

export async function POST(req: Request) {
  try {
    const h = await headers();
    const ip =
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "0.0.0.0";

    // 5 reportes por IP cada 10 min: suficiente para un fallo real, inútil
    // para spamear (y alertFounder dedupea por título+hora igual).
    const rl = await checkRateLimit(`clienterr:ip:${ip}`, {
      limit: 5,
      windowSeconds: 600,
    });
    if (!rl.ok) return NextResponse.json({ ok: true });

    const body = (await req.json().catch(() => null)) as {
      digest?: string;
      path?: string;
      message?: string;
    } | null;
    if (!body) return NextResponse.json({ ok: true });

    const digest = String(body.digest ?? "").slice(0, 64) || "sin-digest";
    const path = String(body.path ?? "").split("?")[0]!.slice(0, 200);
    const message = String(body.message ?? "").slice(0, 300);

    await alertFounder({
      titulo: `Pantalla caída en producción (digest ${digest})`,
      detalle: `Un usuario vio el error boundary. Busca el digest en los logs de Vercel para el stack completo.`,
      severidad: "critical",
      contexto: { digest, ruta: path, mensaje: message || "—" },
    });
  } catch {
    // Un reporte roto jamás genera más ruido: responder ok y seguir.
  }
  return NextResponse.json({ ok: true });
}
