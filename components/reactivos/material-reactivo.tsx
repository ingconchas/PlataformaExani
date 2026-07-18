"use client";

import { type MaterialDeReactivo } from "@/convex/material";
import { sanear } from "@/convex/sanitizar";
import { cn } from "@/lib/utils";
import { CLASE_RICO } from "./clase-rico";

/**
 * El RECUADRO DE MATERIAL de un reactivo (LUI-16): las dos listas de una «relación de
 * columnas» o los elementos de una pregunta de «ordenamiento». Va SIEMPRE **entre el
 * enunciado y las opciones** — es la regla de render del issue, y coincide con el patrón que
 * el Diseño 25 ya usa para la imagen.
 *
 * ⚠️ CONTRATO DE SANEO: **este componente sanea; el llamador NO tiene que hacerlo.** No es
 * redundancia:
 *  1. la vista previa VIVA del formulario le pasa HTML **crudo de TipTap**, que nunca pasó
 *     por el servidor — sin saneo aquí sería un sink desprotegido;
 *  2. sobre lo que ya saneó `reactivos.obtener`, re-sanear es idempotente
 *     (`convex/sanitizar.ts`) = defensa en profundidad gratis, el mismo criterio del modal;
 *  3. al ser el ÚNICO sink de `dangerouslySetInnerHTML` para material en todo el repo, el
 *     runner del examen y la revisión de respuestas (LUI-19/25/29) **no pueden olvidarlo**.
 *
 * ⚠️ Ningún renglón va a un ATRIBUTO (`aria-label`, `title`, `alt`): el contrato de `sanear`
 * lo prohíbe — su salida solo es segura como CONTENIDO de elemento.
 *
 * Props PURAS y desacopladas de la API (el tipo sale de `convex/material`, no del retorno de
 * `obtener`) para que LUI-19/25/29 solo tengan que importarlo.
 */
export function MaterialReactivo({
  material,
  className,
}: {
  material: MaterialDeReactivo | null | undefined;
  className?: string;
}) {
  if (!material) return null;

  return (
    <div
      role="group"
      aria-label="Material del reactivo"
      // `@container`: el recuadro vive en anchos MUY distintos — la tarjeta de vista previa
      // del formulario (~350 px), el modal del banco (640 px) y el player móvil (390 px). Un
      // breakpoint de VIEWPORT (`sm:`) pondría dos columnas de ~165 px dentro de la tarjeta
      // en un monitor grande. La consulta correcta es la del CONTENEDOR.
      className={cn(
        "@container rounded-control border border-border bg-bg p-3 text-small",
        className,
      )}
    >
      {material.tipo === "columnas" ? (
        <div className="grid gap-3 @md:grid-cols-2">
          <Lista titulo="Columna 1" renglones={material.columna1} etiqueta={numero} />
          <Lista titulo="Columna 2" renglones={material.columna2} etiqueta={letra} />
        </div>
      ) : (
        <Lista
          titulo="Elementos a ordenar"
          renglones={material.elementos}
          etiqueta={numero}
        />
      )}
    </div>
  );
}

const numero = (i: number) => `${i + 1}.`;
const letra = (i: number) => `${String.fromCharCode(97 + i)}.`;

function Lista({
  titulo,
  renglones,
  etiqueta,
}: {
  titulo: string;
  renglones: string[];
  etiqueta: (i: number) => string;
}) {
  return (
    // El nombre accesible del grupo («Columna 2») es lo que desambigua sus etiquetas a./b./c.
    // de las opciones de respuesta, que usan las MISMAS letras con otro significado.
    <div role="group" aria-label={titulo}>
      <p className="mb-1 font-semibold text-ink">{titulo}</p>
      {/* `list-none`: la etiqueta se pinta como TEXTO, no como `::marker`, porque las
          opciones de respuesta la referencian («1b, 2c, 3a») y tiene que ser contenido
          visible y seleccionable. */}
      <ol className="grid list-none gap-1">
        {renglones.map((html, i) => (
          <li key={i} className="flex gap-1.5 text-text">
            <span className="shrink-0 font-condensed font-semibold text-muted">
              {etiqueta(i)}
            </span>
            {/* `div`, NO `span`: `sanear` permite `<p>` en su whitelist y TipTap envuelve
                en párrafos, así que el contenido puede ser de BLOQUE. Un `span` no lo
                admite → el navegador reestructuraría el DOM en la hidratación y el
                contenido se saldría del contenedor que lleva `flex-1`. Mismo criterio que
                los otros sinks (la vista previa del formulario y el modal ya usan `div`). */}
            <div
              className={cn("min-w-0 flex-1", CLASE_RICO)}
              dangerouslySetInnerHTML={{ __html: sanear(html) }}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
