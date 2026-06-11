"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { TutorChat, type TutorMsg } from "@/components/app/tutor-chat";

/*
  Tutor de la lección: UNA sola instancia de TutorChat (misma conversación y
  estado) que vive inline en desktop (≥ lg) y, en móvil, detrás de un FAB
  bottom-right que abre un bottom sheet. El video sigue visible arriba: el
  sheet ocupa 70dvh con backdrop suave, no es modal a pantalla completa.

  En esta ruta el SupportBubble global se oculta solo (support-bubble.tsx
  retorna null en /app/rutas/:pathId/leccion/:lessonId — la opción menos
  invasiva: cero cambios al layout del shell) para cederle la esquina al FAB.
*/

export function LessonTutor({
  context,
  lessonId,
  teacherName,
  suggestions,
  initialMessages,
}: {
  context: string;
  lessonId: string;
  teacherName: string | null;
  suggestions?: string[];
  initialMessages?: TutorMsg[];
}) {
  const [open, setOpen] = useState(false);

  // Sheet abierto (solo importa < lg): bloquea el scroll del body y Escape cierra.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Backdrop suave: tocar fuera cierra. Solo móvil. */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
        />
      )}

      {/* Contenedor único: inline en desktop, bottom sheet en móvil. */}
      <div
        className={
          open
            ? "fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-lift lg:static lg:z-auto lg:block lg:h-auto lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none"
            : "hidden lg:block"
        }
        role={open ? "dialog" : undefined}
        aria-label="Chat con tu profesor"
      >
        {/* Header del sheet (solo móvil abierto; en desktop manda el header
            interno del TutorChat). */}
        {open && (
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 lg:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <span className="truncate font-display text-sm font-semibold">
                {teacherName ?? "Tu tutor"}
              </span>
              <span className="tab-note shrink-0">pregunta no más ✺</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Cerrar chat"
              className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
        )}

        <div className={open ? "min-h-0 flex-1 lg:flex-none" : undefined}>
          <TutorChat
            context={context}
            lessonId={lessonId}
            teacherName={teacherName}
            suggestions={suggestions}
            initialMessages={initialMessages}
            className={
              open
                ? "h-full rounded-none border-0 pb-[env(safe-area-inset-bottom)] lg:h-[28rem] lg:rounded-lg lg:border lg:pb-0"
                : undefined
            }
            /* Con el sheet abierto, el header interno se duplica con el del
               sheet: se oculta < lg y reaparece en desktop. */
            headerClassName={open ? "hidden lg:flex" : undefined}
          />
        </div>
      </div>

      {/* FAB móvil: preguntar al profesor sin perder el video. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Preguntarle a tu profesor"
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lift transition-transform hover:scale-105 lg:hidden"
        >
          {teacherName ? (
            <span className="font-display text-xl font-bold">
              {teacherName.trim().charAt(0).toUpperCase()}
            </span>
          ) : (
            <MessageCircle className="size-6" />
          )}
        </button>
      )}
    </>
  );
}
