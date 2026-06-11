import { Reveal } from "@/components/marketing/reveal";
import { ArrowDoodle } from "@/components/marketing/landing/icons";

/*
  §5.4 La Bisagra — «Hay una nueva forma» — el giro; clímax del concepto.
  La costura bg-muted → bg-background ruled ES el cambio de mundo.
  Sin mocks: silencio visual. Al revelarse el H2, el selector existente
  [data-reveal][data-revealed] .hl-draw dibuja «nueva forma» (0.9 s, +250 ms).
  En ≥lg los tachados del Acto 1 (sentinel §5.3) ocurren mientras esta
  sección entra: la página se corrige delante del visitante.
  Reduced-motion: subrayado pintado estático desde SSR (red global).
*/

export function Bisagra() {
  return (
    <section
      id="nueva-forma"
      className="cv-auto ruled bg-background py-20 text-center lg:py-32"
    >
      <div className="container-page">
        <Reveal variant="fade-up" threshold={0.4}>
          <h2 className="font-display text-4xl text-balance lg:text-7xl">
            Hay una <span className="hl-draw">nueva forma</span> de aprender.
          </h2>
        </Reveal>

        <Reveal variant="fade-up" delay={200}>
          <p className="mx-auto mt-6 max-w-[52ch] text-lg text-muted-foreground">
            Una que parte al revés: primero tu meta, tu nivel y tu tiempo — y
            recién entonces se diseña el curso. Con un profesor que te habla. En
            serio.
          </p>
        </Reveal>

        <Reveal variant="fade-in" delay={450}>
          <div className="mt-10 inline-flex flex-col items-center gap-1">
            <ArrowDoodle className="text-primary" />
            <p className="hand">mira ✺</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
