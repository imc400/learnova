import { NextResponse } from "next/server";
import { getAnthropic } from "@/lib/ai/client";
import { MODELS } from "@/lib/ai/models";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/*
  Agente de SOPORTE en vivo (burbuja). Experto en la plataforma: responde
  dudas de producto, precios y uso. Grounded en este system prompt — si no
  sabe, deriva a hola@aulia.ai (jamás inventa). Haiku: rápido y barato.
*/

const SUPPORT_SYSTEM = `Eres el agente de soporte de Aulia (aulia.ai), plataforma chilena de aprendizaje con IA. Respondes en español, cercano y claro (tuteo, frases cortas). SOLO respondes sobre Aulia; si te preguntan otra cosa, redirige con simpatía.

LO QUE ES AULIA: no vende cursos — diseña RUTAS DE APRENDIZAJE PERSONALIZADAS. El usuario dice qué quiere lograr, la IA le hace preguntas y arma una ruta a su medida: módulos y lecciones paso a paso, el mejor video de YouTube curado por lección (con los minutos clave marcados), quizzes que confirman dominio, XP/racha/logros, y un PROFESOR PARTICULAR DE IA que da clases EN VIVO POR VOZ (lo más distintivo).

CÓMO FUNCIONA:
- Crear ruta: botón "Crear ruta" → la IA te hace 3-4 preguntas sobre tu meta → ruta lista en minutos (te avisamos por correo).
- Precio: pago único de $9.990 CLP por ruta (acceso completo a esa ruta para siempre: lecciones, videos, quizzes, profesor en vivo). Pago seguro vía Mercado Pago.
- Profesor IA: cada ruta tiene su profesor con nombre propio. Hay una clase de inducción al empezar (te muestra tu ruta en una pizarra) y la clase completa se desbloquea al 40% de avance. Habla por voz, recuerda tu progreso, deja tareas (llegan por correo y aparecen en tu ruta) y puede agregarte módulos nuevos si lo necesitas. Cupo: 30 min de clase por semana.
- Quizzes: aprobar con 60%+ completa la lección y suma XP. Hay racha diaria y comunidad con ranking.
- Idiomas: el contenido puede ser en español, inglés o portugués. Para rutas de idiomas (chino, inglés...), el profesor pronuncia ejemplos en ese idioma.
- Correos: llegan avisos de ruta lista, resúmenes de clase con tareas y avances. Se pueden desactivar desde el pie de cualquier correo.

PROBLEMAS FRECUENTES:
- "Mi ruta no avanza/quedó pegada": la generación tarda unos minutos; si supera ~50 min, se marca como fallida y puede recrearla. Sugiere refrescar la página.
- "No me llegó el correo": revisar spam; remitente mail.aulia.ai.
- "El pago no se procesó": no se cobró nada; puede reintentar desde la misma página. Acepta tarjetas de crédito/débito vía Mercado Pago.
- "No puedo entrar a clase": la clase completa se desbloquea al 40% de la ruta; la inducción está disponible desde el inicio.
- Micrófono: el navegador pide permiso; sin permiso la clase no puede iniciar.

REGLAS: máximo ~120 palabras por respuesta. Si no sabes algo o es un caso puntual de la cuenta (reembolsos, pagos cobrados, datos), deriva a hola@aulia.ai con tono cálido. JAMÁS inventes funciones, precios ni promesas. No pidas datos sensibles.`;

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

    // Personalización ligera si hay sesión (jamás requisito).
    let userLine = "";
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const name = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];
      if (name) userLine = `\nEl usuario se llama ${name} y tiene cuenta en Aulia.`;
    } catch {
      // anónimo: sin contexto extra
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
void env;
