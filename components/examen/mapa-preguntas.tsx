"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RachaDeSeccion } from "@/convex/simulacro";

/**
 * Mapa de preguntas del simulacro (Diseño 25, celda 3). Se abre desde el CONTADOR del
 * `ExamHeader` —definido así en la auditoría del diseño 2026-07-12— y sirve para saltar a
 * cualquier pregunta.
 *
 * Sin «marcar para revisar» (fuera del MVP por decisión de producto): las celdas solo
 * distinguen actual / contestada / sin contestar, y el color nunca es el único canal (el
 * encabezado lleva el conteo en palabras y cada celda su `aria-label`).
 *
 * `soloSinContestar` es lo que abre «Revisar pendientes» desde la confirmación de envío.
 *
 * El diálogo, la trampa de foco y el Escape los aporta `ui/Modal`, que es quien envuelve a
 * este contenido: aquí solo vive la retícula.
 */
export function MapaPreguntas({
  total,
  contestadas,
  indiceActual,
  rachas,
  nombreDeSeccion,
  soloSinContestar = false,
  onIr,
}: {
  total: number;
  /** Índices 0-based YA contestados. */
  contestadas: ReadonlySet<number>;
  indiceActual: number;
  rachas: readonly RachaDeSeccion[];
  nombreDeSeccion: (seccionId: string | null) => string;
  soloSinContestar?: boolean;
  onIr: (indice: number) => void;
}) {
  const [elegida, setElegida] = useState(indiceActual);
  const pendientes = total - contestadas.size;

  return (
    <div className="flex flex-col gap-4" data-mapa>
      <p className="text-small text-muted" data-mapa-conteo>
        {contestadas.size} contestadas · {pendientes} por contestar
      </p>

      <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
        {rachas.map((r) => {
          const celdas = [];
          for (let i = r.desde - 1; i <= r.hasta - 1; i++) {
            if (soloSinContestar && contestadas.has(i)) continue;
            celdas.push(i);
          }
          if (celdas.length === 0) return null;
          return (
            <section key={`${r.seccionId ?? "sin"}-${r.desde}`}>
              <h3 className="mb-2 font-condensed text-caption uppercase tracking-[0.06em] text-muted">
                {nombreDeSeccion(r.seccionId)} · {r.desde}–{r.hasta}
              </h3>
              <div className="grid grid-cols-8 gap-1.5">
                {celdas.map((i) => {
                  const esActual = i === indiceActual;
                  const hecha = contestadas.has(i);
                  const estado = esActual
                    ? "actual"
                    : hecha
                      ? "contestada"
                      : "sin";
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setElegida(i)}
                      data-celda={i + 1}
                      data-celda-estado={estado}
                      aria-current={esActual ? "true" : undefined}
                      aria-label={`Pregunta ${i + 1}, ${
                        hecha ? "contestada" : "sin contestar"
                      }`}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-control font-condensed text-small font-semibold tabular-nums transition-colors duration-150",
                        i === elegida && "ring-2 ring-unx-blue ring-offset-1",
                        esActual
                          ? "bg-unx-blue text-white"
                          : hecha
                            ? "bg-unx-blue-tint text-unx-blue"
                            : "border border-border bg-surface text-text",
                      )}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <Button className="w-full" onClick={() => onIr(elegida)} data-mapa-ir>
        Ir a la pregunta
      </Button>
    </div>
  );
}
