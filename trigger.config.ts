import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

/*
  Configuración de Trigger.dev (jobs de generación de larga duración).
  - `project` = Project Ref de https://cloud.trigger.dev.
  - `syncEnvVars` sube al worker (en cada deploy) las variables que el pipeline
    necesita en runtime. Los VALORES vienen del shell de deploy (no se hardcodean
    secretos aquí). Para producción, DATABASE_URL debe ser el Transaction Pooler.
*/
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_cqxyzimppgjnlkomxaes",
  dirs: ["./src/trigger"],
  maxDuration: 900, // 15 min máx por ruta
  build: {
    extensions: [
      syncEnvVars(() => {
        const keys = [
          "DATABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "ANTHROPIC_API_KEY",
          "YOUTUBE_API_KEY",
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "RESEND_API_KEY",
          "EMAIL_FROM",
          "NEXT_PUBLIC_SITE_URL",
          "GEMINI_API_KEY",
          // summarize-class lee la transcripción desde ElevenLabs: sin esta
          // var el worker muere y el alumno se queda sin resumen ni tareas.
          "ELEVENLABS_API_KEY",
          // Ops (Track E): el cron reconcile consulta a Flow/MP (webhook
          // perdido) y alertFounder manda WhatsApp — corren EN el worker.
          "PAYMENT_PROVIDER",
          "FLOW_API_KEY",
          "FLOW_SECRET_KEY",
          "FLOW_BASE_URL",
          "MP_ACCESS_TOKEN",
          "CALLMEBOT_PHONE",
          "CALLMEBOT_APIKEY",
          // Cuota YouTube (circuit breaker) + kill-switch de IA + gate de
          // correos de ciclo de vida (los crons de Track D corren aquí).
          "YOUTUBE_QUOTA_DAILY_LIMIT",
          "YOUTUBE_QUOTA_SOFT_LIMIT",
          "AI_DISABLED",
          "LIFECYCLE_EMAILS_ENABLED",
        ];
        return keys
          .filter((k) => process.env[k])
          .map((k) => ({ name: k, value: process.env[k] as string }));
      }),
    ],
  },
});
