import { z } from "zod";

/*
  Validación de variables de entorno con Zod (patrón enterprise).
  - Se valida de forma temprana para fallar rápido si falta una key.
  - Para verificar SOLO que el código compila sin keys, usa:
        SKIP_ENV_VALIDATION=1 pnpm build
  - Las integraciones de fases posteriores (YouTube, Flow, Trigger) son
    opcionales hasta que se implementan, para no bloquear el arranque del core.
*/

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // --- Base de datos (Supabase Postgres) ---
  DATABASE_URL: z.string().url("DATABASE_URL debe ser una URL de Postgres válida"),

  // --- Supabase (servidor) ---
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // --- Anthropic (núcleo de IA) ---
  ANTHROPIC_API_KEY: z.string().min(1, "Falta ANTHROPIC_API_KEY"),

  // --- Embeddings (Voyage AI) — opcional hasta fase RAG ---
  VOYAGE_API_KEY: z.string().min(1).optional(),

  // --- YouTube Data API — opcional hasta fase de curación ---
  YOUTUBE_API_KEY: z.string().min(1).optional(),

  // --- Trigger.dev — opcional hasta fase de pipeline ---
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),

  // --- Flow.cl (pagos) — opcional hasta fase de monetización ---
  FLOW_API_KEY: z.string().min(1).optional(),
  FLOW_SECRET_KEY: z.string().min(1).optional(),
  FLOW_BASE_URL: z
    .string()
    .url()
    .default("https://sandbox.flow.cl/api"),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url()
    .default("http://localhost:3000"),
});

/** Variables expuestas al cliente (deben empezar con NEXT_PUBLIC_). */
const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

const skip = !!process.env.SKIP_ENV_VALIDATION;

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  if (skip) return data as z.infer<T>;
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(
      "❌ Variables de entorno inválidas:",
      JSON.stringify(result.error.flatten().fieldErrors, null, 2),
    );
    throw new Error("Configuración de entorno inválida. Revisa tu .env (ver .env.example).");
  }
  return result.data;
}

// En el cliente solo existen las NEXT_PUBLIC_*; el server schema solo se evalúa en el servidor.
export const env = {
  ...(typeof window === "undefined"
    ? parse(serverSchema, process.env)
    : ({} as z.infer<typeof serverSchema>)),
  ...parse(clientSchema, clientEnv),
};
