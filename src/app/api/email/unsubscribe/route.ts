import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailPreferences } from "@/db/schema";
import { env } from "@/lib/env";

/*
  Baja de correos de UN clic, sin login (CAN-SPAM / List-Unsubscribe):
  - GET: clic humano desde el link del footer → confirma en una página simple.
  - POST: List-Unsubscribe-Post=One-Click (Gmail/Yahoo la disparan solos).
  El token es un uuid opaco por usuario (email_preferences.unsub_token).
*/

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return false;
  const updated = await db
    .update(emailPreferences)
    .set({ unsubscribedAll: true, updatedAt: new Date() })
    .where(eq(emailPreferences.unsubToken, token))
    .returning({ userId: emailPreferences.userId });
  return updated.length > 0;
}

function page(title: string, body: string, ok: boolean) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Aulia</title></head>
<body style="margin:0;font-family:'Nunito Sans',system-ui,sans-serif;background:#F1E8D3;color:#23273A;display:grid;place-items:center;min-height:100dvh">
<div style="max-width:420px;text-align:center;padding:40px 24px">
<div style="font-weight:800;font-size:22px;color:#0E5340;margin-bottom:18px">Aulia</div>
<h1 style="font-size:22px;margin:0 0 10px">${title}</h1>
<p style="color:#565C71;line-height:1.5;margin:0 0 24px">${body}</p>
<a href="${env.NEXT_PUBLIC_SITE_URL ?? "https://aulia.ai"}${ok ? "/app" : ""}" style="background:#1F7A63;color:#fff;text-decoration:none;border-radius:14px;padding:12px 26px;font-weight:800;display:inline-block">Volver a Aulia</a>
</div></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const ok = await unsubscribe(token);
  return ok
    ? page(
        "Listo, no te escribiremos más",
        "Diste de baja los correos de avance y recordatorios. Si te arrepientes, escríbenos a hola@aulia.ai y los reactivamos. Tu progreso sigue intacto.",
        true,
      )
    : page("Enlace inválido", "Este enlace de baja no es válido o ya expiró.", false);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const ok = await unsubscribe(token);
  return new Response(null, { status: ok ? 200 : 400 });
}
