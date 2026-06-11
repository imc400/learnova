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

/** Cap server-side de duración: 31 min — ElevenLabs corta la llamada aunque
 *  el cliente esté comprometido (el timer de React es solo UX, no seguridad). */
export const MAX_CALL_SECONDS = 1860;

export type VoiceGender = "m" | "f";
export type VoiceEnergy = "calida" | "energetica" | "serena";

/**
 * POOL DE VOCES — las 5 voces chilenas YA validadas a mano en la cuenta
 * (decisión del fundador 2026-06: es identidad de marca, no se agregan voces
 * sin su oído). Config expandible: agregar una voz = una línea.
 * La IA elige RASGOS (género/energía), jamás IDs — catálogo cerrado, cero
 * alucinación. La resolución a voiceId es determinista (hash del cacheKey).
 */
export const VOICE_POOL: ReadonlyArray<{
  voiceId: string;
  gender: VoiceGender;
  age: string;
  energy: VoiceEnergy;
  desc: string;
}> = [
  {
    voiceId: "oJIuRMopN0sojGjwD6rQ",
    gender: "f",
    age: "joven",
    energy: "calida",
    desc: "Camila — joven, cálida (creatividad, idiomas, bienestar)",
  },
  {
    voiceId: "Fd38GRHtJllY0CuguAy9",
    gender: "f",
    age: "joven",
    energy: "energetica",
    desc: "Victoria — joven (marketing, fitness, emprendimiento)",
  },
  {
    voiceId: "lLsDvdl6OjtZfLJPM2HA",
    gender: "f",
    age: "adulta",
    energy: "serena",
    desc: "Olivia Pro — adulta, estratégica (finanzas, derecho, datos)",
  },
  {
    voiceId: DEFAULT_VOICE_ID,
    gender: "m",
    age: "adulto",
    energy: "calida",
    desc: "Cristian — chileno cercano (la voz del spike, generalista)",
  },
  {
    voiceId: "0cheeVA5B3Cv6DGq65cT",
    gender: "m",
    age: "joven",
    energy: "serena",
    desc: "Alejandro — joven, relajado (yoga, música, fotografía)",
  },
];

/** Hash estable (FNV-1a) para que el mismo esqueleto canónico → siempre la
 *  misma voz (la consistencia de voz entre clases también es memoria). */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Resuelve los rasgos de voz elegidos por la IA a un voiceId del pool.
 * Determinista: filtra por género+energía; si hay >1 candidata, desempata por
 * hash del cacheKey. Fallback: relajar energía → relajar todo (pool completo).
 */
export function resolveVoiceId(
  gender: VoiceGender,
  energy: VoiceEnergy,
  cacheKey: string,
): string {
  const exact = VOICE_POOL.filter((v) => v.gender === gender && v.energy === energy);
  const byGender = VOICE_POOL.filter((v) => v.gender === gender);
  const pool = exact.length ? exact : byGender.length ? byGender : [...VOICE_POOL];
  return pool[stableHash(cacheKey) % pool.length]!.voiceId;
}

/**
 * Herramientas del profesor que corren en el NAVEGADOR del alumno (client
 * tools): la pizarra y el moldear de la ruta. Única fuente de verdad — las
 * usan createVoiceAgent y el script de parcheo de agentes existentes.
 */
