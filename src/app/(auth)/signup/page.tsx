import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Crea tu cuenta
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea tu cuenta y diseña tu ruta. Ves la estructura de tu temario
          completo antes de pagar.
        </p>
      </div>
      <Suspense fallback={null}>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}
