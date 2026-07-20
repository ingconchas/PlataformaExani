"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Check } from "lucide-react";
/* eslint-disable @next/next/no-img-element -- URLs de Convex storage; next/image exige configurar dominios */
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { sanear } from "@/convex/sanitizar";
import { cn } from "@/lib/utils";
import { CLASE_RICO } from "@/components/reactivos/clase-rico";
import { MaterialReactivo } from "@/components/reactivos/material-reactivo";
import { TipoExamenChip } from "./tipo-examen-chip";

type Detalle = NonNullable<FunctionReturnType<typeof api.examenes.obtener>>;
type Item = Detalle["items"][number];
type Pregunta = Extract<Item, { faltante: false }>;

/**
 * Vista previa de SOLO LECTURA de un examen («Ver», LUI-20). Página y no modal:
 * un examen son decenas de reactivos con HTML rico e imágenes — dentro de un
 * modal de 640px sería un scroll infinito atrapado en un focus trap, y una
 * página es enlazable.
 *
 * Es de STAFF, así que SÍ marca la respuesta correcta (mismo criterio que el
 * preview del banco). El servidor ya entrega todo como HTML SEGURO
 * (`examenes.obtener`); cada sink re-sanea — idempotente = defensa en
 * profundidad. Ningún renglón saneado va a un ATRIBUTO (contrato de `sanear`).
 *
 * El pasaje de una lectura se pinta UNA VEZ por racha consecutiva de preguntas
 * de la misma lectura, no una por pregunta. Un id FANTASMA en `reactivoIds` se
 * muestra como tarjeta «ya no está disponible» DENTRO del `<ol>`: así el conteo
 * de la lista siempre cuadra con la columna «Reactivos» de la biblioteca.
 */
