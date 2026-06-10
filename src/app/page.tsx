import Link from "next/link";
import {
  Sparkles,
  Target,
  Bot,
  ClipboardCheck,
  Youtube,
  TrendingUp,
  NotebookPen,
  ArrowRight,
  Check,
} from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { site } from "@/lib/site";
import { formatPrice } from "@/lib/utils";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <Stats />
        <HowItWorks />
        <Features />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--color-primary) 14%, transparent), transparent)",
        }}
      />
      <div className="container-page grid items-center gap-12 py-20 lg:grid-cols-2 lg:py-28">
        <div>
          <Badge variant="primary">
            <Sparkles className="size-3.5" /> Aprendizaje adaptativo con IA
          </Badge>
          <div className="relative">
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              De querer aprenderlo
              <br />a <span className="ink-hl">saberlo</span>.
            </h1>
            <span className="hand absolute -bottom-7 right-4 hidden rotate-[-4deg] sm:inline">
              lo subrayas tú ✺
            </span>
          </div>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            Dinos qué quieres lograr y la IA te arma una{" "}
            <strong className="text-foreground">ruta de aprendizaje a tu medida</strong>:
            módulos paso a paso, pruebas reales, un tutor en vivo y el mejor video
            de internet curado para cada paso.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Crear mi ruta gratis <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#como-funciona">Ver cómo funciona</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Gratis para empezar · Sin tarjeta · Tu primera ruta en minutos
          </p>
        </div>

        <RoutePreview />
      </div>
    </section>
  );
}

