import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/*
  PUENTE del retorno de pago de Flow. Flow devuelve el navegador vía POST
  cross-site (sin cookies SameSite) → cualquier página con auth rompería.
  Este handler es PÚBLICO y solo convierte ese POST en un redirect 303 GET
  a la página de retorno — la navegación GET sí lleva la sesión. No toca
  dinero: la confirmación real siempre la hace el webhook firmado.
*/

function bridge(intentId: string | null): NextResponse {
  const safe = intentId && /^[0-9a-f-]{36}$/i.test(intentId) ? intentId : null;
  const dest = safe ? `/app/pagar/${safe}/retorno` : "/app";
  return NextResponse.redirect(`${env.NEXT_PUBLIC_SITE_URL}${dest}`, 303);
}

export async function POST(req: Request) {
  return bridge(new URL(req.url).searchParams.get("intent"));
}

export async function GET(req: Request) {
  return bridge(new URL(req.url).searchParams.get("intent"));
}
