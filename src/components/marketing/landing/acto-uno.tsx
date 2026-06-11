import type { CSSProperties, ReactNode } from "react";

import { Reveal } from "@/components/marketing/reveal";
import { Check } from "@/components/marketing/landing/icons";

/*
  §5.3 Acto 1 — «¿Te suena?» — espejo del dolor (la vieja forma).

  Momento firma responsive:
  - <lg: cada ficha se tacha al entrar SU ficha al viewport
    (.strike-on-reveal-mobile, delay 450 ms post-reveal, cableado en CSS).
  - ≥lg: tachado masivo coordinado con la Bisagra vía Reveal sentinel
    (variant="none", rootMargin -55% inferior) en el grid
    (.strike-on-reveal-desktop), stagger 0/120/240/360 ms por --strike-delay.
  Reduced-motion / sin JS: base de strike-draw = tachado YA pintado.
*/

/* --- Mini-mocks CSS grises de tinta (decoración, aria-hidden) --- */

function MockPlaylist() {
  const anchos = ["w-4/5", "w-3/5", "w-full", "w-2/3", "w-5/6", "w-1/2"];
  return (
    <div aria-hidden="true" className="flex h-16 flex-col justify-center gap-1.5">
      {anchos.map((ancho, i) => (
        <div key={ancho} className="flex items-center gap-1.5">
          {i < 2 ? (
            <Check size={10} className="shrink-0 text-muted-foreground/60" />
          ) : (
            <span className="size-2.5 shrink-0 rounded-full border border-border" />
          )}
          <div className={`h-1 rounded-full bg-border ${ancho}`} />
        </div>
      ))}
    </div>
  );
}

function MockBarra() {
  return (
    <div aria-hidden="true" className="flex h-16 items-center">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="progress-fill animate-tick-progress h-full rounded-full bg-muted-foreground/50"
          style={{ "--progress": 0.08 } as CSSProperties}
        />
      </div>
    </div>
  );
}

function MockPestanas() {
  const giros = [
    "rotate-[-14deg] -translate-x-8",
    "rotate-[-7deg] -translate-x-4",
    "rotate-0",
    "rotate-[7deg] translate-x-4",
    "rotate-[14deg] translate-x-8",
  ];
  return (
    <div aria-hidden="true" className="relative h-16">
      {giros.map((giro) => (
        <div
          key={giro}
          className={`absolute left-1/2 top-1/2 h-11 w-8 -translate-y-1/2 rounded-[4px] bg-border ${giro} -ml-4`}
        />
      ))}
    </div>
  );
}

function MockChatSolo() {
  return (
    <div aria-hidden="true" className="flex h-16 flex-col justify-end gap-1.5 pb-1">
      <div className="h-1 w-1/3 rounded-full bg-border/70" />
      <div className="w-fit max-w-full rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] leading-none text-muted-foreground/70">
        escribe un mensaje…
      </div>
    </div>
  );
}

/* --- Fichas (copy verbatim) --- */

const fichas: {
  id: string;
  titulo: string;
  cuerpo: string;
  rotacion: string;
  mock: ReactNode;
}[] = [
  {
    id: "playlist",
    titulo: "La playlist eterna",
    cuerpo: "La guardaste un domingo con toda la fe. Vas en el video 2 de 43.",
    rotacion: "rotate-[-1deg] lg:rotate-[-1.5deg]",
    mock: <MockPlaylist />,
  },
  {
    id: "curso",
    titulo: "El curso enlatado",
    cuerpo:
      "Grabado hace años, para un alumno promedio que no eres tú. La barra de avance lo sabe.",
    rotacion: "rotate-[1deg] lg:rotate-[1deg]",
    mock: <MockBarra />,
  },
  {
    id: "pestanas",
    titulo: "Las mil pestañas",
    cuerpo: "Un tutorial por aquí, un blog por allá. Nada conversa con nada.",
    rotacion: "rotate-[-1deg] lg:rotate-[-0.5deg]",
    mock: <MockPestanas />,
  },
  {
    id: "solo",
    titulo: "Estudiar solo",
    cuerpo: "Nadie que te pregunte cómo vas. Nadie que note dónde te trabaste.",
    rotacion: "rotate-[1deg] lg:rotate-[1.5deg]",
    mock: <MockChatSolo />,
  },
];

export function ActoUno() {
  return (
    <section id="te-suena" className="cv-auto bg-muted py-16 lg:py-20">
      <div className="container-page">
        <Reveal variant="fade-up" className="text-center">
          <span className="tape-note">la vieja forma</span>
          <h2 className="mt-4 font-display text-3xl text-balance lg:text-4xl">
            ¿Te suena?
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-muted-foreground">
            Si alguna vez intentaste aprender algo por tu cuenta, probablemente
            viviste esto.
          </p>
        </Reveal>

        {/* Sentinel desktop: dispara el tachado masivo cuando el grid cruza
            el 45% inferior del viewport — co-visible con la Bisagra. */}
        <Reveal
          as="div"
          variant="none"
          threshold={0}
          rootMargin="0px 0px -55% 0px"
          className="strike-on-reveal-desktop mt-10"
        >
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {fichas.map((f, i) => (
              <Reveal
                key={f.id}
                as="li"
                variant="fade-up"
                index={i}
                stagger={90}
                className="strike-on-reveal-mobile"
              >
                <article
                  className={`h-full rounded-lg bg-card p-4 shadow-soft ${f.rotacion}`}
                >
                  <h3 className="font-display text-base text-foreground/80">
                    <span
                      className="strike-draw"
                      style={{ "--strike-delay": `${i * 120}ms` } as CSSProperties}
                    >
                      {f.titulo}
                    </span>
                  </h3>
                  <div className="mt-2">{f.mock}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{f.cuerpo}</p>
                </article>
              </Reveal>
            ))}
          </ul>
        </Reveal>

        <Reveal variant="fade-up" className="mt-10 text-center">
          <p className="text-lg">Nada de esto es culpa tuya.</p>
          <p className="hand mt-1">es del formato ✺</p>
        </Reveal>
      </div>
    </section>
  );
}
