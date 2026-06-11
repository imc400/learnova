"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Plus,
  Users,
  BarChart3,
  GraduationCap,
  CreditCard,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

/*
  Navegación del shell de la app.
  - Desktop: links con subrayado de resaltador (border-b en --highlight) en
    el activo, vía usePathname (única razón del "use client").
  - Mobile: <details> nativo (patrón de site-header.tsx) — funciona sin JS;
    el onClick que lo cierra tras navegar es solo mejora progresiva.
  Tap targets ≥44px en todo lo táctil (h-12 en menú, size-11 en el gatillo).
*/

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app", label: "Mis rutas", icon: LayoutGrid },
  { href: "/app/crear", label: "Crear ruta", icon: Plus },
  { href: "/app/profesores", label: "Profesores", icon: GraduationCap },
  { href: "/app/comunidad", label: "Comunidad", icon: Users },
  { href: "/app/planes", label: "Planes", icon: CreditCard },
];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/app"
      ? pathname === "/app"
      : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavDesktop({ admin }: { admin: boolean }) {
  const isActive = useIsActive();
  return (
    <nav className="hidden h-16 items-center gap-6 text-sm text-muted-foreground md:flex">
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={`flex h-full items-center gap-1.5 border-b-2 pt-0.5 transition-colors hover:text-foreground ${
            isActive(href)
              ? "border-[var(--highlight)] font-medium text-foreground"
              : "border-transparent"
          }`}
        >
          <Icon className="size-4" /> {label}
        </Link>
      ))}
      {admin && (
        <Link
          href="/app/admin"
          aria-current={isActive("/app/admin") ? "page" : undefined}
          className={`flex h-full items-center gap-1.5 border-b-2 pt-0.5 font-medium text-primary transition-colors hover:text-primary/80 ${
            isActive("/app/admin") ? "border-[var(--highlight)]" : "border-transparent"
          }`}
        >
          <BarChart3 className="size-4" /> Admin
        </Link>
      )}
    </nav>
  );
}

export function AppNavMobile({
  admin,
  perfilLabel,
}: {
  admin: boolean;
  perfilLabel: string;
}) {
  const isActive = useIsActive();
  // Mejora progresiva: cierra el <details> al navegar (sin JS, la navegación
  // completa lo resetea sola).
  const close = (e: MouseEvent) => {
    (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  };
  const items = [
    ...LINKS,
    { href: "/app/perfil", label: perfilLabel, icon: UserCircle },
    ...(admin
      ? [{ href: "/app/admin", label: "Admin", icon: BarChart3 }]
      : []),
  ];
  return (
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
      <div className="absolute right-0 top-12 z-50 w-64 rounded-b-lg border border-border bg-card p-2 shadow-lift">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            aria-current={isActive(href) ? "page" : undefined}
            className={`flex h-12 items-center gap-2.5 rounded-md px-3 text-sm hover:bg-muted ${
              isActive(href) ? "bg-muted font-medium" : ""
            }`}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}
