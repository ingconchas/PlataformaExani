import { type FunctionReturnType } from "convex/server";
import { type api } from "@/convex/_generated/api";

/**
 * La fila del árbol, derivada del DTO y no del schema — idiom del repo
 * (`grupos-client.tsx:26`). Es una unión discriminada por `nivel`, así que el
 * cliente sabe por fila qué campos existen (`tipo` solo en secciones, `areaId`
 * solo en subtemas) sin nullables que haya que comprobar a mano.
 */
export type FilaTemario = FunctionReturnType<
  typeof api.temario.listarArbol
>[number];

/** Etiqueta de nivel que esperan las mutations (`renombrar`/`mover`/…). */
export type NivelClave = "seccion" | "area" | "subtema";
export const nivelClave = (nivel: 1 | 2 | 3): NivelClave =>
  nivel === 1 ? "seccion" : nivel === 2 ? "area" : "subtema";

/** Nombre legible del nivel, para títulos de modal y mensajes. */
export const nivelNombre = (nivel: 1 | 2 | 3): string =>
  nivel === 1 ? "sección" : nivel === 2 ? "área" : "subtema";

/**
 * Los hermanos de una fila, EN ORDEN. Depende de que `construirTemario` siga
 * emitiendo orden total (la única acoplación del read-path congelado). Para una
 * sección los hermanos son las de su mismo `tipo` — por eso un núcleo no puede
 * cruzar el separador MÓDULOS.
 */
export function hermanosDe(
  filas: FilaTemario[],
  fila: FilaTemario,
): FilaTemario[] {
  if (fila.nivel === 1) {
    return filas.filter((f) => f.nivel === 1 && f.tipo === fila.tipo);
  }
  if (fila.nivel === 2) {
    return filas.filter((f) => f.nivel === 2 && f.seccionId === fila.seccionId);
  }
  return filas.filter((f) => f.nivel === 3 && f.areaId === fila.areaId);
}

export const puedeSubir = (filas: FilaTemario[], fila: FilaTemario): boolean =>
  hermanosDe(filas, fila).findIndex((f) => f.id === fila.id) > 0;

export const puedeBajar = (filas: FilaTemario[], fila: FilaTemario): boolean => {
  const h = hermanosDe(filas, fila);
  const i = h.findIndex((f) => f.id === fila.id);
  return i >= 0 && i < h.length - 1;
};

/** El botón Eliminar se ofrece solo si el subárbol no tiene reactivos (cosmético:
 *  el servidor re-verifica con la sonda). Un padre con hijos vacíos es elegible —
 *  el borrado cascadea. */
export const puedeEliminar = (fila: FilaTemario): boolean => fila.reactivos === 0;
