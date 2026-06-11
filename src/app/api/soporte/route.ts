import { NextResponse } from "next/server";
import { getAnthropic } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { formatPrice } from "@/lib/utils";

/*
  Agente de SOPORTE en vivo (burbuja). Experto en la plataforma: responde
  dudas de producto, precios y uso. Grounded en este system prompt — si no
  sabe, deriva a hola@aulia.ai (jamás inventa). Haiku: rápido y barato.

  Los HECHOS del prompt salen de env/site (precios, cupos): si el negocio
  cambia un número, el agente lo dice bien sin tocar este archivo.
*/

const SUPPORT_SYSTEM = `Eres la IA de soporte de Aulia (aulia.ai), plataforma chilena de aprendizaje con IA. Si te preguntan quién o qué eres: "Soy la IA de soporte de Aulia". Respondes en español, cercano y claro (tuteo, frases cortas). SOLO respondes sobre Aulia; si te preguntan otra cosa, redirige con simpatía.

LO QUE ES AULIA: no vende cursos — diseña RUTAS DE APRENDIZAJE PERSONALIZADAS. El usuario dice qué quiere lograr, la IA le hace preguntas y arma una ruta a su medida: módulos y lecciones paso a paso, el mejor video de YouTube curado por lección (con los minutos clave marcados), quizzes que confirman dominio, XP/racha/logros, y un PROFESOR PARTICULAR DE IA que da clases EN VIVO POR VOZ (lo más distintivo). Las rutas que completas se encadenan en CAMINOS: al cerrar una, se te propone la siguiente etapa.

CÓMO FUNCIONA:
- Crear ruta: botón "Crear ruta" → la IA te hace 3-4 preguntas sobre tu meta → ves tu temario completo antes de pagar → la ruta queda lista en minutos (te avisamos por correo).
- Precios: ruta única ${formatPrice(env.PRICE_ROUTE_CLP, "CLP")}, pago único, tuya para siempre. Aulia Pro: ${formatPrice(env.PRICE_PRO_CLP, "CLP")} por 30 días, SIN cobro automático (renovación manual: pagas 30 días y te avisamos para renovar; si renuevas antes, los días se suman). Pro incluye ${env.PRO_ROUTES_PER_MONTH} rutas nuevas al mes + 120 minutos al mes de clases en vivo, con todos tus profesores + tus rutas se encadenan en Caminos. JAMÁS digas "mensual", "/mes" como modalidad de cobro, "suscripción" ni "ilimitado".
- Pago: seguro vía Flow, con tarjetas de crédito o débito.
- GARANTÍA: 7 días — si no le sirve, escribe a hola@aulia.ai y se devuelve el 100% (deriva ahí los reembolsos, con tono cálido y sin fricción).
- Profesor IA: cada ruta tiene su profesor con nombre propio. Hay una clase de bienvenida al empezar (te muestra tu ruta en una pizarra) y la clase completa se desbloquea al 40% de avance. Habla por voz, recuerda tu progreso, deja tareas (llegan por correo y aparecen en tu ruta) y puede agregarte módulos nuevos si lo necesitas.
- Cupo de clases en vivo: cada ruta incluye ${env.CLASS_MINUTES_PER_ROUTE} minutos de clase. Pro suma además ${env.PRO_MONTHLY_CLASS_MINUTES} minutos al mes para usar con cualquiera de tus profesores.
- Quizzes: aprobar con 60%+ completa la lección y suma XP. Hay racha diaria y comunidad con ranking.
- Idiomas: el contenido puede ser en español, inglés o portugués. Para rutas de idiomas (chino, inglés...), el profesor pronuncia ejemplos en ese idioma.
- Correos: llegan avisos de ruta lista, resúmenes de clase con tareas y avances. Se pueden desactivar desde el pie de cualquier correo.

PROBLEMAS FRECUENTES:
- "Mi ruta no avanza/quedó pegada": la generación tarda unos minutos; si supera ~45 min, se marca como fallida y puede recrearla. Sugiere refrescar la página.
- "No me llegó el correo": revisar spam; remitente mail.aulia.ai.
- "El pago no se procesó": no se cobró nada; puede reintentar desde la misma página. Acepta tarjetas de crédito/débito vía Flow.
- "No puedo entrar a clase": la clase completa se desbloquea al 40% de la ruta; la clase de bienvenida está disponible desde el inicio.
- Micrófono: el navegador pide permiso; sin permiso la clase no puede iniciar.

REGLAS: máximo ~120 palabras por respuesta. Si no sabes algo o es un caso puntual de la cuenta (reembolsos, pagos cobrados, datos), deriva a hola@aulia.ai con tono cálido. JAMÁS inventes funciones, precios ni promesas. No pidas datos sensibles.`;

/*
  Rate limit: token bucket EN MEMORIA por usuario (y por instancia).
  LIMITACIÓN SERVERLESS (documentada a propósito): en Vercel/Lambda cada
  instancia tiene su propio Map y los cold starts lo resetean, así que el
  límite es "best effort" — suficiente porque (a) el endpoint ya exige
  sesión Supabase para llamar a la IA, (b) el historial va acotado a 12
  mensajes de 1500 chars y (c) el modelo es Haiku. Si algún día hace falta
  un límite global de verdad: ventana fija en una tabla Supabase o Upstash.
*/
const BUCKET_CAPACITY = 8; // ráfaga máxima
const REFILL_MS = 15_000; // 1 token cada 15 s (~4 msg/min sostenidos)
const buckets = new Map<string, { tokens: number; last: number }>();

function takeToken(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: BUCKET_CAPACITY, last: now };
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + (now - b.last) / REFILL_MS);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  // Poda simple para que el Map no crezca sin techo en instancias longevas.
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) {
      if (now - v.last > 10 * 60_000) buckets.delete(k);
    }
  }
  return true;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
    };
    const history = (body.messages ?? [])
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0,
      )
      .slice(-12) // contexto acotado: costo y abuso controlados
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!history.length || history.at(-1)?.role !== "user") {
      return NextResponse.json({ error: "mensaje vacío" }, { status: 400 });
    }

    // Sesión Supabase OBLIGATORIA para gastar tokens de IA: la burbuja vive
    // dentro de /app (usuarios logueados). Un anónimo recibe una respuesta
    // amable (mismo contrato { reply }) sin tocar el modelo.
    let userId: string | null = null;
    let userLine = "";
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        const name = (user.user_metadata?.full_name as string | undefined)?.split(" ")[0];
        if (name) userLine = `\nEl usuario se llama ${name} y tiene cuenta en Aulia.`;
      }
    } catch {
      userId = null;
    }
    if (!userId) {
      return NextResponse.json(
        {
          reply:
            "Para chatear conmigo necesitas iniciar sesión en tu cuenta. Si aún no tienes una, escríbenos a hola@aulia.ai y te respondemos al tiro.",
        },
        { status: 200 },
      );
    }

    if (!takeToken(userId)) {
      return NextResponse.json(
        { reply: "Vamos con calma — dame unos segundos y me preguntas de nuevo." },
        { status: 429 },
      );
    }

    const client = getAnthropic();
    const res = await client.messages.create({
      model: MODELS.ranker,
      max_tokens: 400,
      system: SUPPORT_SYSTEM + userLine,
      messages: history,
    });
    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    return NextResponse.json({ reply: text || "¿Me lo repites? No te entendí bien." });
  } catch (e) {
    console.error("[soporte]", e);
    return NextResponse.json(
      { reply: `Estamos con un problema técnico. Escríbenos a hola@aulia.ai y te respondemos rapidito.` },
      { status: 200 },
    );
  }
}

export const runtime = "nodejs";
