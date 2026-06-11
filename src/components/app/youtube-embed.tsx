"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, ExternalLink, Languages, Youtube, Clapperboard } from "lucide-react";
import { Play } from "@/components/marketing/landing/icons";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Video {
  youtubeVideoId: string;
  title: string | null;
  channelTitle: string | null;
  language?: string | null;
}

export interface VideoGuide {
  intro: string;
  moments: { timestampSeconds: number; label: string }[];
}

/** Evento global de seek: el quiz cita el minuto y el player salta a él. */
export const VIDEO_SEEK_EVENT = "aulia:video-seek";

/** Pide al player de la página saltar a un segundo del video principal. */
export function requestVideoSeek(seconds: number) {
  window.dispatchEvent(
    new CustomEvent<{ seconds: number }>(VIDEO_SEEK_EVENT, {
      detail: { seconds },
    }),
  );
}

const LANG_NAMES: Record<string, string> = {
  es: "español",
  en: "inglés",
  pt: "portugués",
  fr: "francés",
  de: "alemán",
  it: "italiano",
};
const langName = (code: string) =>
  LANG_NAMES[code.slice(0, 2).toLowerCase()] ?? code;

export const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Reproductor embebido oficial de YouTube (IFrame). Cumple ToS: no descarga
 * ni re-hostea ni bloquea ads. Ofrece alternativas guardadas (anti link-rot).
 *
 * Idioma: fuerza la preferencia de subtítulos al idioma del estudiante
 * (cc_lang_pref + hl). Si el AUDIO del video está en otro idioma (nicho sin
 * contenido en el idioma objetivo), activa subtítulos traducidos por defecto
 * (cc_load_policy) y muestra un aviso honesto.
 */
export function YouTubeEmbed({
  videos,
  userLanguage = "es",
  videoGuide = null,
}: {
  videos: Video[];
  userLanguage?: string;
  videoGuide?: VideoGuide | null;
}) {
  const [idx, setIdx] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const playerRef = useRef<HTMLDivElement>(null);

  // El quiz cita el minuto del video: al tocar el chip, el player salta ahí.
  // El grounding se hizo sobre el video PRINCIPAL → volvemos al índice 0.
  useEffect(() => {
    function onSeek(e: Event) {
      const seconds = (e as CustomEvent<{ seconds: number }>).detail?.seconds;
      if (typeof seconds !== "number") return;
      setIdx(0);
      setStartAt(seconds);
      playerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener(VIDEO_SEEK_EVENT, onSeek);
    return () => window.removeEventListener(VIDEO_SEEK_EVENT, onSeek);
  }, []);

  if (videos.length === 0) {
    return (
      <div className="grid aspect-video place-items-center rounded-md border border-dashed border-border bg-muted text-sm text-muted-foreground">
        No encontramos un video para este paso todavía.
      </div>
    );
  }

  const current = videos[idx]!;
  const target = userLanguage.slice(0, 2).toLowerCase();
  const audioLang = (current.language ?? "").slice(0, 2).toLowerCase();
  const mismatch = Boolean(audioLang) && audioLang !== target;
  // La guía de momentos aplica al video principal (el digest se hizo sobre él).
  const showGuide = idx === 0 && videoGuide && videoGuide.moments.length > 0;

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    cc_lang_pref: target, // preferir subtítulos en el idioma del estudiante
    hl: target, // interfaz del player en su idioma
  });
  if (mismatch) params.set("cc_load_policy", "1"); // forzar subtítulos ON
  if (startAt !== null) {
    // Deep-link al momento: parámetro oficial del IFrame (sin modificar el player).
    params.set("start", String(Math.max(0, Math.floor(startAt))));
    params.set("autoplay", "1");
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={playerRef}
        className="aspect-video overflow-hidden rounded-md border border-border bg-black"
      >
        <iframe
          key={`${current.youtubeVideoId}-${startAt ?? "0"}`}
          className="size-full"
          src={`https://www.youtube-nocookie.com/embed/${current.youtubeVideoId}?${params.toString()}`}
          title={current.title ?? "Video de la lección"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>

      {/* Guía del video: qué verás y saltos al minuto exacto (datos del digest). */}
      {showGuide && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-xs text-foreground">
            <Clapperboard className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{videoGuide.intro}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {videoGuide.moments.map((m) => (
              <button
                key={m.timestampSeconds}
                type="button"
                onClick={() => setStartAt(m.timestampSeconds)}
                title={`Saltar a ${mmss(m.timestampSeconds)}`}
                className={cn(
                  badgeVariants({ variant: "accent" }),
                  "min-h-11 cursor-pointer px-3.5 text-sm transition-colors hover:bg-accent/25",
                )}
              >
                <Play size={12} className="shrink-0" /> {mmss(m.timestampSeconds)} · {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mismatch && (
        <p className="flex items-start gap-1.5 rounded-md bg-highlight-soft px-2.5 py-1.5 text-xs text-accent-foreground">
          <Languages className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No encontramos un video en {langName(target)} para este punto; este
            está en {langName(audioLang)}. Para subtítulos en {langName(target)}:
            toca <b>CC</b> y luego <b>Ajustes, Subtítulos, Traducir
            automáticamente</b>.
          </span>
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{current.channelTitle}</span>
        <div className="flex items-center gap-3">
          {videos.length > 1 && (
            <button
              type="button"
              onClick={() => {
                // El startAt pertenece al video principal: no contamina al alternativo.
                setIdx((i) => (i + 1) % videos.length);
                setStartAt(null);
              }}
              className="inline-flex min-h-11 items-center gap-1 hover:text-foreground"
            >
              <RefreshCw className="size-3.5" /> Otra opción
            </button>
          )}
          <a
            href={`https://www.youtube.com/watch?v=${current.youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" /> Ver en YouTube
          </a>
        </div>
      </div>

      {/* Atribución a YouTube (Branding Guidelines): logo clicable hacia el video. */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <a
          href={`https://www.youtube.com/watch?v=${current.youtubeVideoId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver en YouTube"
          className="inline-flex shrink-0"
        >
          <Youtube className="size-4 text-[#FF0000]" aria-hidden />
        </a>
        <span>Video proporcionado por YouTube · curado por Aulia.</span>
      </p>
    </div>
  );
}
