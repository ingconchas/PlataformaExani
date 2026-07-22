"use client";

import { ChevronDown, LayoutGrid } from "lucide-react";
import { ExamTimer } from "@/components/examen/exam-timer";

/**
 * Encabezado del modo examen (móvil): sección + contador + temporizador.
 * Sin navegación ni forma de salir accidentalmente (regla del sistema).
 *
 * El CONTADOR es el disparador del mapa de preguntas (definido así en la auditoría de
 * diseño del 2026-07-12), con affordance visible —icono de retícula y chevron— porque un
 * texto que abre un diálogo sin señal no es descubrible. Cuando no se pasa `onAbrirMapa`
 * (pantallas sin mapa) sigue siendo texto plano, no un botón muerto.
 *
 * `alerta` pinta el cronómetro en naranja en los últimos 5 minutos; el anuncio para
 * lectores de pantalla lo hace el banner del player, no el chip (ver `ExamTimer`).
 */
export function ExamHeader({
  seccion,
  actual,
  total,
  tiempo,
  alerta = false,
  onAbrirMapa,
}: {
  seccion: string;
  actual: number;
  total: number;
  tiempo: string;
  alerta?: boolean;
  onAbrirMapa?: () => void;
}) {
  const contador = (
    <>
      <span className="font-condensed font-semibold">{actual}</span> de{" "}
      <span className="font-condensed">{total}</span>
    </>
  );
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
      <div className="min-w-0">
        <p className="truncate font-condensed text-caption uppercase tracking-[0.06em] text-muted">
          {seccion}
        </p>
        {onAbrirMapa ? (
          <button
            type="button"
            onClick={onAbrirMapa}
            aria-haspopup="dialog"
            aria-label={`Pregunta ${actual} de ${total}. Abrir mapa de preguntas`}
            data-abrir-mapa
            className="inline-flex items-center gap-1.5 rounded-control text-small text-ink underline decoration-dotted underline-offset-4 hover:text-unx-blue"
          >
            <LayoutGrid className="size-4" aria-hidden />
            {contador}
            <ChevronDown className="size-4" aria-hidden />
          </button>
        ) : (
          <p className="text-small text-ink">{contador}</p>
        )}
      </div>
      <ExamTimer tiempo={tiempo} alerta={alerta} />
    </header>
  );
}
