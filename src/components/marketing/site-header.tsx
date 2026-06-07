import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <Link href="#como-funciona" className="hover:text-foreground">
            Cómo funciona
          </Link>
          <Link href="#caracteristicas" className="hover:text-foreground">
            Características
          </Link>
          <Link href="#precios" className="hover:text-foreground">
            Precios
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Crear mi ruta</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
