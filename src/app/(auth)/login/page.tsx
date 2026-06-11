import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <span className="tab-note">de vuelta a clases ✺</span>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
          Bienvenido de vuelta
        </h1>
        <p className="hand mt-1 inline-block rotate-[-1deg]">
          tu cuaderno te espera ✺
        </p>
      </div>
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
