/**
 * Conductores del read-model `ultimosDiagnosticos` (LUI-24), COMPARTIDOS por las suites y el
 * driver de despliegue. Una propiedad global (cada puntero es el máximo elegible de su
 * alumna) se procesa por PÁGINAS/FASES; estas funciones las encadenan hasta terminar. Cada
 * una recibe `run(fn, args) → Promise<objetoJSON>` para no duplicar el `spawn` de cada suite.
 */

// ⚠️ Los TRES conductores son FAIL-CLOSED: retornan SOLO al observar la señal de terminación
// (`isDone` / `siguiente === null`) y LANZAN si agotan el guard. Un `return` al agotar el
// guard reportaría un resultado PARCIAL como completo — exactamente lo que invalidaría la
// equivalencia «0/0 ⇒ máximo global demostrado». `maxIter` es parametrizable para poder
// probar el caso «nunca termina» sin correr el guard de producción entero.

const MAX_ITER_DEFECTO = 200_000;

/** Recómputo PAGINADO del puntero de una alumna, hasta `isDone`. Reinicia si el commit final
 *  detecta que el acumulado cambió entre páginas (CAS). FAIL-CLOSED. */
export async function conducirRecomputo(run, alumnoId, limiteBytesOverride, maxIter = MAX_ITER_DEFECTO) {
  let cursor = null;
  let maximoParcial = null;
  for (let i = 0; i < maxIter; i++) {
    const args = { confirmar: "SOLO_DEV", alumnoId, cursor, maximoParcial };
    if (limiteBytesOverride !== undefined) args.limiteBytesOverride = limiteBytesOverride;
    const r = await run("seed:recomputarPunteroDe", args);
    if (r.reiniciar) {
      cursor = null;
      maximoParcial = null;
      continue;
    }
    if (r.isDone) return;
    cursor = r.continueCursor;
    maximoParcial = r.maximoParcial;
  }
  throw new Error("conducirRecomputo no terminó (guard agotado)");
}

/** Backfill idempotente hasta `isDone`; suma estampados y malformados. FAIL-CLOSED. */
export async function conducirBackfill(run, limiteBytesOverride, maxIter = MAX_ITER_DEFECTO) {
  let cursor = null;
  let estampados = 0;
  let malformados = 0;
  for (let i = 0; i < maxIter; i++) {
    const args = { cursor };
    if (limiteBytesOverride !== undefined) args.limiteBytesOverride = limiteBytesOverride;
    const r = await run("migracionesMetricas:backfillUltimosDiagnosticos", args);
    estampados += r.estampados;
    malformados += r.malformados;
    if (r.isDone) return { estampados, malformados };
    cursor = r.continueCursor;
  }
  throw new Error("conducirBackfill no terminó (guard agotado)");
}

/** Verificador BIFÁSICO hasta terminar (`siguiente === null`); suma discrepancias y
 *  malformados. FAIL-CLOSED: LANZA si agota el guard con `siguiente` aún no nulo, para no
 *  reportar 0/0 sobre una verificación PARCIAL. */
export async function conducirVerificacion(run, maxIter = MAX_ITER_DEFECTO) {
  let fase = 1;
  let cursor = null;
  let discrepancias = 0;
  let malformados = 0;
  for (let i = 0; i < maxIter; i++) {
    const r = await run("migracionesMetricas:verificarUltimosDiagnosticos", { fase, cursor });
    discrepancias += r.discrepancias;
    malformados += r.malformados;
    if (r.siguiente === null) return { discrepancias, malformados };
    fase = r.siguiente.fase;
    cursor = r.siguiente.cursor;
  }
  throw new Error("conducirVerificacion no terminó (guard agotado)");
}
