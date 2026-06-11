/* Día 0: profesoras con voz de hombre (DEFAULT_VOICE_ID = Cristian Cornejo).
   Parchea tts.voice_id de los agentes ElevenLabs existentes con nombre
   femenino a voces femeninas chilenas YA disponibles en la cuenta. */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const EL = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY!;

// Voces chilenas de la cuenta (verificadas vía /v2/voices).
const FEMENINAS = [
  { id: "oJIuRMopN0sojGjwD6rQ", n: "Camila (joven, cálida)" },
  { id: "Fd38GRHtJllY0CuguAy9", n: "Victoria (joven)" },
  { id: "lLsDvdl6OjtZfLJPM2HA", n: "Olivia Pro (adulta, estratégica)" },
];
const NOMBRES_F = ["macarena", "antonia", "marcela", "valentina", "camila", "francisca", "constanza", "javiera", "isidora", "catalina", "daniela", "carolina", "paula", "andrea", "olivia", "sofía", "ignacia"];

const agents = await db.execute<{ id: string; name: string; specialty: string; elevenlabs_agent_id: string | null }>(
  sql`select id, name, specialty, elevenlabs_agent_id from route_agents where elevenlabs_agent_id is not null`,
);

let i = 0;
for (const a of agents) {
  const pila = a.name.replace(/^Profe\s+/i, "").toLowerCase();
  const esFemenino = NOMBRES_F.some((n) => pila.startsWith(n));
  if (!esFemenino) { console.log(`· ${a.name} — masculino, mantiene a Cristian`); continue; }
  const voz = FEMENINAS[i % FEMENINAS.length];
  i++;
  const res = await fetch(`${EL}/convai/agents/${a.elevenlabs_agent_id}`, {
    method: "PATCH",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { tts: { voice_id: voz.id } } }),
  });
  console.log(res.ok ? `✓ ${a.name} (${a.specialty.slice(0, 30)}…) → ${voz.n}` : `✗ ${a.name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
}
process.exit(0);
