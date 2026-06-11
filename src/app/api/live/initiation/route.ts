import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { liveSessions } from "@/db/schema";
import { env } from "@/lib/env";
import { buildSessionInitiation } from "@/lib/live/initiation";

/*
  Conversation initiation webhook de ElevenLabs (modo seguro, C-P0.3):
  al iniciar cada conversación, ElevenLabs llama AQUÍ (server-to-server, con
  el secret compartido en el header) y recibe prompt + brief + saludo. El
  system prompt pedagógico (IP del producto) deja de viajar al navegador y
  los overrides cliente quedan deshabilitados → sin jailbreak ni LLM gratis
  con la signedUrl. El aula identifica la sesión vía dynamic variable
  session_id (UUID no adivinable); además validamos que el agente de la
  conversación sea el de la ruta de esa sesión.
*/

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comparación constante (hash previo: los largos pueden diferir). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(req: Request) {
  const secret = env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    // Sin secret configurado el modo seguro está apagado: nadie debería
    // llamar aquí (los agentes legados usan overrides cliente). Si ESTE log
    // aparece, hay un agente parcheado --secure con la env ausente en este
    // deploy (rollout a medias): su clase saldrá con el prompt base, sin
    // brief. Reparar = setear ELEVENLABS_WEBHOOK_SECRET aquí o des-parchear.
    console.error(
      "[live] initiation webhook invocado SIN ELEVENLABS_WEBHOOK_SECRET en este entorno: hay un agente migrado a modo seguro antes de tiempo (clase degradada al prompt base).",
    );
    return new NextResponse("initiation webhook deshabilitado", { status: 503 });
  }
  const header = req.headers.get("x-aulia-webhook-secret") ?? "";
  if (!header || !safeEqual(header, secret)) {
    // Secret distinto entre el header horneado en el agente y este deploy:
    // ElevenLabs no recibe iniciación → clase con prompt base, sin brief.
    // Silencioso para el alumno; ruidoso aquí para repararlo (re-parchear el
    // agente con el MISMO secret de producción).
    console.error(
      "[live] initiation webhook con secret INVÁLIDO: el header del agente no calza con ELEVENLABS_WEBHOOK_SECRET (¿se rotó la env sin re-parchear los agentes?).",
    );
    return new NextResponse("no autorizado", { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return new NextResponse("body inválido", { status: 400 });

  // session_id viaja como dynamic variable desde el aula. Forma defensiva:
  // distintas versiones del payload la anidan distinto.
  const dyn =
    (body.dynamic_variables as Record<string, unknown> | undefined) ??
    ((body.conversation_initiation_client_data as Record<string, unknown> | undefined)
      ?.dynamic_variables as Record<string, unknown> | undefined) ??
    {};
  const sessionId = typeof dyn.session_id === "string" ? dyn.session_id : null;
  if (!sessionId || !UUID_RE.test(sessionId)) {
    console.error("[live] initiation webhook sin session_id válido");
    return new NextResponse("falta session_id", { status: 400 });
  }

  // Solo sesiones in_progress (un UUID viejo no revive una clase cerrada).
  const init = await buildSessionInitiation(sessionId);
  if (!init) return new NextResponse("sesión no vigente", { status: 404 });

  // El agente que pide la iniciación debe ser EL de la ruta de la sesión.
  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;
  if (agentId && init.elevenlabsAgentId && agentId !== init.elevenlabsAgentId) {
    console.error("[live] initiation webhook: agent mismatch", {
      sessionId,
      esperado: init.elevenlabsAgentId,
      recibido: agentId,
    });
    return new NextResponse("agente no corresponde", { status: 403 });
  }

  // Refuerzo server-side del attach: si el payload trae el conversation_id,
  // se persiste YA — el resumen post-clase no depende del cliente.
  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id : null;
  if (conversationId?.startsWith("conv_") && conversationId.length <= 200) {
    await db
      .update(liveSessions)
      .set({ conversationId, updatedAt: new Date() })
      .where(eq(liveSessions.id, sessionId))
      .catch((e: unknown) =>
        console.error("[live] initiation: no se pudo persistir conversationId:", e),
      );
  }

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: {
        prompt: { prompt: init.prompt },
        first_message: init.firstMessage,
        language: init.language,
      },
    },
  });
}
