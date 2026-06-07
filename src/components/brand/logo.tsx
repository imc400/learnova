import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

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
      <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-soft">
        <GraduationCap className="size-5" />
      </span>
      {withText && (
        <span className="font-display text-lg font-semibold tracking-tight">
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
