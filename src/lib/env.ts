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

  // --- Email (Resend) — opcional hasta fase de correos por avance ---
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default("Aulia <hola@mail.aulia.ai>"),

  // --- Google Gemini — digest de videos de YouTube (coherencia ToS-safe) ---
  GEMINI_API_KEY: z.string().min(1).optional(),

  // --- ElevenLabs — clases en vivo con profesor IA ---
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  // Kill-switch de costos: "false" apaga la feature sin deploy.
  LIVE_CLASSES_ENABLED: z.string().default("true"),

  // --- Flow.cl (pagos) — opcional hasta fase de monetización ---
  FLOW_API_KEY: z.string().min(1).optional(),
  FLOW_SECRET_KEY: z.string().min(1).optional(),
  FLOW_BASE_URL: z
    .string()
    .url()
    .default("https://sandbox.flow.cl/api"),

  // --- Mercado Pago (Checkout Pro) ---
  MP_ACCESS_TOKEN: z.string().min(1).optional(),

  // Proveedor ACTIVO para pagos one-time (cambio sin deploy de código).
  PAYMENT_PROVIDER: z.enum(["flow", "mercadopago"]).default("mercadopago"),
  // Flow VERIFICA que el buzón del pagador exista (error 1620) — un typo en
  // el correo NO puede bloquear una venta: la boleta de Flow se reintenta
  // con este respaldo y nuestros correos manejan la comunicación real.
  FLOW_RECEIPT_FALLBACK_EMAIL: z.string().default(""),

  // --- Embudo de negocio ---
  // "true" = el wizard exige pago ANTES de generar la ruta (requiere Flow
  // configurado). Apagado: flujo gratuito con límite free de siempre.
  PAYWALL_ENABLED: z.string().default("false"),
  // Precio por ruta en CLP (override sin deploy).
  PRICE_ROUTE_CLP: z.coerce.number().int().positive().default(9990),
  // Suscripción Pro (estudio de costos 2026-06: peor caso 50% de margen).
  PRICE_PRO_CLP: z.coerce.number().int().positive().default(24990),
  PRO_ROUTES_PER_MONTH: z.coerce.number().int().positive().default(2),
  FLOW_PLAN_ID: z.string().default("aulia_pro"),
  // Modo de cobro de Pro. "true" (requiere PAT activo en Flow): suscripción
  // real con cobro automático mensual. "false": PRO MANUAL — cobro único de
  // PRICE_PRO_CLP = 30 días, sin renovación automática (se avisa al cliente).
  PRO_SUBSCRIPTION_ENABLED: z.string().default("false"),
  // Clases en vivo: minutos incluidos POR RUTA (inducción + 40% + cierre)
  // y pool mensual EXTRA de los Pro (pestaña Profesores).
  CLASS_MINUTES_PER_ROUTE: z.coerce.number().int().positive().default(40),
  PRO_MONTHLY_CLASS_MINUTES: z.coerce.number().int().positive().default(120),
  // Clase suelta (upsell del plan por-ruta) — precio fijado por costos.
  PRICE_CLASS_CLP: z.coerce.number().int().positive().default(6990),
  // Acceso al dashboard admin además de profiles.is_admin (coma-separado).
  ADMIN_EMAILS: z.string().default(""),

  // --- Correos de ciclo de vida (renovación Pro D-3/D0 + carros T+1h/T+24h) ---
  // Los crons SIEMPRE corren, pero con "false" NO encolan nada (log claro en
  // su lugar): el fundador aprueba los copys y enciende sin deploy.
  LIFECYCLE_EMAILS_ENABLED: z.string().default("false"),

  // --- Ops y observabilidad (Track E) ---
  // Kill-switch global de generación IA: "true" apaga las llamadas a Anthropic
  // sin deploy (p.ej. costo diario fuera de umbral según ai_usage). La
  // reconciliación y los correos deterministas NO dependen de esto.
  AI_DISABLED: z.string().default("false"),
  // Secret del doble disparador de reconciliación (vercel.json → cron HTTP a
  // /api/admin/reconcile): si Trigger.dev está caído, su cron también — este
  // camino alterno necesita autenticarse. Vacío = endpoint deshabilitado.
  CRON_SECRET: z.string().default(""),
  // WhatsApp del fundador vía CallMeBot (solo incidentes 'critical' de
  // alertFounder). Vacíos = solo correo + ops_incidents (degradación suave).
  CALLMEBOT_PHONE: z.string().default(""),
  CALLMEBOT_APIKEY: z.string().default(""),
  // Cuota diaria de YouTube Data API (10K por defecto en Google) y umbral del
  // circuit-breaker: sobre el umbral NO se busca — la lección se encola en
  // video_backfill_queue y NO se cachea canon degradado. Alerta al 80%.
  YOUTUBE_QUOTA_DAILY_LIMIT: z.coerce.number().int().positive().default(10000),
  YOUTUBE_QUOTA_SOFT_LIMIT: z.coerce.number().int().positive().default(8500),

  // --- Profesor IA (Track C) ---
  // HMAC del workspace para el conversation-initiation webhook de ElevenLabs
  // (/api/live/initiation): el system prompt deja de viajar al navegador.
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1).optional(),
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

// No validar durante `next build`: el build NO necesita los secretos de runtime
// (las páginas con datos son dinámicas). Evita que el deploy se caiga por env y
// es la práctica recomendada. En runtime SÍ se valida (fail-fast si falta algo).
const skip =
  !!process.env.SKIP_ENV_VALIDATION ||
  process.env.NEXT_PHASE === "phase-production-build";

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
