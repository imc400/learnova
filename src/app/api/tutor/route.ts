import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { TUTOR_SYSTEM } from "@/lib/ai/prompts";
import { MODELS } from "@/lib/ai/models";

export const maxDuration = 60;

/**
 * Tutor de IA en vivo. Streaming por SSE (Vercel AI SDK 6) con Sonnet 4.6.
 * @ai-sdk/anthropic toma ANTHROPIC_API_KEY del entorno automáticamente.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { messages, context } = (await req.json()) as {
    messages: ModelMessage[];
    context?: string;
  };

  const system = context
    ? `${TUTOR_SYSTEM}\n\n--- Contexto de la lección actual del estudiante ---\n${context}`
    : TUTOR_SYSTEM;

  const result = streamText({
    model: anthropic(MODELS.generator),
    system,
    messages,
  });

  return result.toTextStreamResponse();
}
