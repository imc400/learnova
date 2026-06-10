import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { FunnelWizard } from "./funnel-wizard";

export const metadata: Metadata = { title: "Arma tu ruta" };

export default function EmpiezaRutaPage() {
  return (
    <main className="min-h-dvh">
      <header className="container-page flex h-16 items-center justify-between">
        <Logo href="/empieza" />
        <Link href="/login?next=%2Fapp%2Fcrear" className="text-sm text-muted-foreground hover:text-foreground">
          Ya tengo cuenta
        </Link>
      </header>
      <div className="mx-auto max-w-xl px-5 pb-20">
        <div className="text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-6" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            Armemos <span className="ink-hl">tu</span> ruta
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA te hace las preguntas correctas y diseña tu camino.
          </p>
        </div>
        <FunnelWizard />
      </div>
    </main>
  );
}
