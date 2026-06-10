/*
  Parchea agentes de ElevenLabs ya creados para alinear sus client tools
  (pizarra + agregar_modulo) con la fuente única VOICE_AGENT_TOOLS. Los
  agentes nuevos ya nacen con ellas (createVoiceAgent).
  Uso: npx tsx --env-file=.env scripts/patch-agent-tools.mts
*/
import { isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { routeAgents } from "../src/db/schema";
import { VOICE_AGENT_TOOLS } from "../src/lib/live/provider";

const EL_BASE = "https://api.elevenlabs.io/v1";
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Falta ELEVENLABS_API_KEY");
  process.exit(1);
}

const agents = await db
  .select({
    id: routeAgents.id,
    name: routeAgents.name,
    cacheKey: routeAgents.cacheKey,
    elId: routeAgents.elevenlabsAgentId,
  })
  .from(routeAgents)
  .where(isNotNull(routeAgents.elevenlabsAgentId));

console.log(`Agentes con voz creada: ${agents.length}`);

for (const a of agents) {
  const res = await fetch(`${EL_BASE}/convai/agents/${a.elId}`, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_config: {
        agent: { prompt: { tools: VOICE_AGENT_TOOLS } },
      },
    }),
  });
  if (!res.ok) {
    console.error(
      `✗ ${a.name} (${a.cacheKey}): ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
    continue;
  }
  console.log(`✓ ${a.name} (${a.cacheKey}) — ${VOICE_AGENT_TOOLS.length} tools`);
}

process.exit(0);
