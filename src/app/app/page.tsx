import Link from "next/link";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listUserPaths } from "@/server/queries/paths";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { pathStatus } from "@/db/schema";

export const metadata = { title: "Mis rutas" };

const STATUS: Record<
  (typeof pathStatus.enumValues)[number],
  { label: string; variant: "default" | "primary" | "accent" | "outline" }
> = {
  draft: { label: "Borrador", variant: "outline" },
  generating: { label: "Generando…", variant: "accent" },
  ready: { label: "Lista", variant: "primary" },
  failed: { label: "Falló", variant: "default" },
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const paths = user ? await listUserPaths(user.id) : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Mis rutas
          </h1>
          <p className="text-sm text-muted-foreground">
            Tus caminos de aprendizaje a medida.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/crear">
            <Plus className="size-4" /> Crear ruta
          </Link>
        </Button>
      </div>

      {paths.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
          <Sparkles className="size-8 text-primary" />
          <h2 className="mt-4 font-display text-lg font-semibold">
            Aún no tienes rutas
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Dinos qué quieres aprender y la IA te arma una ruta completa a tu medida.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app/crear">
              Crear mi primera ruta <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paths.map((p) => {
            const s = STATUS[p.status];
            return (
              <Link
                key={p.id}
                href={`/app/rutas/${p.id}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-5 shadow-soft transition-shadow hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold leading-tight">
                    {p.title}
                  </h3>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {p.goal}
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{p.level}</span>
                  {p.estimatedHours ? <span>· ~{Math.round(p.estimatedHours)} h</span> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
