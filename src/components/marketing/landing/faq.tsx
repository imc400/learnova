import type { ReactNode } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { Chevron } from "@/components/marketing/landing/icons";
import { formatPrice } from "@/lib/utils";

/**
 * §5.13 FAQ — 8 <details> nativos, cero JS. Una sola Reveal para la sección.
 * El chevron rota con group-open; la apertura es nativa del navegador.
 */

interface FaqItem {
  q: string;
  a: ReactNode;
}

const FAQS: FaqItem[] = [
  {
    q: "¿Cuánto cuesta?",
    a: (
      <>
        Tu ruta completa cuesta {formatPrice(9990, "CLP")}, una sola vez, y es tuya para
        siempre. Si quieres más, Aulia Pro cuesta {formatPrice(24990, "CLP")} por 30
        días: 2 rutas al mes y 120 minutos de clases en vivo.
      </>
    ),
  },
  {
    q: "¿Me van a cobrar todos los meses?",
    a: "No. Pro se paga por 30 días y, cuando se acercan a terminar, te avisamos para que decidas si renuevas. Cero cobro automático, cero permanencia.",
  },
  {
    q: "¿Puedo ver lo que compro antes de pagar?",
    a: "Sí. Apenas la IA diseña tu ruta, ves el temario completo — módulo por módulo, hecho para tu meta — antes de poner un peso.",
  },
  {
    q: "¿Y si no me gusta?",
    a: "Tienes 7 días de garantía: escribes a hola@aulia.ai y te devolvemos el 100%.",
  },
  {
    q: "¿Es solo YouTube con otra cara?",
    a: "No. La IA elige el mejor video para cada lección y lo verifica contra lo que esa lección debe enseñarte; si ninguno la cubre bien, la lección queda sin video antes que con relleno. Además te marca los minutos clave y los quizzes citan el contenido real del video.",
  },
  {
    q: "¿El profesor es una persona real?",
    a: "Es una inteligencia artificial, y no lo oculta. Tiene nombre, especialidad y voz, da clases en vivo, recuerda tu avance y tus respuestas, y te deja tareas. La conversación se transcribe para tu resumen.",
  },
  {
    q: "¿Cuánto demora mi ruta en estar lista?",
    a: "La estructura, unos 2 minutos. El contenido se completa lección por lección — lo primero que vas a estudiar se genera primero — y te avisamos al correo cuando tu primer módulo está listo.",
  },
  {
    q: "¿En qué idioma están las clases y los videos?",
    a: "En español (también hay rutas en inglés). Si un tema muy de nicho no tiene buen video en español, te lo decimos de frente.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="cv-auto py-16 lg:py-24">
      <div className="container-page">
        <Reveal variant="fade-up" className="mx-auto max-w-2xl">
          <h2 className="mb-8 font-display text-3xl font-bold tracking-tight text-center sm:text-4xl">
            Lo que la gente pregunta
          </h2>
          {FAQS.map((item) => (
            <details key={item.q} className="group border-b border-border">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 font-display text-base font-medium [&::-webkit-details-marker]:hidden">
                <span>{item.q}</span>
                <Chevron className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
