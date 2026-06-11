import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { TUTOR_SYSTEM } from "@/lib/ai/prompts";
import { MODELS } from "@/lib/ai/models";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/ratelimit";

export const maxDuration = 60;

/*
  Tutor de IA en vivo. Streaming por SSE (Vercel AI SDK 6) con Sonnet 4.6.
  @ai-sdk/anthropic toma ANTHROPIC_API_KEY del entorno automáticamente.

  Límites (E-P1.2, mismo patrón que /api/soporte): antes, un usuario
  autenticado podía mandar 150K tokens de contexto por request, ilimitadas
  veces, desde DevTools (~US$0.45/request a Sonnet). Ahora:
  - historial acotado: últimos 12 mensajes, 4.000 chars c/u
  - contexto de lección: 8.000 chars
  - salida: maxOutputTokens 1024
  - rate limit PERSISTENTE por usuario (Postgres, sobrevive cold starts)
  - kill-switch AI_DISABLED (costo diario fuera de umbral → apagar sin deploy)
*/

const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 4_000;
const MAX_CONTEXT_CHARS = 8_000;
// 30 mensajes cada 10 min por usuario: holgado para estudiar, caro de abusar.
const RATE_LIMIT = { limit: 30, windowSeconds: 600 };

function textResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  if (env.AI_DISABLED === "true") {
    return textResponse(
      "El tutor está tomando un descanso técnico — intenta de nuevo en unos minutos.",
      503,
    );
  }

  const rl = await checkRateLimit(`tutor:${user.id}`, RATE_LIMIT);
  if (!rl.ok) {
    return textResponse(
      "Vamos con calma — dame unos segundos y me preguntas de nuevo.",
      429,
    );
  }

  const { messages, context } = (await req.json()) as {
    messages?: { role?: string; content?: unknown }[];
    context?: string;
  };

  // Saneamiento del historial: solo turnos user/assistant con contenido
  // string, acotados en cantidad y tamaño (el cliente real ya manda esto).
  const history: ModelMessage[] = (messages ?? [])
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS_PER_MESSAGE) }));
  if (history.length === 0 || history.at(-1)?.role !== "user") {
    return new Response("mensaje vacío", { status: 400 });
  }

  const boundedContext =
    typeof context === "string" ? context.slice(0, MAX_CONTEXT_CHARS) : "";
  const system = boundedContext
    ? `${TUTOR_SYSTEM}\n\n--- Contexto de la lección actual del estudiante ---\n${boundedContext}`
    : TUTOR_SYSTEM;

  const result = streamText({
    model: anthropic(MODELS.generator),
    system,
    messages: history,
    maxOutputTokens: 1024,
  });

  return result.toTextStreamResponse();
}
