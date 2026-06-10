/*
  Parchea agentes de ElevenLabs ya creados para añadirles las client tools de
  PIZARRA (mostrar_ruta / enfocar_modulo). Los agentes nuevos ya nacen con
  ellas (createVoiceAgent); este script alinea a los existentes.
  Uso: npx tsx --env-file=.env scripts/patch-agent-tools.mts
*/
import { isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { routeAgents } from "../src/db/schema";

const EL_BASE = "https://api.elevenlabs.io/v1";
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Falta ELEVENLABS_API_KEY");
  process.exit(1);
}

const PIZARRA_TOOLS = [
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
];

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
        agent: { prompt: { tools: PIZARRA_TOOLS } },
      },
    }),
  });
  if (!res.ok) {
    console.error(
      `✗ ${a.name} (${a.cacheKey}): ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
    continue;
  }
  console.log(`✓ ${a.name} (${a.cacheKey}) — pizarra habilitada`);
}

process.exit(0);
