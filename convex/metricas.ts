import { type Doc } from "./_generated/dataModel";

/**
 * Regla ÚNICA de «examen aplicado» (LUI-9 · reconcilia LUI-12).
 *
 * Una asignación cuenta como APLICADA desde que su ventana **abre**
 * (`abreEn <= ahora`), no cuando cierra: `abreEn` es el instante en que las
 * alumnas pudieron presentarla.
 *
 * Antes `grupos.obtener` usaba `cierraEn <= ahora`, con tres fallas concretas:
 * (1) un examen que se está presentando **ahora mismo** contaba como no aplicado;
 * (2) uno aplicado el 3 de julio con ventana que cierra el 2 de agosto contaba
 * como **de agosto**; y (3) la métrica dependía de la longitud de la ventana, no
 * de si alguien lo presentó. El resultado visible era que `/admin` y la ficha del
 * grupo mostraban **la misma etiqueta con dos números distintos**.
 *
 * Se expresa de dos formas EQUIVALENTES; **si cambias una, cambia la otra**:
 *   · `fueAplicada(a, ahora)` — filtro en memoria (`grupos.obtener`).
 *   · rango `q.lte("abreEn", ahora)` sobre el índice `by_abre` — acota la lectura
 *     a nivel de BD (`panel.resumen`).
 * Un rango de índice no se puede componer desde un predicado, así que el
 * acoplamiento entre ambas es este comentario. Es el precio de no escanear la
 * tabla completa en cada carga del panel.
 *
 * Cuando LUI-30 traiga los resultados del instructor, «aplicada» pasará a ser
 * «tiene intentos enviados» y **este archivo es el único punto a cambiar**.
 * (Antes decía «LUI-20», pero la biblioteca de exámenes NO trae resultados. LUI-20
 * sí define `tieneResultados` — sonda propia sobre `by_examen_estado` con OTRA
 * pregunta: «¿existe al menos un enviado?» para elegir la acción de la fila, no
 * «¿la asignación fue aplicada?» para las métricas del panel. Además LUI-20
 * mantiene el invariante `fueAplicada(a,t) ⟺ estadoDeVentana(a,t) !== "programada"`
 * — lo asegura `scripts/test-examenes.ts`.)
 */
export function fueAplicada(a: Doc<"asignaciones">, ahora: number): boolean {
  return a.abreEn <= ahora;
}
