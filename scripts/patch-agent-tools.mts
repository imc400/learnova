/*
  Parchea agentes de ElevenLabs ya creados para alinearlos con el código:
  - SIEMPRE: client tools (fuente única VOICE_AGENT_TOOLS) + regeneración del
    systemPrompt en BD con el builder actual (avisos [SISTEMA], tools nuevas).
  - --secure: además migra el agente al modo seguro — initiation webhook
    (/api/live/initiation) + overrides cliente APAGADOS + corte server-side
    de 31 min. Requiere ELEVENLABS_WEBHOOK_SECRET y NEXT_PUBLIC_SITE_URL.
    ⚠️ Rollout agente por agente: usar --agent y validar una clase de prueba
    antes de migrar el resto (el aula deja de mandar overrides SOLO cuando
    ELEVENLABS_WEBHOOK_SECRET está seteada en Vercel — coordinar ambos pasos).
  - --agent <elevenlabs_agent_id>: limita el parcheo a UN agente.

  ⚠️ NUNCA toca tts.voice_id: las voces de los agentes existentes fueron
  asignadas a mano (scripts/fix-voces-genero.mts) y la consistencia de voz
  entre clases también es memoria. Los agentes NUEVOS nacen con voz del pool.

  Uso: npx tsx --env-file=.env scripts/patch-agent-tools.mts [--secure] [--agent ag_xxx]
*/
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { routeAgents, skeletonCache } from "../src/db/schema";
import {
  VOICE_AGENT_TOOLS,
  MAX_CALL_SECONDS,
  buildAgentPlatformSettings,
  secureInitiationEnabled,
} from "../src/lib/live/provider";
import { buildTeacherSystemPrompt } from "../src/lib/live/persona";

const EL_BASE = "https://api.elevenlabs.io/v1";
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Falta ELEVENLABS_API_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const secure = args.includes("--secure");
const agentFlagIdx = args.indexOf("--agent");
const onlyAgentId = agentFlagIdx >= 0 ? args[agentFlagIdx + 1] : null;

if (secure && !secureInitiationEnabled()) {
  console.error(
    "--secure requiere ELEVENLABS_WEBHOOK_SECRET y NEXT_PUBLIC_SITE_URL en el entorno.",
  );
  process.exit(1);
}

const agents = await db
  .select({
    id: routeAgents.id,
    name: routeAgents.name,
    specialty: routeAgents.specialty,
    style: routeAgents.style,
    greeting: routeAgents.greeting,
    cacheKey: routeAgents.cacheKey,
    elId: routeAgents.elevenlabsAgentId,
  })
  .from(routeAgents)
  .where(isNotNull(routeAgents.elevenlabsAgentId));

const targets = onlyAgentId ? agents.filter((a) => a.elId === onlyAgentId) : agents;
console.log(
  `Agentes con voz creada: ${agents.length}${onlyAgentId ? ` · filtrados a 1 (--agent)` : ""} · modo: ${secure ? "SEGURO (webhook + overrides off)" : "solo tools"}`,
);
if (onlyAgentId && !targets.length) {
  console.error(`No hay route_agent con elevenlabs_agent_id = ${onlyAgentId}`);
  process.exit(1);
}

for (const a of targets) {
  // NUNCA incluir `tts` en este PATCH: las voces existentes no se tocan.
  const body: Record<string, unknown> = {
    conversation_config: {
      agent: { prompt: { tools: VOICE_AGENT_TOOLS } },
      // Corte duro server-side (31 min) — aplica en ambos modos.
      conversation: { max_duration_seconds: MAX_CALL_SECONDS },
    },
  };
  if (secure) {
    body.platform_settings = buildAgentPlatformSettings();
  }
  const res = await fetch(`${EL_BASE}/convai/agents/${a.elId}`, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(
      `✗ ${a.name} (${a.cacheKey}): ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
    continue;
  }
  console.log(
    `✓ ${a.name} (${a.cacheKey}) — ${VOICE_AGENT_TOOLS.length} tools${secure ? " + initiation webhook + overrides off" : ""}`,
  );

  // El systemPrompt guardado nació ANTES de las reglas nuevas (tools, avisos
  // [SISTEMA] de tiempo) → se regenera con el builder actual. El idioma es el
  // último segmento del cacheKey; el título sale del esqueleto canónico.
  const language = a.cacheKey.split("-").at(-1) ?? "es";
  const [skel] = await db
    .select({ skeleton: skeletonCache.skeleton })
    .from(skeletonCache)
    .where(eq(skeletonCache.cacheKey, a.cacheKey))
    .limit(1);
  const routeTitle =
    (skel?.skeleton as { title?: string } | null)?.title ?? a.specialty;
  const systemPrompt = buildTeacherSystemPrompt({
    persona: {
      name: a.name,
      specialty: a.specialty,
      style: a.style,
      greeting: a.greeting,
      // Solo para satisfacer el tipo Persona: el prompt no usa estos rasgos
      // y la voz del agente existente NO se toca.
      voiceGender: "m",
      voiceEnergy: "calida",
    },
    routeTitle,
    language,
  });
  await db
    .update(routeAgents)
    .set({ systemPrompt, updatedAt: new Date() })
    .where(eq(routeAgents.id, a.id));
  console.log(`  ↻ systemPrompt regenerado (ruta: ${routeTitle})`);

  // En modo seguro el prompt vive en BD y se sirve vía webhook: el PATCH del
  // prompt base del agente en ElevenLabs es solo respaldo coherente.
  if (secure) {
    const promptRes = await fetch(`${EL_BASE}/convai/agents/${a.elId}`, {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: { agent: { prompt: { prompt: systemPrompt } } },
      }),
    });
    console.log(
      promptRes.ok
        ? "  ↻ prompt base del agente actualizado (respaldo)"
        : `  ✗ prompt base no se pudo actualizar: ${promptRes.status}`,
    );
  }
}

process.exit(0);
