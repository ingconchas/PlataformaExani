/**
 * Prueba del núcleo PURO de la pantalla Inicio (LUI-24). Corre con `npm run test:inicio`
 * (tsx). Prueba `convex/inicioAlumna.ts`: el predicado y el orden canónicos del read-model
 * `ultimosDiagnosticos`, la decisión tras parche, el título total, la línea del banner y la
 * derivación de variantes. Todo sin BD — el servidor las reusa, este es el único lugar donde
 * pueden probarse aisladas.
 *
 * Archivo NUEVO: las suites existentes conservan sus conteos IDÉNTICOS.
 */
import {
  BYTES_POR_PAGINA_PUNTEROS,
  LIMITE_DOC_CONVEX,
  LOTE_PUNTEROS,
  decisionTrasParche,
  derivarInicio,
  esDiagnosticoElegible,
  ganaPuntero,
  lineaUltimoResultado,
  splitRequiredImposible,
  tituloDeCierre,
  type IntentoId,
  type PunteroTupla,
  type UltimoDiagnostico,
} from "../convex/inicioAlumna";
import {
  type FilaCruda,
  type MisExamenesCrudo,
} from "../convex/misExamenes";
import {
  conducirBackfill,
  conducirRecomputo,
  conducirVerificacion,
} from "./lui24-drivers.mjs";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const id = (s: string) => s as never;
const iid = (s: string): IntentoId => s as never;
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const AHORA = Date.UTC(2026, 6, 12, 18, 0, 0);

