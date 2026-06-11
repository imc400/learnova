import { getResend, emailFrom } from "@/lib/email/client";

/*
  Alerta crítica al fundador (Día 0 de observabilidad): cuando algo falla
  CON DINERO DE POR MEDIO (pago cobrado sin ruta, generación muerta), no
  puede depender de que el cliente reclame. Correo directo vía Resend;
  jamás lanza (una alerta rota no puede romper el flujo que alerta).
*/

const FOUNDER_EMAIL = "igblancora@gmail.com";

export async function alertFounder(args: {
  titulo: string;
  detalle: string;
  contexto?: Record<string, string | number | null | undefined>;
}): Promise<void> {
  try {
    const resend = getResend();
    if (!resend) {
      console.error("[ops] ALERTA SIN CANAL (RESEND_API_KEY ausente):", args.titulo, args.detalle);
      return;
    }
    const ctx = args.contexto
      ? Object.entries(args.contexto)
          .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#565c71">${k}</td><td style="padding:2px 0"><code>${String(v ?? "—")}</code></td></tr>`)
          .join("")
      : "";
    await resend.emails.send({
      from: emailFrom(),
      to: FOUNDER_EMAIL,
      subject: `[AULIA CRITICAL] ${args.titulo}`,
      html: `<div style="font-family:ui-sans-serif,system-ui;color:#23273a;max-width:560px">
        <p style="font-size:15px;font-weight:700;margin:0 0 8px">${args.titulo}</p>
        <p style="font-size:14px;margin:0 0 12px">${args.detalle}</p>
        ${ctx ? `<table style="font-size:13px;border-collapse:collapse">${ctx}</table>` : ""}
        <p style="font-size:12px;color:#565c71;margin-top:16px">Aulia ops · ${new Date().toISOString()}</p>
      </div>`,
    });
  } catch (e) {
    console.error("[ops] alertFounder falló (no propaga):", e);
  }
}
