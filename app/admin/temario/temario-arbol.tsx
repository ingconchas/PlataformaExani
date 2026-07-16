"use client";

import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type FilaTemario } from "./tipos";

/**
 * El árbol del temario: Sección → Área temática → Subtema.
 *
 * **No usa `DataTable` a propósito.** Ese primitivo es columnas + orden por
 * columna + paginación, y aquí no hay ninguna de las tres: las filas son
 * heterogéneas (fondo, peso y tamaño cambian por nivel), el orden es manual, y
 * **paginar sería activamente incorrecto: partiría un padre de sus hijos**. El
 * propio mock lo dibuja con filas a medida, no con una tabla.
 *
 * Y vive aquí, local, en vez de en `components/ui/`: esa carpeta es el espejo del
 * design system, y el DS **no define un `Tree`**. Cuando aparezca un segundo
 * árbol se promueve.
 */

/** Indentación del mock: `16 + depth * 28`. `depth` es `nivel - 1` siempre, así
 *  que no viaja por la red: se deriva. */
const sangria = (nivel: 1 | 2 | 3) => 16 + (nivel - 1) * 28;

function Fila({
  fila,
  expandido,
  onAlternar,
}: {
  fila: FilaTemario;
  expandido: boolean;
  onAlternar: () => void;
}) {
  return (
    <li
      // `aria-level` en el `<li>`: el lector anuncia la profundidad sin que
      // tengamos que fingir un `role="tree"` cuyo contrato de teclado no vamos a
      // cumplir (ver el comentario de `temario-client.tsx`).
      aria-level={fila.nivel}
      style={{ paddingLeft: sangria(fila.nivel) }}
      className={cn(
        "flex items-center gap-2.5 border-b border-border py-2.5 pr-4",
        fila.nivel === 1 ? "bg-bg" : "bg-surface",
        // Atenuado si él o un ancestro está retirado. No se OCULTA: ocultarlo lo
        // volvería inalcanzable para renombrar, reordenar o reactivar (Entrega 2)
        // y rompería el árbol como mapa del catálogo.
        !fila.disponible && "opacity-55",
      )}
    >
      {fila.tieneHijos ? (
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={expandido}
          // Sin `aria-controls`: con render plano los hijos no son un contenedor
          // único, e inventar un id que no envuelve nada sería mentir.
          aria-label={`${expandido ? "Contraer" : "Expandir"} ${fila.nombre}`}
          className="grid size-[30px] shrink-0 place-items-center rounded-md text-muted hover:bg-disabled-bg"
        >
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", !expandido && "-rotate-90")}
          />
        </button>
      ) : (
        // El mock pone chevron en todo `nivel < 3`, pero un módulo plano con
        // chevron es una promesa vacía. Se respeta la INTENCIÓN (chevron = hay algo
        // que abrir); el mock nunca tuvo una sección sin hijos.
        <span className="size-[30px] shrink-0" />
      )}

      <span
        className={cn(
          "flex-1 truncate",
          fila.nivel === 1 && "text-base font-semibold text-ink",
          fila.nivel === 2 && "text-[15px] font-semibold",
          fila.nivel === 3 && "text-sm",
        )}
      >
        {fila.nombre}
      </span>

      {/* El badge es SOLO de `activo` (este nodo retirado), no de `disponible`.
          Un descendiente de un área retirada sale atenuado pero SIN badge: no
          está inactivo él, lo está su padre — y el badge del ancestro, una fila
          más arriba, ya lo explica. */}
      {!fila.activo && <Badge tone="neutral">Inactivo</Badge>}

      <span className="shrink-0 font-condensed text-[13px] font-semibold tabular-nums text-muted">
        {fila.reactivos} {fila.reactivos === 1 ? "reactivo" : "reactivos"}
      </span>
    </li>
  );
}

export function TemarioArbol({
  filas,
  estaExpandido,
  onAlternar,
}: {
  filas: FilaTemario[];
  estaExpandido: (fila: FilaTemario) => boolean;
  onAlternar: (id: string) => void;
}) {
  // El servidor ya entrega núcleo primero y módulos después, contiguos, así que
  // el corte es un `findIndex`. La banda «MÓDULOS» del mock se convierte en el
  // ENCABEZADO de la segunda lista, no en una fila-separador falsa: así el conteo
  // que anuncia cada `<ul>` significa algo.
  const corte = filas.findIndex((f) => f.nivel === 1 && f.tipo === "modulo");
  const nucleo = corte === -1 ? filas : filas.slice(0, corte);
  const modulos = corte === -1 ? [] : filas.slice(corte);

  const visibles = (lista: FilaTemario[]) =>
    lista.filter((f) => {
      if (f.nivel === 1) return true;
      const seccion = filas.find(
        (x) => x.nivel === 1 && x.id === f.seccionId,
      );
      if (!seccion || !estaExpandido(seccion)) return false;
      if (f.nivel === 2) return true;
      const area = filas.find((x) => x.nivel === 2 && x.id === f.areaId);
      return !!area && estaExpandido(area);
    });

  const pintar = (fila: FilaTemario) => (
    <Fila
      key={fila.id}
      fila={fila}
      expandido={estaExpandido(fila)}
      onAlternar={() => onAlternar(fila.id)}
    />
  );

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <ul aria-label="Secciones de núcleo">{visibles(nucleo).map(pintar)}</ul>
      {modulos.length > 0 && (
        <>
          <div
            id="banda-modulos"
            className="border-b border-border bg-bg px-4 py-2.5 font-condensed text-xs font-semibold uppercase tracking-[0.06em] text-muted"
          >
            Módulos
          </div>
          <ul aria-labelledby="banda-modulos">{visibles(modulos).map(pintar)}</ul>
        </>
      )}
    </div>
  );
}
