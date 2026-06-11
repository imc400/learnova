import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Spark } from "@/components/marketing/landing/icons";
import { FunnelWizard } from "./funnel-wizard";

export const metadata: Metadata = { title: "Diseña tu ruta" };

export default async function EmpiezaRutaPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return (
    <main className="min-h-dvh">
      <header className="container-page flex h-16 items-center justify-between">
        <Logo href="/" />
        <Link
          href="/login?next=%2Fapp%2Fcrear"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Ya tengo cuenta
        </Link>
      </header>
      <div className="mx-auto max-w-xl px-5 pb-20">
        <div className="text-center">
          <span className="tab-note">
            <Spark size={16} /> diseñemos tu ruta ✺
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            Diseñemos <span className="ink-hl">tu</span> ruta
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La IA te hace las preguntas correctas y diseña tu camino.
          </p>
        </div>
        <FunnelWizard plan={plan === "pro" ? "pro" : undefined} />
      </div>
    </main>
  );
}
