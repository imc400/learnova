import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-soft">
        {children}
      </div>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        Al continuar aceptas nuestros{" "}
        <Link href="/terminos" className="underline hover:text-foreground">
          Términos
        </Link>{" "}
        y la{" "}
        <Link href="/privacidad" className="underline hover:text-foreground">
          Política de Privacidad
        </Link>
        .
      </p>
    </main>
  );
}
