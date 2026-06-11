import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { site } from "@/lib/site";

const producto = [
  { href: "/#capitulo-1", label: "Cómo funciona" },
  { href: "/#capitulo-3", label: "Tu profesor" },
  { href: "/#precios", label: "Precios" },
  { href: "/#faq", label: "Preguntas" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page grid gap-10 py-12 md:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            {site.tagline}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Hecho en Chile.</p>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Producto</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {producto.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="inline-flex min-h-10 items-center hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Confianza</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a
                href="mailto:hola@aulia.ai"
                className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline"
              >
                hola@aulia.ai
              </a>
            </li>
            <li>Garantía de 7 días</li>
            <li>
              <a
                href={site.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center hover:text-foreground"
              >
                Instagram
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Legal</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link href="/terminos" className="inline-flex min-h-10 items-center hover:text-foreground">
                Términos
              </Link>
            </li>
            <li>
              <Link href="/privacidad" className="inline-flex min-h-10 items-center hover:text-foreground">
                Privacidad
              </Link>
            </li>
            <li>
              <Link href="/login" className="inline-flex min-h-10 items-center hover:text-foreground">
                Entrar
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page py-4 text-xs leading-relaxed text-muted-foreground">
          Los videos se muestran mediante los Servicios de la API de YouTube. Al
          usar Aulia aceptas los{" "}
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
        <div className="container-page flex h-14 items-center border-t border-border/50 text-xs text-muted-foreground">
          <span>© {site.name}.</span>
        </div>
      </div>
    </footer>
  );
}