export const VOICE_AGENT_TOOLS = [
  {
    // SYSTEM TOOL de ElevenLabs: el agente puede COLGAR la llamada. El
    // criterio pedagógico (cierre confirmado / abuso) vive en el prompt.
    type: "system",
    name: "end_call",
    description:
      "Termina la llamada. Úsala SOLO después de despedirte: cuando el alumno confirme que no tiene más dudas, cuando la conversación esté pedagógicamente agotada, o ante mal uso persistente tras 2 redirecciones.",
  },
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
  {
    type: "client",
    name: "marcar_tarea",
    description:
      "Tacha en vivo una tarea de la lista del alumno (las tareas pendientes vienen NUMERADAS en tu brief). Úsala cuando el alumno te cuente que hizo una tarea: celébralo con especificidad y táchala.",
    parameters: {
      type: "object",
      properties: {
        taskIndex: {
          type: "integer",
          description: "Número de la tarea según el brief (la primera = 1)",
        },
      },
      required: ["taskIndex"],
    },
  },
  {
    type: "client",
    name: "agendar_proxima_clase",
    description:
      "Agenda la próxima clase en N días y programa un recordatorio por correo. Úsala SOLO en el cierre, después de proponer una fecha concreta en voz alta y que el alumno acepte.",
    parameters: {
      type: "object",
      properties: {
        dias: {
          type: "integer",
          description: "En cuántos días será la próxima clase (1 a 14)",
        },
      },
      required: ["dias"],
    },
  },
  {
    type: "client",
    name: "registrar_aprendizaje",
    description:
      "Registra lo que el alumno dijo haber aprendido hoy (su respuesta a tu pregunta metacognitiva del cierre), en SUS palabras. Úsala una vez, en el cierre.",
    parameters: {
      type: "object",
      properties: {
        resumen: {
          type: "string",
          description: "Lo que el alumno dijo haber aprendido, parafraseado fiel (1-2 frases)",
        },
      },
      required: ["resumen"],
    },
  },
  {
    type: "client",
    name: "mostrar_video",
    description:
      "Muestra en la pizarra el video curado de una lección de la ruta (pausado, el alumno decide si lo reproduce). Úsala cuando recomiendes repasar o adelantar un video concreto.",
    parameters: {
      type: "object",
      properties: {
        moduleIndex: {
          type: "integer",
          description: "Índice del módulo desde 0",
        },
        lessonIndex: {
          type: "integer",
          description: "Índice de la lección dentro del módulo, desde 0",
        },
      },
      required: ["moduleIndex", "lessonIndex"],
    },
  },
  {
    type: "client",
    name: "ajustar_dificultad",
    description:
      "Ajusta el ritmo de las próximas clases cuando el alumno pida ir más lento/rápido o tú lo detectes. Anúncialo en voz alta ('voy a ajustar el ritmo para la próxima') antes de usarla.",
    parameters: {
      type: "object",
      properties: {
        direccion: {
          type: "string",
          enum: ["subir", "bajar"],
          description: "subir = más desafío y velocidad; bajar = más pausado y con más ejemplos",
        },
        motivo: {
          type: "string",
          description: "Por qué, en 1 frase basada en la clase",
        },
      },
      required: ["direccion", "motivo"],
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

/** ¿Está configurado el modo seguro (initiation webhook)? El prompt deja de
 *  viajar al navegador y los overrides cliente quedan deshabilitados. */
export function secureInitiationEnabled(): boolean {
  return Boolean(env.ELEVENLABS_WEBHOOK_SECRET && env.NEXT_PUBLIC_SITE_URL);
}

/**
 * platform_settings del agente según el modo:
 * - SEGURO (ELEVENLABS_WEBHOOK_SECRET presente): ElevenLabs pide el prompt +
 *   brief + saludo a nuestro webhook (/api/live/initiation) al iniciar cada
 *   conversación; los overrides desde el navegador quedan APAGADOS → se
 *   cierra el jailbreak, el LLM gratis y la fuga del prompt pedagógico.
 * - LEGADO (sin secret): overrides cliente como hasta ahora (el aula inyecta
 *   el brief por sesión). Documentado como inseguro; migrar con el script.
 */
export function buildAgentPlatformSettings(): Record<string, unknown> {
  if (secureInitiationEnabled()) {
    return {
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: false },
            first_message: false,
            language: false,
          },
        },
        // La data de iniciación viene de NUESTRO webhook (server-side).
        enable_conversation_initiation_client_data_from_webhook: true,
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${env.NEXT_PUBLIC_SITE_URL}/api/live/initiation`,
          request_headers: {
            "x-aulia-webhook-secret": env.ELEVENLABS_WEBHOOK_SECRET,
          },
        },
      },
    };
  }
  console.warn(
    "[live] ELEVENLABS_WEBHOOK_SECRET ausente: agente creado en modo LEGADO (overrides cliente habilitados — el prompt viaja al navegador).",
  );
  return {
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
  };
}

/**
 * Crea el agente de ElevenLabs para una persona de profesor (una vez por
 * route_agent, lazy en la primera clase). El brief por sesión se inyecta vía
 * initiation webhook (modo seguro) u overrides (modo legado).
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
        // Corte duro SERVER-SIDE: hoy nada cortaba si el cliente estaba
        // comprometido. 31 min > 30 del timer (el ritual de cierre manda).
        conversation: {
          max_duration_seconds: MAX_CALL_SECONDS,
        },
      },
      platform_settings: buildAgentPlatformSettings(),
    }),
  });
  if (!res.ok) {
    throw new Error(`[live] create agent ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { agent_id: string };
  return json.agent_id;
}

/**
 * Borra un agente de ElevenLabs. Único uso legítimo: el PERDEDOR de la
 * carrera de creación (dos primeras clases simultáneas del mismo esqueleto)
 * borra su agente huérfano. JAMÁS para agentes ya persistidos en route_agents.
 */
export async function deleteVoiceAgent(agentId: string): Promise<void> {
  const res = await fetch(`${EL_BASE}/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`[live] delete agent ${res.status}`);
  }
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
  /** Agente dueño de la conversación — el destilador valida que coincida con
   *  el de la sesión (un conversationId ajeno no puede inyectar memoria). */
  agentId: string | null;
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
    agent_id?: string;
    metadata?: { call_duration_secs?: number };
    transcript?: {
      role: string;
      message: string | null;
      tool_calls?: { tool_name?: string; name?: string }[] | null;
    }[];
  };
  // Incluye los eventos de tools como líneas [acción: …]: el destilador
  // necesita saber que el profesor agregó un módulo o tachó una tarea para
  // que el resumen del correo lo refleje.
  const transcript: { role: string; message: string }[] = [];
  for (const t of json.transcript ?? []) {
    if (t.message) transcript.push({ role: t.role, message: t.message });
    for (const call of t.tool_calls ?? []) {
      const name = call.tool_name ?? call.name;
      if (name) transcript.push({ role: t.role, message: `[acción del profesor: ${name}]` });
    }
  }
  return {
    status: json.status,
    durationSec: json.metadata?.call_duration_secs ?? 0,
    agentId: json.agent_id ?? null,
    transcript,
  };
}
