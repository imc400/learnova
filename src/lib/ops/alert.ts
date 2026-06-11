import { getResend, emailFrom } from "@/lib/email/client";
import { db } from "@/db";
import { opsIncidents } from "@/db/schema";
import { env } from "@/lib/env";

/*
  Alerta al fundador (E-P0.2, versión completa sobre el mínimo del Día 0):
  cuando algo falla CON DINERO DE POR MEDIO (pago cobrado sin ruta, generación
  muerta, cuota agotada), no puede depender de que el cliente reclame.

  Canales, en orden:
  1. INSERT en ops_incidents — el UNIQUE (title, hora UTC) es el DEDUPE: una
     ráfaga del mismo fallo registra/alerta UNA vez por hora. Además alimenta
     el banner rojo del admin.
  2. Correo vía Resend a igblancora@gmail.com (critical y warning).
  3. WhatsApp vía CallMeBot — SOLO severity critical y solo si
     CALLMEBOT_PHONE/CALLMEBOT_APIKEY están configuradas (degradación suave).

  JAMÁS lanza: una alerta rota no puede romper el flujo que alerta.
  Compatibilidad: los call-sites del Día 0 ({titulo, detalle, contexto})
  siguen funcionando — severidad default "critical".
*/

const FOUNDER_EMAIL = "igblancora@gmail.com";

export type AlertSeverity = "critical" | "warning";

export async function alertFounder(args: {
  titulo: string;
  detalle: string;
  severidad?: AlertSeverity;
  contexto?: Record<string, string | number | null | undefined>;
}): Promise<void> {
  const severidad: AlertSeverity = args.severidad ?? "critical";

  // 1) ops_incidents con dedupe por hora. Si el INSERT no devuelve fila, el
  // mismo título ya alertó esta hora → no re-spamear correo ni WhatsApp.
  // Si la BD falla (p.ej. es ELLA el incidente), seguimos con los canales.
  let isDuplicate = false;
  try {
    const inserted = await db
      .insert(opsIncidents)
      .values({
        severity: severidad,
        title: args.titulo,
        detail: [
          args.detalle,
          args.contexto
            ? Object.entries(args.contexto)
                .map(([k, v]) => `${k}: ${String(v ?? "—")}`)
                .join(" · ")
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
      .onConflictDoNothing()
      .returning({ id: opsIncidents.id });
    isDuplicate = inserted.length === 0;
  } catch (e) {
    console.error("[ops] registro en ops_incidents falló (sigo con correo):", e);
  }
  if (isDuplicate) {
    console.warn(`[ops] alerta deduplicada (misma hora): ${args.titulo}`);
    return;
  }

  // 2) Correo (Resend).
  try {
    const resend = getResend();
    if (!resend) {
      console.error(
        "[ops] ALERTA SIN CANAL DE CORREO (RESEND_API_KEY ausente):",
        args.titulo,
        args.detalle,
      );
    } else {
      const ctx = args.contexto
        ? Object.entries(args.contexto)
            .map(
              ([k, v]) =>
                `<tr><td style="padding:2px 12px 2px 0;color:#565c71">${k}</td><td style="padding:2px 0"><code>${String(v ?? "—")}</code></td></tr>`,
            )
            .join("")
        : "";
      await resend.emails.send({
        from: emailFrom(),
        to: FOUNDER_EMAIL,
        subject: `[AULIA ${severidad.toUpperCase()}] ${args.titulo}`,
        html: `<div style="font-family:ui-sans-serif,system-ui;color:#23273a;max-width:560px">
        <p style="font-size:15px;font-weight:700;margin:0 0 8px">${args.titulo}</p>
        <p style="font-size:14px;margin:0 0 12px">${args.detalle}</p>
        ${ctx ? `<table style="font-size:13px;border-collapse:collapse">${ctx}</table>` : ""}
        <p style="font-size:12px;color:#565c71;margin-top:16px">Aulia ops · ${severidad} · ${new Date().toISOString()}</p>
      </div>`,
      });
    }
  } catch (e) {
    console.error("[ops] correo de alerta falló (no propaga):", e);
  }

  // 3) WhatsApp (CallMeBot) — solo critical, solo con credenciales presentes.
  if (severidad === "critical" && env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY) {
    try {
      const text = encodeURIComponent(
        `[AULIA CRITICAL] ${args.titulo} — ${args.detalle.slice(0, 200)}`,
      );
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.CALLMEBOT_PHONE)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}&text=${text}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.error(`[ops] CallMeBot respondió ${res.status} (no propaga)`);
      }
    } catch (e) {
      console.error("[ops] WhatsApp de alerta falló (no propaga):", e);
    }
  }
}
