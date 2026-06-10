import { env } from "@/lib/env";

/*
  VoiceProvider — capa propia sobre el proveedor de voz (hoy ElevenLabs Agents,
  mañana LiveKit sin tocar UI ni pedagogía). La identidad pedagógica (persona,
  memoria, currículo) vive SIEMPRE en nuestra BD; aquí solo viaja lo necesario
  para abrir una conversación de voz.
*/

const EL_BASE = "https://api.elevenlabs.io/v1";
/** Voz por defecto validada en el spike: Cristian Cornejo (chileno, multilingüe). */
export const DEFAULT_VOICE_ID = "ClNifCEVq1smkl4M3aTk";

/**
 * Herramientas del profesor que corren en el NAVEGADOR del alumno (client
 * tools): la pizarra y el moldear de la ruta. Única fuente de verdad — las
 * usan createVoiceAgent y el script de parcheo de agentes existentes.
 */
export const VOICE_AGENT_TOOLS = [
  {
    type: "client",
    name: "mostrar_ruta",
    description:
      "Muestra el mapa completo de la ruta en la pantalla del alumno (la pizarra). Úsala cuando vayas a recorrer la ruta o quieras que vea la estructura completa.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "client",
    name: "enfocar_modulo",
    description:
      "Resalta UN módulo en la pizarra del alumno y muestra sus lecciones. Úsala cuando expliques un módulo específico.",
    parameters: {
      type: "object",
      properties: {
        moduleIndex: {
          type: "integer",
          description: "Índice del módulo desde 0 (módulo 1 = 0)",
        },
      },
      required: ["moduleIndex"],
    },
  },
  {
    type: "client",
    name: "agregar_modulo",
    description:
      "Agrega un módulo NUEVO a la ruta del alumno (se genera al terminar la clase, con lecciones, videos y quizzes). Úsala SOLO cuando detectes un vacío real o el alumno pida profundizar algo que la ruta no cubre, y SIEMPRE anunciándolo en voz alta antes.",
    parameters: {
      type: "object",
      properties: {
        titulo: {
          type: "string",
          description: "Título corto del módulo a agregar, ej: 'Iluminación con luz natural'",
        },
        razon: {
          type: "string",
          description: "Por qué este alumno lo necesita (1-2 frases, basadas en la clase)",
        },
      },
      required: ["titulo", "razon"],
    },
  },
];

function headers() {
  if (!env.ELEVENLABS_API_KEY) throw new Error("[live] Falta ELEVENLABS_API_KEY");
  return {
    "xi-api-key": env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };
}

/**
 * Crea el agente de ElevenLabs para una persona de profesor (una vez por
 * route_agent, lazy en la primera clase). Los overrides por sesión van
 * habilitados: el brief del alumno se inyecta al iniciar cada conversación.
 */
export async function createVoiceAgent(args: {
  name: string;
  systemPrompt: string;
  greeting: string;
  language: string; // "es" | "en"
  voiceId?: string;
}): Promise<string> {
  const res = await fetch(`${EL_BASE}/convai/agents/create`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: `Aulia · ${args.name}`,
      conversation_config: {
        agent: {
          language: args.language.slice(0, 2) === "en" ? "en" : "es",
          prompt: {
            prompt: args.systemPrompt,
            llm: "claude-sonnet-4-6",
            tools: VOICE_AGENT_TOOLS,
          },
          first_message: args.greeting,
        },
        tts: {
          model_id: "eleven_flash_v2_5",
          voice_id: args.voiceId ?? DEFAULT_VOICE_ID,
        },
      },
      platform_settings: {
        overrides: {
          // Permite inyectar por sesión el brief del alumno y el saludo con
          // memoria, sin mutar el agente (sin carreras entre sesiones).
          conversation_config_override: {
            agent: {
              prompt: { prompt: true },
              first_message: true,
              language: true,
            },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`[live] create agent ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { agent_id: string };
  return json.agent_id;
}

/** Token efímero para que el browser abra la conversación WebRTC. */
export async function getSessionCredentials(agentId: string): Promise<{
  signedUrl: string;
}> {
  const res = await fetch(
    `${EL_BASE}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: headers() },
  );
  if (!res.ok) {
    throw new Error(`[live] signed-url ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { signed_url: string };
  return { signedUrl: json.signed_url };
}

/** Transcripción de una conversación terminada (para el resumen post-clase). */
export async function getConversationTranscript(conversationId: string): Promise<{
  status: string;
  durationSec: number;
  transcript: { role: string; message: string }[];
}> {
  const res = await fetch(`${EL_BASE}/convai/conversations/${conversationId}`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`[live] get conversation ${res.status}`);
  }
  const json = (await res.json()) as {
    status: string;
    metadata?: { call_duration_secs?: number };
    transcript?: { role: string; message: string | null }[];
  };
  return {
    status: json.status,
    durationSec: json.metadata?.call_duration_secs ?? 0,
    transcript: (json.transcript ?? [])
      .filter((t) => t.message)
      .map((t) => ({ role: t.role, message: t.message! })),
  };
}
