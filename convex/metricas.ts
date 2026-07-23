/**
 * Regla ÚNICA de «examen aplicado» (LUI-9 → migrada por LUI-30) + los cortes puros del
 * panel de la administradora. Módulo PURO: importable por `scripts/test-examenes.ts` y
 * `scripts/test-resultados.ts` — solo tipos estructurales, sin `ctx` ni `_generated`.
 *
 * ══ LA MIGRACIÓN (LUI-30, plan v6) ══
 *
 * Hasta LUI-30, «aplicada» era `abreEn <= ahora` («la ventana ya abrió») expresada en DOS
 * formas acopladas —un predicado en memoria y un rango de `by_abre`— cuya doble vida este
 * docblock confesaba como trampa. Con resultados reales en la plataforma esa definición
 * miente: una ventana abierta que NADIE contestó no es un examen aplicado.
 *
 * La regla nueva es **«tiene al menos un intento enviado»**, MATERIALIZADA en el
 * read-model `asignaciones.envioRegistradoEn` (contrato: SOLO existencia — docblock en
 * schema.ts): la estampa `player.finalizarIntento` en cada cierre y la respaldó el
 * backfill verificado en producción (reconciliador + verificador de
 * `migracionesMetricas.ts`, 0 discrepancias de presencia sobre `main`=`d30ee34`). Vuelve
 * a existir UN solo predicado puro — la doble expresión rango/predicado MURIÓ: el rango
 * de `by_abre` en `panel.resumen` hoy solo ACOTA el periodo; «aplicada» la decide este
 * predicado sobre los docs ya leídos.
 *
 * Filas-ALUMNO (LUI-22): una asignación individual con envío CUENTA como aplicada —
 * continúa la decisión documentada de LUI-22. `grupos.obtener` no las ve (su
 * `by_grupo eq id` jamás matchea `undefined`): una individual no es una aplicación DEL
 * GRUPO, también a propósito.
 *
 * ══ INVARIANTE TEMPORAL (cuantificado — auditoría del plan, Media 2 de v3) ══
 *
 *     fueAplicada(a) ⟹ a.envioRegistradoEn ≥ a.abreEn
 *     y para todo t ≥ a.envioRegistradoEn:  estadoDeVentana(a, t) ≠ "programada"
 *
 * NO es una implicación universal sobre t: en un instante ANTERIOR a `abreEn` la ventana
 * sí era «programada» aunque hoy exista un envío. La desigualdad la garantiza POR
 * CONSTRUCCIÓN la guarda 5 de `player.iniciarIntento` (todo intento nace con la ventana
 * abierta, y `enviadoEn ≥ iniciadoEn ≥ abreEn`); el verificador del backfill la cuenta
 * como testigo informativo (`discrepanciasTemporales`), nunca como gate.
 */

/** Lo único que la regla necesita de una asignación — tipo ESTRUCTURAL a propósito:
 *  las pruebas puras fabrican `{envioRegistradoEn: 5}` sin cargar `Doc`. */
export type AsignacionAplicable = { envioRegistradoEn?: number };

/** ¿La asignación fue APLICADA? ⟺ tiene al menos un intento enviado (existencia del
 *  read-model; el VALOR del campo no alimenta ninguna cifra). */
export function fueAplicada(a: AsignacionAplicable): boolean {
  return a.envioRegistradoEn !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cortes del panel de la administradora (LUI-9 migrado por LUI-30)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Centinela de la métrica «Exámenes aplicados este mes»: `panel.resumen` lee el rango del
 * mes con `take(MAX + 1)`. No existe frontera de escritura que limite las asignaciones
 * abiertas en un mes, así que el desborde es alcanzable con datos válidos y el conteo de
 * un prefijo sería preciso y falso a la vez — `contarAplicadasMes` responde
 * `{valor: null, incompleto: true}` y la UI muestra «—» con su nota, jamás una cifra.
 */
export const MAX_APLICADAS_MES_PANEL = 200;

/** Filas del rango `by_abre desc` que `panel.resumen` ESCANEA para hallar los 5 últimos
 *  aplicados. Con la regla nueva una fila abierta puede NO estar aplicada, así que los 5
 *  ya no son «los 5 primeros del índice»: se escanea una ventana acotada y, si se agota
 *  con menos de 5, `ultimosAplicados` lo DICE (`incompleto`) — puede haber aplicaciones
 *  más antiguas sin listar, y la UI lo enuncia en vez de fingir historial completo. */
export const SCAN_ULTIMOS_PANEL = 30;

/** Cuántas filas muestra «Últimos exámenes aplicados» (LUI-9). */
export const ULTIMOS_PANEL = 5;

/**
 * Cotas de `panel.alumnos` (el conteo de alumnas migró a su propia query en LUI-30:
 * `perfiles` admite strings sin tope de longitud, así que el viejo `.collect()` no tenía
 * presupuesto defendible — ahora es UN paginate con tope de filas Y bytes del runtime).
 * El corte responde `{alumnosRegistrados: null, incompleto: true}` — jamás un prefijo.
 */
export const MAX_ALUMNOS_CONTEO_PANEL = 2000;
export const ALUMNOS_BYTES_PANEL = 1_048_576;

/**
 * La métrica del mes sobre las filas YA RANGEADAS por `by_abre` (`take(MAX + 1)`).
 * `> MAX` = el centinela se llenó ⇒ `{valor: null, incompleto: true}` y JAMÁS se cuenta
 * el prefijo. La frontera exacta (200 cuenta, 201 corta) la fija `test-resultados.ts`.
 */
export function contarAplicadasMes(
  filasDelMes: readonly AsignacionAplicable[],
): { valor: number | null; incompleto: boolean } {
  if (filasDelMes.length > MAX_APLICADAS_MES_PANEL) {
    return { valor: null, incompleto: true };
  }
  return { valor: filasDelMes.filter(fueAplicada).length, incompleto: false };
}

/**
 * Los ≤5 últimos APLICADOS dentro de la ventana de escaneo (filas en orden `abreEn`
 * desc, como las entrega el índice). `incompleto` SOLO cuando la ventana se agotó llena
 * sin juntar los 5 — con menos de `SCAN_ULTIMOS_PANEL` filas leídas, el historial entero
 * ya fue visto y faltar filas significa que de verdad no hay más. Frontera «30 sin 5» en
 * `test-resultados.ts`.
 */
export function ultimosAplicados<T extends AsignacionAplicable>(
  filasEscaneadas: readonly T[],
): { filas: T[]; incompleto: boolean } {
  const aplicadas = filasEscaneadas.filter(fueAplicada).slice(0, ULTIMOS_PANEL);
  return {
    filas: aplicadas,
    incompleto:
      aplicadas.length < ULTIMOS_PANEL &&
      filasEscaneadas.length >= SCAN_ULTIMOS_PANEL,
  };
}
