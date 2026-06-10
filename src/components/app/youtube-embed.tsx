"use client";

import { useState } from "react";
import { RefreshCw, ExternalLink, Languages, Youtube, Clapperboard } from "lucide-react";

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

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
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
                className="rounded-full border border-primary/30 bg-card px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                ▶ {mmss(m.timestampSeconds)} · {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mismatch && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-500">
          <Languages className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No encontramos un video en {langName(target)} para este punto; este
            está en {langName(audioLang)}. Para subtítulos en {langName(target)}:
            toca <b>CC</b> y luego <b>⚙ → Subtítulos → Traducir automáticamente</b>.
          </span>
        </p>
      )}

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
