import Link from "next/link";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

/**
 * Símbolo de Aulia: burbuja de voz (aula + conversación) con onda de voz
 * (el tutor en vivo). Colores fijos de marca, no tokens.
 */
export function AuliaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      role="img"
      aria-label="Aulia"
    >
      <path
        d="M34 84 C30 101 22 105 13 109 C31 107 45 99 51 86 Z"
        fill="#0E5340"
      />
      <rect x="12" y="10" width="96" height="84" rx="30" fill="#0E5340" />
      <rect x="40" y="41" width="9" height="22" rx="4.5" fill="#FAF6EE" />
      <rect x="52" y="30" width="9" height="44" rx="4.5" fill="#F2A65A" />
      <rect x="64" y="37" width="9" height="30" rx="4.5" fill="#FAF6EE" />
      <rect x="76" y="45" width="9" height="14" rx="4.5" fill="#FAF6EE" />
    </svg>
  );
}

export function Logo({
  className,
  href = "/",
  withText = true,
}: {
  className?: string;
  href?: string | null;
  withText?: boolean;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <AuliaMark className="size-8" />
      {withText && (
        <span className="font-display text-xl font-semibold tracking-tight text-foreground">
          {site.name}
        </span>
      )}
    </span>
  );

  if (href === null) return content;
  return (
    <Link href={href} className="inline-flex">
      {content}
    </Link>
  );
}
