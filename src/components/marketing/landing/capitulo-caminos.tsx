import { Reveal } from "@/components/marketing/reveal";
import { ArrowDoodle, Check } from "@/components/marketing/landing/icons";

/*
  Capítulo 5 — Caminos (§5.9). Cierra el loop de Camila: la ruta del hero
  reaparece completada como Etapa 1. Banda angosta centrada sobre papel
  rayado; mock de 3 fichas conectadas por flechas manuscritas (verticales
  en mobile, rotadas -90° en desktop para apuntar a la derecha).
  Reveals intercalados: etapas fade-up, flechas fade-in, stagger 150 ms.
*/

export function CapituloCaminos() {
  return (
    <section id="capitulo-5" className="cv-auto ruled bg-background py-16">
      <div className="container-page">
        <Reveal as="div" variant="fade-up" className="mx-auto max-w-2xl text-center">
          <span className="tab-note">capítulo 5 · lo que viene</span>
          <h2 className="mt-6 font-display text-3xl text-balance sm:text-4xl">
            Tu siguiente curso no existe todavía. Se diseña cuando llegas ahí.
          </h2>
          <p className="mt-5 text-muted-foreground">
            Al completar tu ruta, la IA diseña tu continuación a partir de lo que ya dominaste —
            citando los módulos que aprobaste, un nivel más arriba. Tus rutas se van encadenando
            en Caminos: etapas conectadas que cuentan tu historia.
          </p>
        </Reveal>

        {/* Nota manuscrita sobre la flecha del mock */}
        <Reveal as="div" variant="fade-in" delay={300} className="mt-10 text-center">
          <p className="hand inline-block rotate-[-2deg]">
            esto no lo puede hacer un catálogo ✺
          </p>
        </Reveal>

        {/* Mock Caminos: 3 fichas conectadas */}
        <div className="mx-auto mt-4 flex max-w-xs flex-col items-center gap-2 lg:max-w-none lg:flex-row lg:items-center lg:justify-center lg:gap-3">
          <Reveal as="div" variant="fade-up" index={0} stagger={150} className="w-full lg:w-64">
            <div className="rounded-lg border border-border bg-card p-4 shadow-soft">
              <p className="flex items-center justify-center gap-2 font-display text-base">
                <Check size={16} className="shrink-0 text-primary" />
                Etapa 1 · Fotografía con tu celular
              </p>
            </div>
          </Reveal>

          <Reveal as="div" variant="fade-in" index={1} stagger={150} className="shrink-0">
            <ArrowDoodle size={36} className="text-primary lg:-rotate-90" />
          </Reveal>

          <Reveal as="div" variant="fade-up" index={2} stagger={150} className="w-full lg:w-64">
            <div className="rounded-lg border-2 border-primary bg-card p-4 shadow-soft">
              <p className="text-center font-display text-base">Etapa 2 · Composición avanzada</p>
            </div>
          </Reveal>

          <Reveal as="div" variant="fade-in" index={3} stagger={150} className="shrink-0">
            <ArrowDoodle size={36} className="text-primary lg:-rotate-90" />
          </Reveal>

          <Reveal as="div" variant="fade-up" index={4} stagger={150} className="w-full lg:w-64">
            <div className="rounded-lg border-2 border-dashed border-border bg-card/60 p-4">
              <p className="text-center font-display text-base">
                Etapa 3 · <span className="hand">se diseñará contigo</span>
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
