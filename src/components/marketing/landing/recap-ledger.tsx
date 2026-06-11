import type { CSSProperties, ReactNode } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { formatPrice } from "@/lib/utils";

/**
 * §5.10 Recap — «En una página»: el concepto de la landing en miniatura.
 * Card «página de cuaderno» con las 6 filas antes/después. Cada fila es un
 * Reveal con .strike-on-reveal: al revelarse, el tachado rojo se dibuja y
 * 250 ms después se pinta el resaltador del lado nuevo (cableado en CSS
 * vía --reveal-delay; el tachado recibe el mismo delay vía --strike-delay).
 */

interface LedgerRow {
  label: string;
  old: string;
  next: ReactNode;
}

const ROWS: LedgerRow[] = [
  {
    label: "El temario",
    old: "el mismo para todos",
    next: (
      <>
        diseñado para <strong className="hl-draw">tu meta</strong>
      </>
    ),
  },
  {
    label: "El video",
    old: "el que aparezca primero",
    next: (
      <>
        el mejor, <strong className="hl-draw">verificado</strong> y marcado al minuto
      </>
    ),
  },
  {
    label: "El profesor",
    old: "no hay",
    next: (
      <>
        con <strong className="hl-draw">voz, nombre y memoria</strong> de tu avance
      </>
    ),
  },
  {
    label: "El avance",
    old: "videos reproducidos",
    next: (
      <>
        quizzes aprobados: <strong className="hl-draw">dominio real</strong>
      </>
    ),
  },
  {
    label: "Al terminar",
    old: "quedas a la deriva",
    next: (
      <>
        tu siguiente ruta se diseña <strong className="hl-draw">desde lo que dominaste</strong>
      </>
    ),
  },
  {
    label: "El pago",
    old: "suscripción que se cobra sola",
    next: (
      <>
        <strong className="hl-draw">{formatPrice(9990, "CLP")} una vez</strong> — y Pro sin
        cobro automático
      </>
    ),
  },
];

export function RecapLedger() {
  return (
    <section id="recap" className="cv-auto bg-muted py-16 lg:py-24">
      <div className="container-page">
        <div className="ruled mx-auto max-w-4xl rounded-xl bg-card p-6 shadow-lift lg:p-10">
          <Reveal variant="fade-up">
            <h2 className="text-balance text-3xl font-semibold tracking-tight lg:text-4xl">
              En una página: el antes y el después.
            </h2>
            <div className="mt-8 grid grid-cols-2 items-center gap-4 lg:gap-0">
              <div>
                <span className="tape-note">la vieja forma</span>
              </div>
              <div className="lg:pl-8">
                <span className="tab-note">la nueva forma</span>
              </div>
            </div>
          </Reveal>

          <div className="mt-6">
            {ROWS.map((row, i) => (
              <Reveal
                key={row.label}
                as="div"
                variant="fade-up"
                index={i}
                stagger={110}
                className="strike-on-reveal grid border-b border-border/60 py-3 last:border-b-0 lg:grid-cols-2 lg:py-4"
              >
                <div className="min-w-0 lg:pr-8">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span
                      className="strike-draw"
                      style={
                        i > 0
                          ? ({ "--strike-delay": `${i * 110}ms` } as CSSProperties)
                          : undefined
                      }
                    >
                      {row.old}
                    </span>
                  </p>
                </div>
                <div className="mt-1 min-w-0 lg:mt-0 lg:flex lg:items-end lg:border-l lg:border-border lg:pl-8">
                  <p className="text-base">{row.next}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
