import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  lessons,
  modules,
  learningPaths,
  liveSessions,
  homeworkItems,
  routeAgents,
} from "@/db/schema";
import { TUTOR_SYSTEM } from "@/lib/ai/prompts";
import { MODELS } from "@/lib/ai/models";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/ratelimit";
import { appendTutorExchange } from "@/server/queries/tutor";

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

  Memoria (sin migración — tablas tutor_* existentes):
  - lessonId en el body (validado por JOIN de propiedad) habilita: persistir
    cada intercambio en tutor_messages (post-stream, en onFinish — el
    streaming jamás espera la escritura) y el puente con el profesor de voz
    (resumen de la última clase + tareas pendientes, derivado 100% server-side
    de datos propios — nunca del cliente).
  - Sin lessonId el endpoint se comporta como antes (stateless): cero riesgo.
*/

const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 4_000;
const MAX_CONTEXT_CHARS = 8_000;
const MAX_VOICE_SUMMARY_CHARS = 1_200;
// 30 mensajes cada 10 min por usuario: holgado para estudiar, caro de abusar.
const RATE_LIMIT = { limit: 30, windowSeconds: 600 };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Forma del destilado post-clase (summarize.ts) — defensivo ante claims. */
interface ClassSummaryShape {
  summary?: unknown;
  highlight?: unknown;
  homework?: unknown;
}

/**
 * Bloque "MEMORIA DEL PROFESOR DE VOZ" para el system del tutor: nombre del
 * profesor de la ruta, resumen de la última clase y tareas pendientes.
 * Best-effort: si algo falla, el tutor responde igual (sin memoria).
 */
async function buildVoiceMemory(
  userId: string,
  pathId: string,
): Promise<string> {
  try {
    const [sessions, pendingHw, [pathRow]] = await Promise.all([
      db
        .select({ summary: liveSessions.summary })
        .from(liveSessions)
        .where(
          and(
            eq(liveSessions.userId, userId),
            eq(liveSessions.pathId, pathId),
            isNotNull(liveSessions.summary),
          ),
        )
        .orderBy(desc(liveSessions.createdAt))
        .limit(3),
      db
        .select({ task: homeworkItems.task })
        .from(homeworkItems)
        .where(
          and(
            eq(homeworkItems.userId, userId),
            eq(homeworkItems.pathId, pathId),
            eq(homeworkItems.done, false),
          ),
        )
        .orderBy(desc(homeworkItems.createdAt))
        .limit(5),
      db
        .select({ cacheKey: learningPaths.skeletonCacheKey })
        .from(learningPaths)
        .where(eq(learningPaths.id, pathId))
        .limit(1),
    ]);

    const [teacher] = pathRow?.cacheKey
      ? await db
          .select({ name: routeAgents.name })
          .from(routeAgents)
          .where(eq(routeAgents.cacheKey, pathRow.cacheKey))
          .limit(1)
      : [];

    // Primer summary REAL (salta claims en curso {claiming} y descartes
    // {invalid} que también viven en esa columna).
    const distilled = sessions
      .map((s) => s.summary as ClassSummaryShape | null)
      .find((s) => Array.isArray(s?.summary) && s.summary.length > 0);

    const lines: string[] = [];
    if (teacher?.name) {
      lines.push(`- Tu nombre como profesor de esta ruta: ${teacher.name}.`);
    }
    if (distilled) {
      const summaryText = (distilled.summary as string[])
        .filter((s): s is string => typeof s === "string")
        .join(" ")
        .slice(0, MAX_VOICE_SUMMARY_CHARS);
      lines.push(`- Resumen de tu ÚLTIMA clase de voz con este estudiante: ${summaryText}`);
      if (typeof distilled.highlight === "string" && distilled.highlight) {
        lines.push(`- Su logro destacado de esa clase: ${distilled.highlight}`);
      }
    }
    if (pendingHw.length) {
      lines.push(
        `- Tareas que le dejaste y siguen PENDIENTES: ${pendingHw
          .map((h, i) => `${i + 1}. ${h.task}`)
          .join(" | ")}`,
      );
    }
    if (!lines.length) return "";
    return [
      "MEMORIA DEL PROFESOR DE VOZ (misma persona que tú, canal de voz):",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
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

  const { messages, context, lessonId } = (await req.json()) as {
    messages?: { role?: string; content?: unknown }[];
    context?: string;
    lessonId?: string;
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
  const lastUser = history.at(-1);
  if (!lastUser || lastUser.role !== "user") {
    return new Response("mensaje vacío", { status: 400 });
  }
  const lastUserText = lastUser.content as string;

  // lessonId: pertenencia validada por JOIN antes de usar. Inválida o ajena →
  // 404 (no se degrada en silencio: el cliente real siempre la manda bien).
  let lessonPathId: string | null = null;
  if (typeof lessonId === "string" && lessonId.length > 0) {
    if (!UUID_RE.test(lessonId)) {
      return new Response("lección inválida", { status: 400 });
    }
    const [owned] = await db
      .select({ pathId: modules.pathId })
      .from(lessons)
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(learningPaths, eq(learningPaths.id, modules.pathId))
      .where(and(eq(lessons.id, lessonId), eq(learningPaths.userId, user.id)))
      .limit(1);
    if (!owned) return new Response("lección no encontrada", { status: 404 });
    lessonPathId = owned.pathId;
  }

  const boundedContext =
    typeof context === "string" ? context.slice(0, MAX_CONTEXT_CHARS) : "";
  const voiceMemory = lessonPathId
    ? await buildVoiceMemory(user.id, lessonPathId)
    : "";
  const system = [
    TUTOR_SYSTEM,
    boundedContext
      ? `--- Contexto de la lección actual del estudiante ---\n${boundedContext}`
      : "",
    voiceMemory,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = streamText({
    model: anthropic(MODELS.tutor),
    system,
    messages: history,
    maxOutputTokens: 1024,
    // Persistencia POST-stream: el streaming no espera la escritura.
    onFinish: ({ text }) => {
      if (!lessonPathId || !lessonId || !text) return;
      void appendTutorExchange({
        userId: user.id,
        pathId: lessonPathId,
        lessonId,
        userText: lastUserText,
        assistantText: text,
      }).catch((e) => {
        console.error("[tutor] persistencia falló (best-effort)", e);
      });
    },
  });

  return result.toTextStreamResponse();
}
