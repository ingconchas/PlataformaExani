"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  pctDeFraccion,
  type SeccionDeAcordeon,
  type SeccionDeResultado,
} from "@/convex/resultados";
import { cn } from "@/lib/utils";

/** Nombre visible de una sección/área que ya no resuelve contra el temario. La cubeta
 *  `seccionId === null` es «Sin clasificación vigente»; un doc borrado deja `nombre: null`.
 *  Nunca se pinta «undefined» ni se hereda una sección inventada. */
const nombreSeccion = (s: { seccionId: string | null; nombre: string | null }) =>
  s.seccionId === null ? "Sin clasificación vigente" : (s.nombre ?? "Sección eliminada");

/**
 * «Aciertos por sección» (Diseño 26): conteos CRUDOS con su barra. El par «22 de 30» y el
 * porcentaje dicen cosas distintas —el denominador es lo que hace comparables dos exámenes—
 * así que la fila muestra el par y la barra representa la fracción.
 */
export function AciertosPorSeccion({ secciones }: { secciones: SeccionDeResultado[] }) {
  if (secciones.length === 0) return null;
  return (
    <Card>
      <CardTitle>Aciertos por sección</CardTitle>
      <div className="mt-4 flex flex-col gap-3">
        {secciones.map((s) => (
          <div key={s.seccionId} data-seccion={nombreSeccion(s)}>
            <ProgressBar
              label={nombreSeccion(s)}
              trailing={`${s.aciertos} de ${s.total}`}
              value={s.aciertos}
              max={s.total}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * «Detalle por área temática» (Diseño 26): acordeón por sección con el badge naranja
 * «A estudiar» en las áreas bajo el umbral.
 *
 * El umbral NO se decide aquí: `reforzar` llega calculado por `construirAcordeon` con
 * `UMBRAL_REFUERZO_AREA` — la MISMA bandera que la pantalla del instructor pinta como
 * «reforzar en repaso». Que la alumna y su instructor no puedan discrepar sobre qué área
 * está floja es el punto entero de compartir la derivación; aquí solo cambia la etiqueta,
 * porque quien lee es otra persona.
 *
 * Por defecto abre la sección MÁS DÉBIL (mismo criterio que LUI-30): es el insumo directo
 * de «qué estudio primero», y obligar a buscarla a mano sería esconder la respuesta.
 */
export function AcordeonAreas({ acordeon }: { acordeon: SeccionDeAcordeon[] }) {
  const conPct = acordeon.filter((s) => s.pct !== null);
  const masDebil =
    conPct.length > 0
      ? conPct.reduce((min, s) => ((s.pct ?? 1) < (min.pct ?? 1) ? s : min))
      : null;
  // El estado guarda SOLO desviaciones del default (patrón del temario y de LUI-30): así el
  // default puede cambiar con los datos sin pelearse con lo que la alumna ya tocó.
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const clave = (id: string | null) => id ?? "sin-clasificacion";
  const abierta = (s: SeccionDeAcordeon) =>
    expansion[clave(s.seccionId)] ?? s.seccionId === masDebil?.seccionId;

  if (acordeon.length === 0) return null;

  return (
    <Card>
      <CardTitle>Detalle por área temática</CardTitle>
      <CardDescription className="mt-0.5">
        Para saber exactamente qué estudiar
      </CardDescription>
      <div className="mt-3 flex flex-col">
        {acordeon.map((s) => {
          const k = clave(s.seccionId);
          const open = abierta(s);
          const nombre = nombreSeccion(s);
          return (
            <div key={k} data-acordeon-seccion={nombre}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpansion((prev) => ({ ...prev, [k]: !open }))}
                className="flex w-full items-center justify-between gap-2 rounded-control py-2.5 text-left text-small font-semibold text-ink transition-colors hover:bg-bg"
              >
                <span className="flex items-center gap-1.5">
                  <ChevronDown
                    className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")}
                    aria-hidden
                  />
                  {nombre}
                </span>
                {s.pct !== null && (
                  <span className="text-small font-normal text-muted tabular-nums">
                    {pctDeFraccion(s.pct)}%
                  </span>
                )}
              </button>
              {open && (
                <div className="pb-2">
                  {s.areas.length === 0 ? (
                    <p className="py-1 text-small text-muted">
                      Esta sección no trae áreas con datos.
                    </p>
                  ) : (
                    s.areas.map((a) => (
                      <div
                        key={a.areaId}
                        data-area={a.nombre ?? "Área eliminada"}
                        className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-b-0"
                      >
                        <span className="flex flex-wrap items-center gap-2 text-small text-text">
                          {a.nombre ?? "Área eliminada"}
                          {a.reforzar && (
                            <Badge tone="orange" data-badge-estudiar>
                              A estudiar
                            </Badge>
                          )}
                        </span>
                        <span
                          className="shrink-0 text-small text-muted tabular-nums"
                          data-area-conteo
                        >
                          {a.aciertos} de {a.total}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
