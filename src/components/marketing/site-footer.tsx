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
        <div className="container-page py-4 text-xs leading-relaxed text-muted-foreground">
          Los videos se muestran mediante los Servicios de la API de YouTube. Al
          usar Learnova aceptas los{" "}
          <a
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Términos de Servicio de YouTube
          </a>{" "}
          y la{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Política de Privacidad de Google
          </a>
          .
        </div>
        <div className="container-page flex h-14 items-center justify-between border-t border-border/50 text-xs text-muted-foreground">
          <span>© {site.name}. Hecho en LatAm.</span>
          <div className="flex gap-4">
            <Link href="/terminos" className="hover:text-foreground">Términos</Link>
            <Link href="/privacidad" className="hover:text-foreground">Privacidad</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
