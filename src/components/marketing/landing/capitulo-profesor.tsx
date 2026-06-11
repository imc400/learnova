import { Reveal } from "@/components/marketing/reveal";
import { Badge } from "@/components/ui/badge";
import { Shield, Mic } from "@/components/marketing/landing/icons";

/*
  Capítulo 3 — Tu profesor (§5.7) — LA SECCIÓN ESTRELLA.
  Split 5/7 con el mock del aula GRANDE a la derecha. Zona de loop #2:
  aura del avatar + onda de voz (solo transform/opacity, base estática).
  El tachado del par antes/ahora se dibuja al revelarse la sección
  (strike-on-reveal en el Reveal contenedor); sin JS queda pintado.
*/

export function CapituloProfesor() {
  return (
    <section id="capitulo-3" className="cv-auto dotgrid bg-background py-24 lg:py-32">
      <Reveal as="div" variant="fade-up" className="container-page strike-on-reveal">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-14">
          {/* Copy */}
          <div className="min-w-0 lg:col-span-5">
            <span className="tab-note">capítulo 3 · tu profesor</span>

            {/* Par antes/ahora */}
            <div className="mt-7 flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2.5 sm:gap-y-1.5">
              <span className="tape-note">
                <s className="strike-draw no-underline">
                  aprender en silencio, sin nadie al otro lado
                </s>
              </span>
              <span className="self-center text-muted-foreground sm:self-auto" aria-hidden="true">
                <span className="sm:hidden">↓</span>
                <span className="hidden sm:inline">→</span>
              </span>
              <p className="font-semibold">un profesor con voz que se acuerda de ti.</p>
            </div>

            <h2 className="mt-5 font-display text-3xl text-balance sm:text-4xl lg:text-5xl">
              Te presentamos a tu profesor. Tiene nombre, voz y memoria.
            </h2>

            <div className="mt-5 space-y-4 text-muted-foreground">
              <p>
                Cada ruta viene con su propio profesor IA: nombre, especialidad y voz real. Te da
                la clase de bienvenida apenas partes y, cuando llevas avance de verdad, una clase
                en vivo de 25 a 30 minutos donde conversa contigo: revisa las tareas que te dejó,
                sabe qué preguntas fallaste en los quizzes y dónde te trabaste, y cierra dejándote
                tareas para la semana — que te llegan al correo.
              </p>
              <p>
                En plena clase puede decirte «mira tu pantalla» y mostrarte tu ruta mientras
                habla. Y si detecta un vacío en lo que sabes, te propone un módulo nuevo — si
                aceptas, tu ruta crece en vivo.
              </p>
            </div>

            {/* Caja de transparencia */}
            <div className="mt-7 flex items-start gap-3 rounded-md border border-border bg-card p-4">
              <Shield size={16} className="mt-0.5 shrink-0 text-primary" />
              <p className="text-sm text-muted-foreground">
                <strong className="font-semibold text-foreground">Transparencia total:</strong> es
                una inteligencia artificial y no lo oculta. La conversación se transcribe para
                generar tu resumen y tareas.
              </p>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              40 minutos de clases en vivo incluidos con tu ruta.
            </p>
          </div>

          {/* Mock del aula — hilo Camila */}
          <div className="min-w-0 lg:col-span-7">
            <div className="mock-margin rounded-xl bg-card p-6 shadow-lift sm:p-8">
              <div className="flex flex-col items-center gap-5 text-center">
                {/* Avatar 72px con doble aura (anillos hermanos adyacentes) */}
                <div className="relative mt-4">
                  <span className="aura-ring absolute inset-[-8px]" aria-hidden="true" />
                  <span className="aura-ring absolute inset-[-18px]" aria-hidden="true" />
                  <span className="relative flex size-18 items-center justify-center rounded-full bg-primary/10 font-display text-3xl text-primary">
                    A
                  </span>
                </div>

                {/* Nombre + estado */}
                <div className="flex flex-col items-center gap-2">
                  <p className="font-display text-lg">Profe Antonia · Fotografía</p>
                  <Badge variant="primary">en vivo</Badge>
                </div>

                {/* Onda de voz */}
                <div className="flex h-6 items-center gap-1.5" aria-hidden="true">
                  <span className="wave-bar h-6 w-1.5 bg-primary" />
                  <span className="wave-bar h-6 w-1.5 bg-primary" />
                  <span className="wave-bar h-6 w-1.5 bg-accent" />
                  <span className="wave-bar h-6 w-1.5 bg-primary" />
                </div>

                {/* Burbuja de transcripción */}
                <Reveal variant="scale-in" delay={350} className="w-full max-w-md">
                  <div className="rounded-lg rounded-tl-sm bg-muted px-4 py-3 text-left text-sm">
                    ¡Hola Camila! La clase pasada te dejé una tarea de encuadre — cuéntame,
                    ¿alcanzaste a hacerla?
                  </div>
                </Reveal>

                {/* Barra de controles (elementos del mock, no interactivos) */}
                <div className="flex w-full max-w-md items-center justify-between rounded-full border border-border bg-background px-4 py-2">
                  <span className="text-sm text-muted-foreground tabular-nums">24:12</span>
                  <div className="flex items-center gap-2">
                    <div className="flex size-9 items-center justify-center rounded-full border border-border">
                      <Mic size={16} />
                    </div>
                    <div className="flex h-8 w-10 items-center justify-center rounded-full bg-destructive">
                      <span className="h-1 w-3.5 rounded-full bg-destructive-foreground" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="hand mt-4 inline-block rotate-[-2deg]">
              abre la clase preguntando por TU tarea ✺
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
