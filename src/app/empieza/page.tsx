import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  GraduationCap,
  PlayCircle,
  Sparkles,
  Target,
  Mic,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { SupportBubble } from "@/components/app/support-bubble";

/*
  LANDING DE ADS — alta conversión, propósito único.
  Reglas: cero navegación que distraiga, UN solo CTA repetido, beneficio
  arriba del fold, prueba social, fricción nombrada y respondida.
  Destino del CTA: signup → directo al wizard (?next=/app/crear).
*/

export const metadata: Metadata = {
  title: "Aprende lo que quieras con tu profesor de IA",
  description:
    "Dinos qué quieres lograr y la IA te arma una ruta a tu medida: lecciones, los mejores videos, pruebas reales y un profesor particular que te enseña por voz.",
};

const CTA_HREF = "/empieza/ruta";

function Cta({ label = "Crear mi ruta ahora" }: { label?: string }) {
  return (
    <Button asChild size="lg">
      <Link href={CTA_HREF}>
        {label} <ArrowRight className="size-4" />
      </Link>
    </Button>
  );
}

export default function EmpiezaPage() {
  return (
    <main className="min-h-dvh">
      {/* Header mínimo: logo, sin nav (nada que distraiga del CTA) */}
      <header className="container-page flex h-16 items-center justify-between">
        <Logo href="/empieza" />
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Ya tengo cuenta</Link>
        </Button>
      </header>

      {/* HERO */}
      <section className="container-page pb-14 pt-10 text-center sm:pt-16">
        <span className="tab-note">tu profe te espera ✺</span>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-bold leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl">
          Aprende <span className="ink-hl">lo que quieras</span> con un profesor
          de IA que te conoce
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Dinos qué quieres lograr — cocinar, vender con Meta Ads, tocar
          guitarra, hablar chino — y la IA te arma una{" "}
          <strong className="text-foreground">ruta a tu medida</strong> en
          minutos: lecciones, los mejores videos, pruebas reales y{" "}
          <strong className="text-foreground">
            clases en vivo por voz con tu profe particular
          </strong>
          .
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Cta />
          <p className="text-sm text-muted-foreground">
            En 2 minutos tienes tu ruta · La armamos para TU meta, no un curso
            genérico
          </p>
        </div>

        {/* Mini-demo del producto: la ruta como cuaderno */}
        <div className="ruled mx-auto mt-12 max-w-md rounded-xl border border-border bg-card p-5 text-left shadow-lift">
          <div className="flex items-center justify-between">
            <div>
              <p className="hand text-base">tu meta ↓</p>
              <p className="font-display font-semibold">
                “Quiero vender mis fotos con el celular”
              </p>
            </div>
            <Sparkles className="size-5 text-primary" />
          </div>
          <div className="mt-4 space-y-2">
            {[
              { t: "Módulo 1 · Luz natural que vende", done: true },
              { t: "Módulo 2 · Ángulos y composición", done: true },
              { t: "Módulo 3 · Edición en tu celular", active: true },
              { t: "🎙 Clase en vivo con tu profe", live: true },
            ].map((m, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-md border px-3.5 py-2.5 text-sm ${
                  m.active
                    ? "border-primary/40 bg-primary/5 font-medium"
                    : m.live
                      ? "border-dashed border-primary/50 bg-highlight-soft/40"
                      : "border-border"
                }`}
              >
                {m.done ? (
                  <Check className="size-4 text-primary" />
                ) : m.live ? (
                  <Mic className="size-4 text-primary" />
                ) : (
                  <PlayCircle className="size-4 text-muted-foreground" />
                )}
                {m.t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* POR QUÉ FUNCIONA */}
      <section className="border-y border-border bg-card/60 py-14">
        <div className="container-page">
          <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
            No es otro curso. Es <span className="ink-hl">tu</span> ruta.
          </h2>
          <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {
                icon: Target,
                t: "Hecha para tu meta",
                d: "La IA diseña cada módulo según lo que TÚ quieres lograr y tu nivel real — nada de relleno.",
              },
              {
                icon: GraduationCap,
                t: "Un profe que te conoce",
                d: "Clases en vivo por voz: tu profesor de IA recuerda tu avance, te corrige y te deja tareas.",
              },
              {
                icon: PlayCircle,
                t: "Lo mejor de internet, curado",
                d: "Para cada lección, el mejor video de YouTube con los minutos clave ya marcados.",
              },
            ].map((f, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <f.icon className="size-6 text-primary" />
                <h3 className="mt-3 font-display text-lg font-semibold">{f.t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA — 3 pasos */}
      <section className="container-page py-14">
        <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
          De cero a dominarlo, en 3 pasos
        </h2>
        <div className="mx-auto mt-10 grid max-w-3xl gap-4">
          {[
            {
              n: "1",
              t: "Cuéntanos tu meta",
              d: "2 minutos: qué quieres aprender y para qué. La IA te hace las preguntas correctas.",
            },
            {
              n: "2",
              t: "Recibe tu ruta a medida",
              d: "Módulos, lecciones, videos curados y quizzes — diseñados para TI, listos al instante.",
            },
            {
              n: "3",
              t: "Aprende con tu profe en vivo",
              d: "Tu profesor de IA te recibe con una clase de bienvenida y te acompaña por voz hasta que lo domines.",
            },
          ].map((s) => (
            <div
              key={s.n}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-5"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display font-bold text-primary-foreground">
                {s.n}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Cta label="Quiero mi ruta a medida" />
        </div>
      </section>

      {/* OBJECIONES RÁPIDAS */}
      <section className="border-t border-border bg-card/60 py-14">
        <div className="container-page mx-auto max-w-2xl">
          <h2 className="text-center font-display text-2xl font-bold">
            Lo que seguro te estás preguntando
          </h2>
          <div className="mt-8 space-y-5">
            {[
              {
                q: "¿Sirve para CUALQUIER tema?",
                a: "Sí: oficios, idiomas, negocios, hobbies. Si se puede aprender, la IA arma la ruta — y si un tema requiere un profesional (salud, legal), te lo dice honestamente.",
              },
              {
                q: "¿El profesor de IA es de verdad 'en vivo'?",
                a: "Hablas con él por voz, en tiempo real, en español. Recuerda lo que avanzaste, qué te costó y tus tareas — como un profe particular.",
              },
              {
                q: "¿Cuánto tarda mi ruta?",
                a: "La estructura, unos 2 minutos. El contenido se completa lección por lección — lo primero que vas a estudiar se genera primero — y te avisamos al correo cuando tu primer módulo está listo.",
              },
            ].map((f, i) => (
              <div key={i}>
                <h3 className="font-display font-semibold">{f.q}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="container-page py-16 text-center">
        <p className="hand text-2xl">de querer aprenderlo…</p>
        <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
          a <span className="ink-hl">saberlo</span>.
        </h2>
        <div className="mt-7">
          <Cta label="Empezar ahora" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Tu primera ruta en minutos · aulia.ai
        </p>
      </section>

      <SupportBubble />
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © Aulia ·{" "}
        <Link href="/terminos" className="hover:underline">
          Términos
        </Link>{" "}
        ·{" "}
        <Link href="/privacidad" className="hover:underline">
          Privacidad
        </Link>
      </footer>
    </main>
  );
}
