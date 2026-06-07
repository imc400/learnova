import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            {site.tagline} Rutas de aprendizaje a medida con IA — para aprender
            lo que sea, a tu ritmo.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Producto</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="#como-funciona" className="hover:text-foreground">Cómo funciona</Link></li>
            <li><Link href="#caracteristicas" className="hover:text-foreground">Características</Link></li>
            <li><Link href="#precios" className="hover:text-foreground">Precios</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Cuenta</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/login" className="hover:text-foreground">Entrar</Link></li>
            <li><Link href="/signup" className="hover:text-foreground">Crear cuenta</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page flex h-14 items-center justify-between text-xs text-muted-foreground">
          <span>© {site.name}. Hecho en LatAm.</span>
          <div className="flex gap-4">
            <Link href="#" className="hover:text-foreground">Términos</Link>
            <Link href="#" className="hover:text-foreground">Privacidad</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
