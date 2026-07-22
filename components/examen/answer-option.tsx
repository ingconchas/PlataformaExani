"use client";

import { type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Opción de respuesta del simulacro (Diseño 25): radio-card con la letra A–D en círculo.
 *
 * Porte del `AnswerOption` del design-reference con SOLO los dos estados que el player usa
 * —normal y seleccionada—: los estados `correct`/`incorrect` del mock pertenecen a la
 * REVISIÓN de respuestas (LUI-29) y aquí no deben existir ni como posibilidad. Durante el
 * examen la alumna no sabe si acertó: el servidor ni siquiera le manda `opcionCorrecta`.
 *
 * ⚠️ Accesibilidad: es un `div[role="radio"]` y no un `<input type="radio">` para heredar el
 * diseño de tarjeta sin pelear con el control nativo, pero con la semántica COMPLETA — el
 * grupo (`role="radiogroup"` + `aria-labelledby` al enunciado) lo pone el player, y aquí
 * viven `aria-checked`, el foco por «roving tabindex» (solo la seleccionada, o la primera,
 * es tabulable) y la activación con Espacio/Enter. Las flechas las gobierna el player, que
 * es quien conoce a las hermanas.
 */
export function AnswerOption({
  letra,
  seleccionada,
  onSelect,
  tabulable,
  children,
  onNavegar,
}: {
  letra: string;
  seleccionada: boolean;
  onSelect: () => void;
  /** Roving tabindex: solo UNA opción del grupo entra en el orden de tabulación. */
  tabulable: boolean;
  children: React.ReactNode;
  /** ↑/↓ dentro del grupo (lo resuelve el player: mueve foco Y selección). */
  onNavegar?: (delta: number) => void;
}) {
  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onSelect();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      onNavegar?.(1);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      onNavegar?.(-1);
    }
  };

  return (
    <div
      role="radio"
      aria-checked={seleccionada}
      tabIndex={tabulable ? 0 : -1}
      onClick={onSelect}
      onKeyDown={teclado}
      data-opcion={letra}
      data-seleccionada={seleccionada ? "si" : "no"}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-card p-[14px_16px] transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-unx-blue-tint",
        seleccionada
          ? "border-2 border-unx-blue bg-unx-blue-tint"
          : "border-[1.5px] border-border-strong bg-surface hover:border-unx-blue",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-[30px] shrink-0 items-center justify-center rounded-full font-condensed text-[15px] font-semibold",
          seleccionada ? "bg-unx-blue text-white" : "bg-bg text-text",
        )}
      >
        {letra}
      </span>
      <span className="flex-1 text-body text-text">{children}</span>
    </div>
  );
}