/** Mock visual de una ruta generada (puro markup, se ve como el producto). */
function RoutePreview() {
  return (
    <div className="relative">
      <div className="rounded-xl border border-border bg-card p-5 shadow-lift">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Ruta a medida</p>
            <p className="font-display font-semibold">Convertirme en chef en casa</p>
          </div>
          <Badge variant="accent">8 módulos</Badge>
        </div>
        <div className="mt-4 space-y-2.5">
          {[
            { t: "Fundamentos: cuchillo y mise en place", done: true },
            { t: "Sofrito y bases de sabor", done: true },
            { t: "Cocción: calor seco vs. húmedo", active: true },
            { t: "Salsas madre y derivadas", done: false },
            { t: "Emplatado y proyecto final", done: false },
          ].map((m, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 rounded-md border px-3.5 py-3 ${
                m.active
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-background"
              }`}
            >
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${
                  m.done
                    ? "bg-primary text-primary-foreground"
                    : m.active
                      ? "border-2 border-primary text-primary"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {m.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={`text-sm ${m.active ? "font-medium" : "text-muted-foreground"}`}
              >
                {m.t}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md bg-muted px-3.5 py-3 text-sm">
          <Bot className="size-4 text-primary" />
          <span className="text-muted-foreground">
            Tutor: <span className="text-foreground">"¿Te explico por qué el sofrito va a fuego bajo?"</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Stats() {
  const stats = [
    { v: "Cualquier tema", l: "de cocina a programación" },
    { v: "100% a medida", l: "según tu meta y nivel" },
    { v: "Tutor 24/7", l: "te acompaña en vivo" },
    { v: "Pruebas reales", l: "que confirman que aprendiste" },
  ];
  return (
    <section className="border-y border-border bg-card">
      <div className="container-page grid grid-cols-2 gap-6 py-10 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.v}>
            <p className="font-display text-xl font-semibold text-primary">{s.v}</p>
            <p className="text-sm text-muted-foreground">{s.l}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Target,
      t: "1. Dinos tu meta",
      d: "Respondes un cuestionario corto: qué quieres aprender, tu experiencia previa y cuánto tiempo tienes.",
    },
    {
      icon: Sparkles,
      t: "2. La IA arma tu ruta",
      d: "En minutos generamos una ruta modular completa, paso a paso, con lecciones, notas, videos y pruebas.",
    },
    {
      icon: TrendingUp,
      t: "3. Aprende y avanza",
      d: "Estudias con el tutor en vivo, demuestras tu dominio con pruebas reales y ves tu progreso crecer.",
    },
  ];
  return (
    <section id="como-funciona" className="py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          eyebrow="Cómo funciona"
          title="Tu ruta, lista en tres pasos"
          subtitle="No es un curso enlatado. Es un camino construido para ti, desde cero."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.t}
              className="rounded-lg border border-border bg-card p-6 shadow-soft"
            >
              <span className="grid size-11 place-items-center rounded-md bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: Target, t: "Rutas a medida desde cero", d: "Cada ruta se construye según tu objetivo, tu nivel y tu tiempo. No hay dos iguales." },
    { icon: Bot, t: "Tutor de IA en vivo", d: "Pregunta lo que sea, cuando sea. Tu tutor conoce tu ruta y te explica a tu manera." },
    { icon: ClipboardCheck, t: "Pruebas reales", d: "Cuestionarios y proyectos que confirman que de verdad aprendiste, no solo que leíste." },
    { icon: Youtube, t: "Video curado de internet", d: "Buscamos el mejor video gratuito para cada paso, en tu idioma y a tu nivel." },
    { icon: NotebookPen, t: "Notas y resúmenes", d: "Material de apoyo claro para repasar cuando quieras, sin perder tiempo buscando." },
    { icon: TrendingUp, t: "Progreso y rachas", d: "Visualiza tu avance, mantén tu racha y llega a tu meta con constancia." },
  ];
  return (
    <section id="caracteristicas" className="border-y border-border bg-card py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          eyebrow="Características"
          title="Todo lo que necesitas para aprender de verdad"
          subtitle="No solo contenido: ruta, coach y prueba de que lo lograste."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="rounded-lg border border-border bg-background p-6">
              <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent-foreground">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const { subscriptionMonthly, singlePath } = site.pricing;
  return (
    <section id="precios" className="py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          eyebrow="Precios"
          title="Empieza gratis. Mejora cuando quieras."
          subtitle="Sin contratos. Cancela cuando quieras."
        />
        <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-3">
          <PlanCard
            name="Gratis"
            price={formatPrice(0)}
            period=""
            description="Para probar cómo se siente tu ruta a medida."
            features={["1 ruta de aprendizaje", "Lecciones y videos curados", "Tutor de IA incluido"]}
            cta="Empezar gratis"
            href="/signup"
          />
          <PlanCard
            name="Pro"
            price={formatPrice(subscriptionMonthly)}
            period="/mes"
            description="Aprende sin límites, con todo desbloqueado."
            features={["Rutas ilimitadas", "Tutor en vivo ilimitado", "Quizzes en cada lección", "Progreso, niveles y rachas"]}
            cta="Empezar Pro"
            href="/signup"
            highlighted
          />
          <PlanCard
            name="Ruta única"
            price={formatPrice(singlePath)}
            period="única vez"
            description="¿Solo quieres una ruta? Llévatela sin suscripción."
            features={["1 ruta completa a medida", "Acceso permanente", "Videos y notas incluidos"]}
            cta="Comprar una ruta"
            href="/signup"
          />
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  name,
  price,
  period,
  description,
  features,
  cta,
  href,
  highlighted,
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border p-6 ${
        highlighted
          ? "border-primary bg-card shadow-lift"
          : "border-border bg-card shadow-soft"
      }`}
    >
      {highlighted && (
        <Badge variant="primary" className="absolute -top-3 left-6">
          Recomendado
        </Badge>
      )}
      <h3 className="font-display text-lg font-semibold">{name}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold">{price}</span>
        {period && <span className="text-sm text-muted-foreground">{period}</span>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2.5">
            <Check className="size-4 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-6" variant={highlighted ? "primary" : "outline"}>
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

function Faq() {
  const faqs = [
    { q: "¿Cómo crea la IA mi ruta?", a: "Analiza tu meta, tu nivel y tu tiempo, y diseña un currículum completo paso a paso, con lecciones, notas, pruebas y el mejor video gratuito para cada tema." },
    { q: "¿Sirve para cualquier tema?", a: "Sí. Desde aprender a cocinar o tocar guitarra hasta programación, marketing o finanzas. Si se puede aprender, Aulia te arma la ruta." },
    { q: "¿Los videos tienen costo?", a: "No. Curamos los mejores videos gratuitos de YouTube y los mostramos dentro de tu ruta, en tu idioma y a tu nivel." },
    { q: "¿En qué idiomas está?", a: "Empezamos en español; el contenido y el tutor funcionan en tu idioma." },
    { q: "¿Puedo cancelar cuando quiera?", a: "Claro. Sin contratos ni permanencia. Cancelas con un clic." },
  ];
  return (
    <section className="border-t border-border bg-card py-20 lg:py-28">
      <div className="container-page max-w-3xl">
        <SectionHeading eyebrow="Preguntas" title="Lo que la gente pregunta" />
        <div className="mt-10 divide-y divide-border">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="py-20 lg:py-28">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-xl bg-primary px-8 py-14 text-center text-primary-foreground shadow-lift">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Empieza a aprender lo que sea, hoy.
          </h2>
          <p className="mx-auto mt-3 max-w-xl opacity-90">
            Tu primera ruta a medida está a un clic. Gratis, sin tarjeta.
          </p>
          <Button asChild size="lg" variant="accent" className="mt-8">
            <Link href="/signup">
              Crear mi ruta gratis <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
