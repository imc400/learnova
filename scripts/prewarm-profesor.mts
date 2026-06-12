/*
  Pre-calienta el profesor en vivo de una ruta: crea la persona (route_agents)
  y su agente de voz en ElevenLabs — exactamente lo que hace startClassAction
  en el primer clic, pero con los errores A LA VISTA (para diagnosticar por
  qué un aula no levanta) y sin depender del navegador.

  Uso: npx tsx --env-file=.env scripts/prewarm-profesor.mts <pathId>
*/
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { learningPaths, routeAgents, skeletonCache } from "../src/db/schema";
import { getOrCreateRouteAgent } from "../src/lib/live/persona";
import { createVoiceAgent } from "../src/lib/live/provider";
import type { PathSkeleton } from "../src/lib/ai/schemas";

const pathId = process.argv[2];
if (!pathId) {
  console.error("Uso: npx tsx --env-file=.env scripts/prewarm-profesor.mts <pathId>");
  process.exit(1);
}

const [path] = await db
  .select({
    id: learningPaths.id,
    title: learningPaths.title,
    language: learningPaths.language,
    skeletonCacheKey: learningPaths.skeletonCacheKey,
  })
  .from(learningPaths)
  .where(eq(learningPaths.id, pathId))
  .limit(1);
if (!path) {
  console.error(`Ruta ${pathId} no existe`);
  process.exit(1);
}
console.log(`Ruta: "${path.title}" (${path.language}) — cacheKey: ${path.skeletonCacheKey}`);

const cacheKey = path.skeletonCacheKey ?? `path-${path.id}`;
const [skel] = path.skeletonCacheKey
  ? await db
      .select({ skeleton: skeletonCache.skeleton })
      .from(skeletonCache)
      .where(eq(skeletonCache.cacheKey, path.skeletonCacheKey))
      .limit(1)
  : [];
const skeleton = (skel?.skeleton as PathSkeleton | undefined) ?? {
  title: path.title,
  modules: [],
};
console.log(`Esqueleto: ${skeleton.modules.length} módulos ${skel ? "(de caché)" : "(FALLBACK sin módulos)"}`);

console.log("1/2 Creando persona del profesor…");
const agent = await getOrCreateRouteAgent(cacheKey, skeleton, path.language);
console.log(`   → ${agent.name} (${agent.specialty}) · voz ${agent.voiceId} · approved=${agent.approved} · elevenlabsAgentId=${agent.elevenlabsAgentId ?? "NULL"}`);

if (!agent.elevenlabsAgentId) {
  console.log("2/2 Creando agente de voz en ElevenLabs…");
  const elId = await createVoiceAgent({
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    greeting: agent.greeting,
    language: path.language,
    voiceId: agent.voiceId ?? undefined,
  });
  const won = await db
    .update(routeAgents)
    .set({ elevenlabsAgentId: elId, updatedAt: new Date() })
    .where(and(eq(routeAgents.id, agent.id), isNull(routeAgents.elevenlabsAgentId)))
    .returning({ id: routeAgents.id });
  console.log(`   → agente ElevenLabs ${elId} ${won.length ? "persistido" : "(otro proceso ganó la carrera)"}`);
} else {
  console.log("2/2 Agente de voz ya existía — nada que hacer.");
}

console.log("✅ Profesor listo: el aula de esta ruta levanta al primer clic.");
process.exit(0);
