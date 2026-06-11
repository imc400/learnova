import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  Estado vacío de marca (receta R2): nota Caveat emocional + invitación.
  La nota JAMÁS porta información única — si quitarla pierde datos, está mal.
*/

type Props = {
  /** Nota emocional Caveat, ej: "tu cuaderno está en blanco ✺". */
  nota: string;
  titulo: string;
  descripcion: string;
  cta?: { href: string; label: string };
  className?: string;
};

export function EmptyState({ nota, titulo, descripcion, cta, className }: Props) {
  return (
    <div
      className={cn(
        "dotgrid rounded-lg border border-border bg-card px-6 py-14 text-center shadow-soft",
        className,
      )}
    >
      <p className="hand inline-block rotate-[-2deg]">{nota}</p>
      <h2 className="mt-3 font-display text-2xl">{titulo}</h2>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-muted-foreground">{descripcion}</p>
      {cta ? (
        <Button asChild className="mt-6">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}
