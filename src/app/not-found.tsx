"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/marketing/reveal";

/*
  404 raíz — el ÚNICO lugar del interior con permiso de tape-note/strike-draw
  (retórica de "lo viejo": la URL que ya no existe se tacha con lápiz rojo).
  Cliente solo para leer la URL "vieja" con usePathname; sin estado ni efectos.
*/

export default function NotFound() {
  const pathname = usePathname();
  const vieja =
    pathname && pathname !== "/" ? pathname.slice(0, 48) : "esa página";

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center">
          <Logo href="/" />
        </div>

        <div className="dotgrid mt-8 rounded-xl border border-border bg-card px-6 py-12 shadow-soft">
          {/* variant="none": no oculta nada, solo dispara el tachado one-shot.
              Sin JS / reduced-motion la BASE ya viene tachada. */}
          <Reveal as="span" variant="none" className="strike-on-reveal inline-block max-w-full">
            <span className="tape-note max-w-full">
              <span
                className="strike-draw truncate"
                style={{ "--strike-delay": "350ms" } as CSSProperties}
              >
                {vieja}
              </span>
            </span>
          </Reveal>
          <p className="hand mt-4 inline-block rotate-[-2deg]">
            esta página no estaba en el temario ✺
          </p>
          <h1 className="mt-3 font-display text-3xl text-balance">
            No encontramos esta página
          </h1>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-muted-foreground">
            Puede que el enlace esté mal escrito o que ya no exista. Tu
            cuaderno sigue intacto.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app">Volver a mi cuaderno</Link>
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          ¿Crees que es un error? Escríbenos a{" "}
          <a
            href="mailto:hola@aulia.ai"
            className="font-medium text-primary hover:underline"
          >
            hola@aulia.ai
          </a>
          .
        </p>
      </div>
    </main>
  );
}
