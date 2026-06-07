import { defineConfig } from "@trigger.dev/sdk/v3";

/*
  Configuración de Trigger.dev (jobs de generación de larga duración).
  Reemplaza `project` con tu Project Ref desde https://cloud.trigger.dev
  (Settings → Project ref). En dev sin Trigger, la generación corre inline.
*/
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REEMPLAZAR",
  dirs: ["./src/trigger"],
  maxDuration: 900, // 15 min máx por ruta
});