/** Intento mínimo para el predicado (estructural). */
function intento(
  over: Partial<{
    estado: string;
    numeroIntento: number | null;
    formaCierre: string | null;
    enviadoEn: number | null;
  }> = {},
) {
  return {
    estado: "enviado",
    numeroIntento: 1,
    formaCierre: "manual",
    enviadoEn: AHORA,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Contrato de página (SplitRequired imposible por aritmética)");
{
  check(
    "LOTE_PUNTEROS × LIMITE_DOC_CONVEX (1 MiB DURO) < BYTES_POR_PAGINA < 16 MiB",
    splitRequiredImposible(),
    `${LOTE_PUNTEROS}×${LIMITE_DOC_CONVEX}=${LOTE_PUNTEROS * LIMITE_DOC_CONVEX} vs ${BYTES_POR_PAGINA_PUNTEROS}`,
  );
  check(
    "…razonado contra el LÍMITE DURO por documento, no una estimación nominal",
    LOTE_PUNTEROS * LIMITE_DOC_CONVEX < BYTES_POR_PAGINA_PUNTEROS,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ esDiagnosticoElegible (predicado canónico)");
{
  check("enviado + 1 + formaCierre + fecha finita ⇒ elegible", esDiagnosticoElegible(intento()));
  check("en_curso ⇒ NO", !esDiagnosticoElegible(intento({ estado: "en_curso" })));
  check("numeroIntento 2 (repaso) ⇒ NO", !esDiagnosticoElegible(intento({ numeroIntento: 2 })));
  check("numeroIntento null (legado) ⇒ NO", !esDiagnosticoElegible(intento({ numeroIntento: null })));
  check("sin formaCierre ⇒ NO", !esDiagnosticoElegible(intento({ formaCierre: null })));
  check("enviadoEn null ⇒ NO", !esDiagnosticoElegible(intento({ enviadoEn: null })));
  // ⭐ fechas NO finitas (media del dictamen v4→v5): NaN/±Infinity NO son elegibles.
  check("enviadoEn NaN ⇒ NO", !esDiagnosticoElegible(intento({ enviadoEn: NaN })));
  check("enviadoEn Infinity ⇒ NO", !esDiagnosticoElegible(intento({ enviadoEn: Infinity })));
  check("enviadoEn -Infinity ⇒ NO", !esDiagnosticoElegible(intento({ enviadoEn: -Infinity })));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ ganaPuntero (orden total)");
{
  const t = (i: string, e: number): PunteroTupla => ({ intentoId: iid(i), enviadoEn: e });
  check("null vs tupla ⇒ tupla", ganaPuntero(null, t("a", 100))?.intentoId === iid("a"));
  check("tupla vs null ⇒ tupla", ganaPuntero(t("a", 100), null)?.intentoId === iid("a"));
  check("mayor enviadoEn gana", ganaPuntero(t("a", 100), t("b", 200))?.intentoId === iid("b"));
  check("menor enviadoEn NO gana", ganaPuntero(t("a", 200), t("b", 100))?.intentoId === iid("a"));
  check(
    "empate de enviadoEn ⇒ desempata por id (mayor)",
    ganaPuntero(t("a", 100), t("b", 100))?.intentoId === iid("b"),
  );
  check(
    "misma tupla exacta ⇒ no-op (devuelve el actual)",
    ganaPuntero(t("a", 100), t("a", 100))?.intentoId === iid("a"),
  );
  // ⭐ Malformadas no desplazan (mayor 1 v3→v4): el predicado las excluye ANTES de competir,
  // así que aquí basta con que un elegible antiguo domine a uno más nuevo pero inelegible.
  const viejoElegible = intento({ enviadoEn: 100 });
  const nuevoSinForma = intento({ enviadoEn: 200, formaCierre: null });
  const nuevoSinFecha = intento({ enviadoEn: null });
  check(
    "elegible antiguo + más nuevo SIN formaCierre ⇒ el antiguo se conserva (el nuevo ni compite)",
    esDiagnosticoElegible(viejoElegible) && !esDiagnosticoElegible(nuevoSinForma),
  );
  check(
    "elegible antiguo + más nuevo SIN enviadoEn ⇒ igual",
    esDiagnosticoElegible(viejoElegible) && !esDiagnosticoElegible(nuevoSinFecha),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ decisionTrasParche (re-anclaje dev)");
{
  const puntero: PunteroTupla = { intentoId: iid("A"), enviadoEn: 200 };
  check(
    "id ≠ apuntado ⇒ comparar",
    decisionTrasParche(puntero, { intentoId: iid("B"), elegible: true, enviadoEn: 150 }) ===
      "comparar",
  );
  check(
    "apuntado que AVANZA (≥) ⇒ actualizar",
    decisionTrasParche(puntero, { intentoId: iid("A"), elegible: true, enviadoEn: 250 }) ===
      "actualizar",
  );
  check(
    "apuntado que se mantiene igual ⇒ actualizar",
    decisionTrasParche(puntero, { intentoId: iid("A"), elegible: true, enviadoEn: 200 }) ===
      "actualizar",
  );
  // ⭐ Contraejemplo del dictamen v4→v5: A@200 apuntado, A→100 ⇒ borrar y recomputar.
  check(
    "apuntado que RETROCEDE ⇒ borrarYRecomputar",
    decisionTrasParche(puntero, { intentoId: iid("A"), elegible: true, enviadoEn: 100 }) ===
      "borrarYRecomputar",
  );
  check(
    "apuntado que deja de ser ELEGIBLE ⇒ borrarYRecomputar",
    decisionTrasParche(puntero, { intentoId: iid("A"), elegible: false, enviadoEn: 300 }) ===
      "borrarYRecomputar",
  );
  check(
    "sin puntero ⇒ comparar",
    decisionTrasParche(null, { intentoId: iid("A"), elegible: true, enviadoEn: 100 }) ===
      "comparar",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ tituloDeCierre (total) y lineaUltimoResultado");
{
  check("asignación con snapshot manda", tituloDeCierre("Simulacro General 2", "Otro") === "Simulacro General 2");
  check("sin snapshot ⇒ título del examen", tituloDeCierre(null, "Examen X") === "Examen X");
  check("sin ninguno ⇒ «Simulacro»", tituloDeCierre(null, null) === "Simulacro");
  check("sin ninguno (undefined) ⇒ «Simulacro»", tituloDeCierre(undefined, undefined) === "Simulacro");

  check("línea con puntaje redondea", lineaUltimoResultado("Sim", 1146.6) === "Sim — 1147");
  check(
    "⭐ línea sin calificación NO invoca redondeo (jamás NaN)",
    lineaUltimoResultado("Sim", null) === "Sim — sin calificación",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ derivarInicio (variantes)");
{
  const filaAbierta = (aid: string, over: Partial<FilaCruda> = {}): FilaCruda => ({
    asignacionId: id(aid),
    examenId: id("ex_" + aid),
    titulo: "Simulacro",
    numReactivos: 90,
    duracionMin: 180,
    tipoEtiqueta: "Simulacro general",
    esModulo: false,
    abreEn: AHORA - DIA,
    cierraEn: AHORA + DIA,
    enviados: [],
    enCurso: null,
    ...over,
  });
  const crudo = (filas: FilaCruda[], flags: Partial<MisExamenesCrudo> = {}): MisExamenesCrudo => ({
    filas,
    historialGrupoIncompleto: false,
    directasIncompletas: false,
    asignacionesLegadasOmitidas: false,
    ...flags,
  });
  const ultimo: UltimoDiagnostico = {
    intentoId: iid("i1"),
    titulo: "Simulacro General 2",
    puntajeCrudo: 1082.4,
    enviadoEn: AHORA - 2 * DIA,
    numeroIntento: 1,
  };

  const conUP = derivarInicio(crudo([filaAbierta("p1")]), ultimo, AHORA);
  check("U ∧ P ⇒ completa", conUP.variante === "completa");
  check("…y proximo === pendientes[0] (identidad)", conUP.proximo?.asignacionId === id("p1"));

  const soloU = derivarInicio(crudo([]), ultimo, AHORA);
  check("U ∧ ¬P ⇒ sinPendientes", soloU.variante === "sinPendientes" && soloU.proximo === null);

  const soloP = derivarInicio(crudo([filaAbierta("p1")]), null, AHORA);
  check("¬U ∧ P ⇒ sinContestados", soloP.variante === "sinContestados");

  const nada = derivarInicio(crudo([]), null, AHORA);
  check("¬U ∧ ¬P ⇒ bienvenida", nada.variante === "bienvenida" && !nada.hayFuturas);

  // hayFuturas ajusta el copy (no la variante): una futura enciende la bandera.
  const conFutura = derivarInicio(
    crudo([filaAbierta("f1", { abreEn: AHORA + DIA, cierraEn: AHORA + 2 * DIA })]),
    ultimo,
    AHORA,
  );
  check("una futura ⇒ hayFuturas, variante sinPendientes", conFutura.variante === "sinPendientes" && conFutura.hayFuturas);

  // Cruce simulado de cierraEn: el mismo crudo, antes y después del cierre.
  const cierraPronto = crudo([filaAbierta("p1", { cierraEn: AHORA + 100 * MINUTO })]);
  const antes = derivarInicio(cierraPronto, ultimo, AHORA);
  const despues = derivarInicio(cierraPronto, ultimo, AHORA + 200 * MINUTO);
  check("antes del cierre: hay proximo", antes.proximo !== null);
  check("después del cierre: ya no (variante sinPendientes)", despues.proximo === null && despues.variante === "sinPendientes");
  check("la frontera del cierre está en `fronteras`", antes.fronteras.includes(AHORA + 100 * MINUTO));
}

// ─────────────────────────────────────────────────────────────────────────────
// Las pruebas de los conductores son ASÍNCRONAS; van en un IIFE porque este archivo compila
// a CJS (sin top-level await). El resumen y el `process.exit` van dentro para que corran
// DESPUÉS de ellas.
async function pruebasDeConductores() {
  console.log("\n▸ Conductores FAIL-CLOSED (nunca reportan sobre una corrida parcial)");
  // `run` que SIEMPRE ofrece otra página/fase: el conductor debe LANZAR al agotar el guard,
  // jamás retornar un acumulado parcial (el mayor del dictamen de ronda 2).
  const verInfinito = async () => ({
    discrepancias: 0,
    malformados: 0,
    siguiente: { fase: 1 as const, cursor: "x" },
  });
  const bfInfinito = async () => ({
    estampados: 0,
    malformados: 0,
    isDone: false,
    continueCursor: "x",
  });
  const rcInfinito = async () => ({
    isDone: false,
    reiniciar: false,
    continueCursor: "x",
    maximoParcial: null,
  });
  let lanzoVer = false;
  try {
    await conducirVerificacion(verInfinito, 5);
  } catch {
    lanzoVer = true;
  }
  check("⭐ conducirVerificacion LANZA si nunca termina (no reporta 0/0 parcial)", lanzoVer);
  let lanzoBf = false;
  try {
    await conducirBackfill(bfInfinito, undefined, 5);
  } catch {
    lanzoBf = true;
  }
  check("conducirBackfill LANZA si nunca termina", lanzoBf);
  let lanzoRc = false;
  try {
    await conducirRecomputo(rcInfinito, "u1" as never, undefined, 5);
  } catch {
    lanzoRc = true;
  }
  check("conducirRecomputo LANZA si nunca termina", lanzoRc);
  // Y TERMINA bien cuando el run señala fin: `siguiente === null`.
  const verFin = async () => ({ discrepancias: 0, malformados: 0, siguiente: null });
  const okVer = await conducirVerificacion(verFin, 5);
  check(
    "conducirVerificacion retorna SOLO al ver siguiente===null",
    okVer.discrepancias === 0 && okVer.malformados === 0,
  );
}

void pruebasDeConductores().then(() => {
  console.log("");
  console.log(`${ok} pruebas OK, ${fallos} fallos`);
  process.exit(fallos === 0 ? 0 : 1);
});
