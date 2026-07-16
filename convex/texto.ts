/**
 * Comparación canónica de identidad por nombre, compartida.
 *
 * Vivía privada en `convex/grupos.ts` (LUI-12). LUI-18 la necesita para la
 * unicidad del temario —`(padre, nombre)`— y duplicarla crearía **dos
 * definiciones de «mismo nombre»** que pueden derivar: exactamente la clase de
 * bug que LUI-9 arregló extrayendo `metricas.ts` cuando dos pantallas contiguas
 * daban números distintos bajo la misma etiqueta. Movimiento puro: cero cambio de
 * comportamiento.
 */

/** Forma canónica para comparar identidad: sin espacios extremos ni dobles, en
 *  minúsculas locales. Así "Matutino A", "matutino a" y "Matutino  A" colisionan. */
export function canonizar(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}
