import { schedules } from "@trigger.dev/sdk/v3";
import { refreshStaleVideos } from "@/lib/youtube/refresh";

/**
 * Cron diario: refresca metadatos de videos guardados antes del límite de 30
 * días de YouTube (cumplimiento de almacenamiento) y desactiva los caídos
 * (link-rot). En dev (sin Trigger) se puede invocar refreshStaleVideos() a mano.
 */
export const refreshVideosTask = schedules.task({
  id: "refresh-videos",
  cron: "0 4 * * *", // 04:00 UTC, diario
  maxDuration: 600,
  run: async () => {
    const result = await refreshStaleVideos(2000);
    console.log("[trigger] refresh-videos:", result);
    return result;
  },
});
