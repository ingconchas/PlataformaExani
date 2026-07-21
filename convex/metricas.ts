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
 * «tiene intentos enviados». ⚠️ **Este archivo NO basta para esa migración** (una
 * versión anterior de este comentario afirmaba «único punto a cambiar»; era
 * falso): la regla vive implementada en DOS consumidores que hay que migrar
 * ATÓMICAMENTE o el bug de la etiqueta duplicada con números distintos regresa —
 *   · `panel.resumen` (convex/panel.ts) la implementa como RANGO del índice
 *     `by_abre` (un rango no se compone desde un predicado), y migrarla a
 *     «tiene enviados» cambia además su presupuesto de lectura (habrá que sondar
 *     intentos por asignación, no filtrar por fecha);
 *   · `grupos.obtener` (convex/grupos.ts) aplica `fueAplicada` en memoria.
 * (LUI-20 no participa: su `tieneResultados` es una sonda propia sobre
 * `by_examen_estado` con OTRA pregunta — «¿existe al menos un enviado?» para
 * elegir la acción de la fila, no «¿la asignación fue aplicada?». Y LUI-20
 * mantiene el invariante `fueAplicada(a,t) ⟺ estadoDeVentana(a,t) !==
 * "programada"` — lo asegura `scripts/test-examenes.ts`.)
 *
 * Filas-ALUMNO (LUI-22): una asignación individual aplicada CUENTA como
 * aplicada en AMBAS expresiones de la regla — decisión documentada. Excluirlas
 * exigiría filtrar el rango de `by_abre` desde un predicado (imposible) o migrar
 * los dos consumidores a medias, exactamente lo que este comentario prohíbe.
 * `grupos.obtener` no las ve (su `by_grupo eq id` jamás matchea `undefined`):
 * una individual no es una aplicación DEL GRUPO, también a propósito. LUI-30
 * migrará las filas-alumno junto con todo lo demás.
 */
export function fueAplicada(a: Doc<"asignaciones">, ahora: number): boolean {
  return a.abreEn <= ahora;
}
