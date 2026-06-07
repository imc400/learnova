"use client";

import { useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";

interface Video {
  youtubeVideoId: string;
  title: string | null;
  channelTitle: string | null;
}

/**
 * Reproductor embebido oficial de YouTube (IFrame). Cumple ToS: no descarga
 * ni re-hostea ni bloquea ads. Ofrece alternativas guardadas (anti link-rot).
 *
 * NOTA: para detección automática de "embedding deshabilitado" (códigos 101/150)
 * conviene cargar el IFrame Player API y escuchar onError; aquí ofrecemos el
 * cambio manual de respaldo, suficiente para v1.
 */
export function YouTubeEmbed({ videos }: { videos: Video[] }) {
  const [idx, setIdx] = useState(0);

  if (videos.length === 0) {
    return (
      <div className="grid aspect-video place-items-center rounded-md border border-dashed border-border bg-muted text-sm text-muted-foreground">
        No encontramos un video para este paso todavía.
      </div>
    );
  }

  const current = videos[idx]!;

  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
        <iframe
          key={current.youtubeVideoId}
          className="size-full"
          src={`https://www.youtube-nocookie.com/embed/${current.youtubeVideoId}?rel=0&modestbranding=1`}
          title={current.title ?? "Video de la lección"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{current.channelTitle}</span>
        <div className="flex items-center gap-3">
          {videos.length > 1 && (
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % videos.length)}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <RefreshCw className="size-3.5" /> Otra opción
            </button>
          )}
          <a
            href={`https://www.youtube.com/watch?v=${current.youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" /> Ver en YouTube
          </a>
        </div>
      </div>
    </div>
  );
}