export function ExamenVistaPreviaClient({
  examenId,
  basePath,
}: {
  examenId: string;
  basePath: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const examen = useQuery(
    api.examenes.obtener,
    isAuthenticated ? { examenId } : "skip",
  );

  if (examen === undefined) {
    return (
      <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
        Cargando examen…
      </div>
    );
  }

  if (examen === null) {
    return (
      <>
        <Breadcrumb items={[{ label: "Exámenes", href: basePath }, { label: "Examen" }]} />
        <div className="mt-4 rounded-card border border-border bg-surface p-10 text-center shadow-card">
          <p className="text-h3 text-ink">Examen no encontrado</p>
          <p className="mt-1 text-small text-muted">
            El enlace puede estar vencido o el examen ya no existe.
          </p>
        </div>
      </>
    );
  }

  const lecturaPorId = new Map(examen.lecturas.map((l) => [l.id, l]));
  const horas = Math.floor(examen.duracionMin / 60);
  const minutos = examen.duracionMin % 60;

  return (
    <>
      <Breadcrumb
        items={[{ label: "Exámenes", href: basePath }, { label: examen.titulo }]}
      />
      <div className="mt-2">
        <PageHeader
          title={examen.titulo}
          description={`${examen.reactivosCount} reactivo${
            examen.reactivosCount === 1 ? "" : "s"
          } · ${horas} h ${String(minutos).padStart(2, "0")} min · por ${examen.autorNombre}`}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TipoExamenChip esModulo={examen.esModulo} etiqueta={examen.tipoEtiqueta} />
        <Badge tone={examen.estado === "publicado" ? "green" : "neutral"}>
          {examen.estado}
        </Badge>
      </div>

      <div className="mb-4">
        <Alert kind="info">
          Vista de solo lectura. Para cambiar los reactivos usa el constructor.
        </Alert>
      </div>

      {examen.reactivosFaltantes > 0 && (
        <div className="mb-4">
          <Alert kind="warning">
            {examen.reactivosFaltantes === 1
              ? "1 reactivo de este examen ya no existe en el banco."
              : `${examen.reactivosFaltantes} reactivos de este examen ya no existen en el banco.`}{" "}
            Se muestran como no disponibles en su posición.
          </Alert>
        </div>
      )}

      {examen.items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Este examen aún no tiene reactivos.
        </div>
      ) : (
        <ol aria-label="Preguntas del examen" className="grid gap-4">
          {examen.items.map((item, i) => {
            // Racha de bloque: el pasaje se pinta solo cuando la lectura de este
            // item difiere de la del ANTERIOR (un faltante corta la racha — si
            // el hueco parte un bloque, repetir el pasaje es lo honesto).
            const lecturaAnterior = i > 0 ? lecturaDe(examen.items[i - 1]) : null;
            const lecturaActual = lecturaDe(item);
            const abreBloque =
              lecturaActual !== null && lecturaActual !== lecturaAnterior;
            const lectura = abreBloque ? lecturaPorId.get(lecturaActual!) : null;
            return (
              <li key={item.faltante ? `faltante-${i}` : item.id} className="grid gap-3">
                {lectura && (
                  <div className="rounded-card border border-border bg-bg p-4">
                    <p className="mb-2 text-small font-semibold text-ink">
                      Lectura: {lectura.titulo}
                    </p>
                    <div
                      className={cn("text-small text-text", CLASE_RICO)}
                      dangerouslySetInnerHTML={{ __html: sanear(lectura.contenidoHtml) }}
                    />
                  </div>
                )}
                {item.faltante ? (
                  <div className="rounded-card border border-dashed border-border-strong bg-surface p-5 text-center text-muted">
                    Pregunta {i + 1} · Este reactivo ya no está disponible.
                  </div>
                ) : (
                  <PreguntaPreview item={item} numero={i + 1} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function lecturaDe(item: Item): Pregunta["lecturaId"] | null {
  return item.faltante ? null : item.lecturaId;
}

function PreguntaPreview({ item, numero }: { item: Pregunta; numero: number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-card">
      <div className="mb-2 flex items-start gap-3">
        <span className="font-condensed text-h3 font-semibold text-muted">
          {numero}.
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn("text-body font-medium text-ink", CLASE_RICO)}
            dangerouslySetInnerHTML={{ __html: sanear(item.enunciadoHtml) }}
          />
        </div>
        {!item.activo && <Badge tone="neutral">Inactivo</Badge>}
      </div>

      {item.imagenUrl && (
        <img
          src={item.imagenUrl}
          alt="Imagen del reactivo"
          className="mb-3 max-h-64 w-fit rounded-card border border-border"
        />
      )}

      {/* SIEMPRE entre el enunciado y las opciones (contrato de LUI-16). Se monta
          incondicionalmente — devuelve null sin material. Él sanea lo suyo. */}
      <MaterialReactivo material={item.material} />

      <ul className="mt-3 grid gap-2">
        {item.opciones.map((o) => {
          const correcta = o.id === item.opcionCorrecta;
          return (
            <li
              key={o.id}
              className={cn(
                "flex items-start gap-2.5 rounded-control border px-3 py-2 text-small",
                correcta ? "border-unx-green bg-unx-green-tint" : "border-border",
              )}
            >
              <span className="font-condensed font-semibold uppercase text-muted">
                {o.id})
              </span>
              <span className="flex-1">{o.texto}</span>
              {correcta && (
                <Check
                  className="mt-0.5 size-[18px] shrink-0 text-unx-green"
                  aria-label="Respuesta correcta"
                />
              )}
            </li>
          );
        })}
      </ul>

      {item.retroalimentacionHtml && (
        <div className="mt-3 rounded-card bg-bg px-3 py-2 text-small text-text">
          <span className="font-semibold">Retroalimentación: </span>
          <span
            className={CLASE_RICO}
            dangerouslySetInnerHTML={{ __html: sanear(item.retroalimentacionHtml) }}
          />
        </div>
      )}
    </div>
  );
}
