import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/#capitulo-1", label: "Cómo funciona" },
  { href: "/#capitulo-3", label: "Tu profesor" },
  { href: "/#precios", label: "Precios" },
  { href: "/#faq", label: "Preguntas" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background md:bg-background/90 md:backdrop-blur-sm">
      <div className="container-page flex h-16 items-center justify-between gap-3">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="underline-offset-4 hover:text-primary hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
            <Link href="/login">Entrar</Link>
          </Button>
          {/* h-11 en mobile: tap target ≥44px para el CTA principal de ads */}
          <Button asChild size="sm" className="h-11 md:h-9">
            <Link href="/empieza/ruta">Diseñar mi ruta</Link>
          </Button>
          {/* Menú mobile: <details> nativo, cero JS */}
          <details className="group relative md:hidden">
            <summary
              aria-label="Abrir menú"
              className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md hover:bg-muted [&::-webkit-details-marker]:hidden"
            >
              {/* Hamburguesa 3 líneas → X vía group-open (solo transform/opacity) */}
              <span aria-hidden="true" className="relative block size-5">
                <span className="absolute left-0 top-[9px] h-0.5 w-5 -translate-y-[6px] rounded-full bg-foreground transition-transform duration-200 group-open:translate-y-0 group-open:rotate-45" />
                <span className="absolute left-0 top-[9px] h-0.5 w-5 rounded-full bg-foreground transition-opacity duration-200 group-open:opacity-0" />
                <span className="absolute left-0 top-[9px] h-0.5 w-5 translate-y-[6px] rounded-full bg-foreground transition-transform duration-200 group-open:translate-y-0 group-open:-rotate-45" />
              </span>
            </summary>
            <div className="absolute right-0 top-12 w-64 rounded-b-lg border border-border bg-card p-2 shadow-lift">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex h-12 items-center rounded-md px-3 text-sm hover:bg-muted"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/login"
                className="flex h-12 items-center rounded-md px-3 text-sm hover:bg-muted"
              >
                Entrar
              </Link>
              <div className="p-2">
                <Button asChild className="w-full">
                  <Link href="/empieza/ruta">Diseñar mi ruta</Link>
                </Button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
