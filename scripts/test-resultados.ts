/**
 * Pruebas PURAS de Resultados del examen (LUI-30 · LUI-31 integrada) — FASE A.
 *
 * Ejercitan el código de PRODUCCIÓN de `convex/resultados.ts`, el selector canónico de
 * `convex/simulacro.ts` y la frontera de nombre de `convex/temarioReglas.ts` (jamás
 * réplicas): el selector de intento-que-cuenta (tabla ①–⑥), la agregación de desgloses,
 * los detectores de corte, las dos derivaciones (selector de asignaciones y pantalla) y
 * sus fronteras exactas. Instante FIJO — las pruebas puras no leen el reloj.
 *
 * FASE B (§9, llegó con el PR de lectores): `fueAplicada` nueva, invariante
 * cuantificado, `contarAplicadasMes` 200/201 y `ultimosAplicados` 30-sin-5.
 *
 * Correr:  npm run test:resultados
 */
import { ConvexError } from "convex/values";
import {
  primerIntentoPorAlumna,
  promedioDeAsignacion,
  redondearPuntaje,
} from "../convex/simulacro";
import {
  agregarDesgloses,
  clasificacionesDistintas,
  corteDePagina,
  derivarResultados,
  derivarSelectorResultados,
  excedePresupuestoDeCatalogo,
  CATALOGO_CLASIF_BYTES,
  MAX_CLASIFICACIONES_RESULTADOS,
  UMBRAL_REFUERZO_AREA,
  type AsignacionDeResultados,
  type IntentoCrudoResultados,
  type ResultadosQ2,
  type ResultadosQ3,
} from "../convex/resultados";
import {
  MAX_NOMBRE_TEMARIO,
  MSG_NOMBRE_LARGO,
  validarNombreTemario,
} from "../convex/temarioReglas";
import {
  MAX_APLICADAS_MES_PANEL,
  SCAN_ULTIMOS_PANEL,
  ULTIMOS_PANEL,
  contarAplicadasMes,
  fueAplicada,
  ultimosAplicados,
} from "../convex/metricas";
import { estadoDeVentana } from "../convex/examenEstado";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

function mensajeDe(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ConvexError ? String(e.data) : `error inesperado: ${e}`;
  }
}

/** Ids tipados para los módulos puros (mismo truco que test-panel-instructor.ts). */
const id = (s: string) => s as never;

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const AHORA = 1_000_000_000_000;

const intento = (
  alumno: string,
  over: Partial<IntentoCrudoResultados> = {},
): IntentoCrudoResultados => ({
  alumnoId: id(alumno),
  estado: "enviado",
  numeroIntento: 1,
  iniciadoEn: AHORA - DIA,
  enviadoEn: AHORA - DIA + HORA,
  puntaje: 1000,
  ...over,
});
/** Legado: SIN numeroIntento (la clave se omite, no va `undefined` a medias). */
const legado = (
  alumno: string,
  over: Partial<IntentoCrudoResultados> = {},
): IntentoCrudoResultados => {
  const base = intento(alumno, over);
  delete (base as { numeroIntento?: number }).numeroIntento;
  return base;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · primerIntentoPorAlumna — la tabla de precedencia ①–⑥");
// ─────────────────────────────────────────────────────────────────────────────
{
  // ⭐ ① gana a todo: numerado calificado vs legado calificado más antiguo.
  const sel = primerIntentoPorAlumna(
    [intento("ana", { puntaje: 900 })],
    [legado("ana", { puntaje: 1200, iniciadoEn: AHORA - 10 * DIA })],
  );
  check("① numerado calificado gana al legado calificado", sel.get(id("ana"))?.puntaje === 900);
}
{
  // ⭐ Mixto del dictamen: numerado enviado SIN puntaje + legado calificado → gana ②.
  const diag = [intento("ana", { puntaje: undefined })];
  const leg = [legado("ana", { puntaje: 1100 })];
  const sel = primerIntentoPorAlumna(diag, leg);
  check("② mixto: legado calificado gana al numerado enviado sin puntaje", sel.get(id("ana"))?.puntaje === 1100);
  // ⭐ …y fila y promedio cuentan LO MISMO: el promedio usa ese legado.
  const prom = promedioDeAsignacion({ diagnosticos: diag, legado: leg, desbordado: false });
  check("② coherencia fila↔promedio: el promedio cuenta el mismo legado", prom.valor === 1100);
}
{
  // ⭐ Mixto del dictamen: numerado EN CURSO + legado calificado → gana ②.
  const diag = [intento("ana", { estado: "en_curso" as const, puntaje: undefined, enviadoEn: undefined })];
  const leg = [legado("ana", { puntaje: 950 })];
  const sel = primerIntentoPorAlumna(diag, leg);
  check("② numerado en_curso pierde ante legado calificado", sel.get(id("ana"))?.estado === "enviado");
  const prom = promedioDeAsignacion({ diagnosticos: diag, legado: leg, desbordado: false });
  check("② …y el promedio también lo cuenta (comportamiento histórico)", prom.valor === 950);
}
{
  // ⭐ Solo numerado enviado sin puntaje → ③ (se selecciona; el promedio no lo cuenta).
  const diag = [intento("ana", { puntaje: undefined })];
  const sel = primerIntentoPorAlumna(diag, []);
  check("③ numerado enviado sin puntaje se selecciona", sel.get(id("ana"))?.estado === "enviado");
  const prom = promedioDeAsignacion({ diagnosticos: diag, legado: [], desbordado: false });
  check("③ …pero jamás aporta al promedio (sin calificados → null)", prom.valor === null && !prom.incompleto);
}
{
  // ③ gana a ④: enviados sin puntaje, numerado primero.
  const sel = primerIntentoPorAlumna(
    [intento("ana", { puntaje: undefined, iniciadoEn: AHORA - HORA })],
    [legado("ana", { puntaje: undefined, iniciadoEn: AHORA - 10 * DIA })],
  );
  check("③ numerado sin puntaje gana al legado sin puntaje", sel.get(id("ana"))?.numeroIntento === 1);
}
{
  // ⭐ Proxy del legado: el enviado calificado MÁS ANTIGUO (no el mejor ni el último).
  const sel = primerIntentoPorAlumna(
    [],
    [
      legado("ana", { puntaje: 1300, iniciadoEn: AHORA - DIA }),
      legado("ana", { puntaje: 800, iniciadoEn: AHORA - 20 * DIA }),
    ],
  );
  check("② proxy legado = enviado calificado más antiguo", sel.get(id("ana"))?.puntaje === 800);
}
{
  // ⑤/⑥: en curso solo cuando NO hay ningún enviado; numerado gana al legado.
  const sel = primerIntentoPorAlumna(
    [intento("ana", { estado: "en_curso" as const, puntaje: undefined, enviadoEn: undefined, iniciadoEn: AHORA - HORA })],
    [legado("ana", { estado: "en_curso" as const, puntaje: undefined, enviadoEn: undefined, iniciadoEn: AHORA - 5 * DIA })],
  );
  check("⑤ en_curso numerado gana a ⑥ en_curso legado", sel.get(id("ana"))?.numeroIntento === 1);
}
{
  // TOTALIDAD ante manipulados: dos numerados calificados → el más antiguo, determinista.
  const sel = primerIntentoPorAlumna(
    [
      intento("ana", { puntaje: 1000, iniciadoEn: AHORA - DIA }),
      intento("ana", { puntaje: 1200, iniciadoEn: AHORA - 2 * DIA }),
    ],
    [],
  );
  check("totalidad: dos diagnósticos manipulados → gana el más antiguo", sel.get(id("ana"))?.puntaje === 1200);
  // Alumnas independientes no se pisan.
  const dos = primerIntentoPorAlumna([intento("ana"), intento("beto", { puntaje: 700 })], []);
  check("cada alumna conserva su propio intento", dos.size === 2 && dos.get(id("beto"))?.puntaje === 700);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("2 · agregarDesgloses — dedupe por construcción y flag honesto");
// ─────────────────────────────────────────────────────────────────────────────
{
  const conteoS = (s: string, aciertos: number, total: number) => ({ seccionId: id(s) as never, aciertos, total });
  const conteoA = (a: string, aciertos: number, total: number) => ({ areaId: id(a) as never, aciertos, total });
  // ⭐ Dedupe: alumna con numerado+legado — SOLO el seleccionado (numerado) agrega.
  const sel = primerIntentoPorAlumna(
    [intento("ana", { aciertosPorSeccion: [conteoS("s1", 2, 3)], aciertosPorArea: [conteoA("a1", 2, 3)] })],
    [legado("ana", { aciertosPorSeccion: [conteoS("s1", 9, 9)], aciertosPorArea: [conteoA("a1", 9, 9)] })],
  );
  const agg = agregarDesgloses(sel.values());
  check("⭐ dedupe: el legado de la misma alumna NO agrega (2/3, no 11/12)",
    agg.porSeccion.get(id("s1") as never)?.aciertos === 2 && agg.porSeccion.get(id("s1") as never)?.total === 3);
  // ⭐ sinDesglose: enviado sin arrays cuenta y queda FUERA (jamás un 0 fabricado).
  const agg2 = agregarDesgloses([
    intento("ana", { aciertosPorSeccion: [conteoS("s1", 1, 2)], aciertosPorArea: [conteoA("a1", 1, 2)] }),
    intento("beto", { aciertosPorSeccion: undefined, aciertosPorArea: undefined }),
  ]);
  check("⭐ enviado sin desglose → sinDesglose=1 y fuera de la agregación",
    agg2.sinDesglose === 1 && agg2.porSeccion.get(id("s1") as never)?.total === 2);
  // En curso no agrega ni cuenta como sinDesglose.
  const agg3 = agregarDesgloses([intento("ana", { estado: "en_curso" as const, aciertosPorSeccion: undefined, aciertosPorArea: undefined })]);
  check("en_curso no agrega ni incrementa sinDesglose", agg3.sinDesglose === 0 && agg3.porSeccion.size === 0);
  // Suma entre alumnas distintas.
  const agg4 = agregarDesgloses([
    intento("ana", { aciertosPorSeccion: [conteoS("s1", 1, 3)], aciertosPorArea: [conteoA("a1", 1, 3)] }),
    intento("beto", { aciertosPorSeccion: [conteoS("s1", 3, 3)], aciertosPorArea: [conteoA("a1", 3, 3)] }),
  ]);
  check("agrega entre alumnas (4/6)", agg4.porSeccion.get(id("s1") as never)?.aciertos === 4 && agg4.porSeccion.get(id("s1") as never)?.total === 6);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("3 · clasificacionesDistintas — frontera 500/501 y estabilidad");
// ─────────────────────────────────────────────────────────────────────────────
{
  const secciones = Array.from({ length: 250 }, (_, i) => ({ seccionId: id(`s${i}`) as never, aciertos: 0, total: 1 }));
  const areas = (n: number) => Array.from({ length: n }, (_, i) => ({ areaId: id(`a${i}`) as never, aciertos: 0, total: 1 }));
  const en500 = clasificacionesDistintas(
    [intento("ana", { aciertosPorSeccion: secciones, aciertosPorArea: areas(250) })], [], null,
  );
  check(`⭐ ${MAX_CLASIFICACIONES_RESULTADOS} distintas NO desbordan`, !en500.desbordado && en500.seccionIds.length + en500.areaIds.length === 500);
  const en501 = clasificacionesDistintas(
    [intento("ana", { aciertosPorSeccion: secciones, aciertosPorArea: areas(251) })], [], null,
  );
  check("⭐ 501 distintas desbordan (fail-closed del llamador)", en501.desbordado);
  const conDeclaradas = clasificacionesDistintas(
    [intento("ana", { aciertosPorSeccion: [{ seccionId: id("sX") as never, aciertos: 0, total: 1 }], aciertosPorArea: [] })],
    [],
    [id("sDecl") as never, id("sX") as never],
  );
  check("las declaradas van primero y sin duplicar", conDeclaradas.seccionIds.join(",") === "sDecl,sX");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("4 · corteDePagina — las CUATRO combinaciones (⭐ discrimina !isDone)");
// ─────────────────────────────────────────────────────────────────────────────
check("página completa bajo el tope → sin corte", !corteDePagina({ numFilas: 400, isDone: true, cap: 400 }));
check("centinela lleno (filas > cap) → corte", corteDePagina({ numFilas: 401, isDone: true, cap: 400 }));
check("⭐ bytes: página corta con isDone=false → corte (la rama que el E2E pone en rojo)", corteDePagina({ numFilas: 300, isDone: false, cap: 400 }));
check("ambas señales a la vez → corte", corteDePagina({ numFilas: 401, isDone: false, cap: 400 }));

// ─────────────────────────────────────────────────────────────────────────────
console.log("5 · excedePresupuestoDeCatalogo — frontera exacta de bytes");
// ─────────────────────────────────────────────────────────────────────────────
check(`⭐ exactamente ${CATALOGO_CLASIF_BYTES} bytes aún caben`, !excedePresupuestoDeCatalogo(CATALOGO_CLASIF_BYTES));
check("un byte más corta", excedePresupuestoDeCatalogo(CATALOGO_CLASIF_BYTES + 1));

// ─────────────────────────────────────────────────────────────────────────────
console.log("6 · validarNombreTemario — frontera de escritura 120/121");
// ─────────────────────────────────────────────────────────────────────────────
check(`⭐ ${MAX_NOMBRE_TEMARIO} caracteres pasan`, mensajeDe(() => validarNombreTemario("x".repeat(MAX_NOMBRE_TEMARIO))) === null);
check("⭐ 121 caracteres rechazan con el copy exacto", mensajeDe(() => validarNombreTemario("x".repeat(MAX_NOMBRE_TEMARIO + 1))) === MSG_NOMBRE_LARGO);
check("el trim corre ANTES de medir (120 + espacios pasa)", mensajeDe(() => validarNombreTemario(`  ${"x".repeat(MAX_NOMBRE_TEMARIO)}  `)) === null);
check("vacío sigue siendo obligatorio", mensajeDe(() => validarNombreTemario("   ")) !== null);

// ─────────────────────────────────────────────────────────────────────────────
console.log("7 · derivarSelectorResultados — default, fallback y fronteras");
// ─────────────────────────────────────────────────────────────────────────────
const fila = (
  aId: string,
  abreEn: number,
  cierraEn: number,
  over: Partial<AsignacionDeResultados> = {},
): AsignacionDeResultados => ({
  asignacionId: id(aId),
  grupoId: id(`g-${aId}`),
  grupoNombre: `Grupo ${aId}`,
  grupoActivo: true,
  abreEn,
  cierraEn,
  fechaAbre: "28 jun 2026",
  ...over,
});
{
  const sel = derivarSelectorResultados(
    [
      fila("vieja", AHORA - 10 * DIA, AHORA - 3 * DIA),
      fila("reciente", AHORA - DIA, AHORA + DIA),
      fila("futura", AHORA + 5 * DIA, AHORA + 6 * DIA),
    ],
    AHORA,
  );
  check("⭐ default = la MÁS RECIENTE ya abierta/cerrada (no la futura)", sel.seleccionDefault === id("reciente"));
  check("la programada se etiqueta como tal", sel.opciones.find((o) => o.asignacionId === id("futura"))?.etiqueta.includes("Programada") === true);
  check("⭐ fronteras = instantes FUTUROS ordenados (cierra reciente, abre futura, cierra futura)",
    JSON.stringify(sel.fronteras) === JSON.stringify([AHORA + DIA, AHORA + 5 * DIA, AHORA + 6 * DIA]));
  // ⭐ El cruce de `abreEn` habilita: re-derivar con el reloj después de la frontera.
  const despues = derivarSelectorResultados(
    [fila("vieja", AHORA - 10 * DIA, AHORA - 3 * DIA), fila("futura", AHORA + 5 * DIA, AHORA + 6 * DIA)],
    AHORA + 5 * DIA,
  );
  check("⭐ al cruzar abreEn la programada se vuelve el default (sin recargar)", despues.seleccionDefault === id("futura"));
}
{
  // ⭐ Fallback «solo programadas»: la PRÓXIMA en abrir, con su placeholder (Media 3).
  const sel = derivarSelectorResultados(
    [fila("lejana", AHORA + 9 * DIA, AHORA + 10 * DIA), fila("proxima", AHORA + 2 * DIA, AHORA + 3 * DIA)],
    AHORA,
  );
  check("⭐ solo-programadas: default = la próxima en abrir", sel.seleccionDefault === id("proxima"));
  check("sin filas → default null", derivarSelectorResultados([], AHORA).seleccionDefault === null);
}
{
  const sel = derivarSelectorResultados(
    [
      fila("inactiva", AHORA - DIA, AHORA + DIA, { grupoActivo: false }),
      fila("borrada", AHORA - 2 * DIA, AHORA - DIA, { grupoNombre: null }),
    ],
    AHORA,
  );
  check("grupo inactivo lleva su rótulo «(inactivo)» (M3: sigue accesible)", sel.opciones[0].etiqueta.includes("(inactivo)"));
  check("grupo eliminado se dice honesto, jamás se inventa nombre", sel.opciones[1].etiqueta.startsWith("Grupo eliminado"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("8 · derivarResultados — la pantalla completa");
// ─────────────────────────────────────────────────────────────────────────────
const q2Base = (over: Partial<ResultadosQ2> = {}): ResultadosQ2 => ({
  ahoraServidor: AHORA,
  grupoId: id("g1"),
  grupoNombre: "Matutino A",
  grupoActivo: true,
  tituloExamen: "Simulacro General 2",
  numReactivos: 4,
  abreEn: AHORA - 2 * DIA,
  cierraEn: AHORA + DIA,
  alumnas: [
    { alumnoId: id("ana"), nombre: "Ana" },
    { alumnoId: id("beto"), nombre: "Beto" },
    { alumnoId: id("carla"), nombre: "Carla" },
  ],
  problema: null,
  ...over,
});
const catalogoBase = {
  secciones: [
    { seccionId: id("s1") as never, nombre: "Pensamiento matemático", orden: 0 },
    { seccionId: id("s2") as never, nombre: "Comprensión lectora", orden: 1 },
  ],
  areas: [
    { areaId: id("a1") as never, nombre: "Álgebra", orden: 0, seccionId: id("s1") as never },
    { areaId: id("a2") as never, nombre: "Aritmética", orden: 1, seccionId: id("s1") as never },
  ],
};
const q3Base = (over: Partial<ResultadosQ3> = {}): ResultadosQ3 => ({
  ahoraServidor: AHORA,
  ordenSecciones: [id("s1") as never, id("s2") as never],
  diagnosticos: [],
  legado: [],
  catalogo: catalogoBase,
  problema: null,
  ...over,
});
const cS = (s: string, aciertos: number, total: number) => ({ seccionId: id(s) as never, aciertos, total });
const cA = (a: string, aciertos: number, total: number) => ({ areaId: id(a) as never, aciertos, total });

{
  // Estados de problema: passthrough SIN datos parciales.
  for (const problema of ["roster", "intentos", "clasificaciones"] as const) {
    const q2 = problema === "roster" ? q2Base({ problema }) : q2Base();
    const q3 = problema === "roster" ? q3Base() : q3Base({ problema });
    const r = derivarResultados(q2, q3, AHORA);
    check(`problema «${problema}» → estado de problema, jamás cifras`, r.estado === "problema" && r.problema === problema);
  }
}
{
  const q3 = q3Base({
    diagnosticos: [
      intento("ana", { puntaje: 1000, aciertosPorSeccion: [cS("s1", 2, 4)], aciertosPorArea: [cA("a1", 1, 2), cA("a2", 1, 2)] }),
      intento("beto", { estado: "en_curso" as const, puntaje: undefined, enviadoEn: undefined, aciertosPorSeccion: undefined, aciertosPorArea: undefined }),
      intento("externa", { puntaje: 1300, aciertosPorSeccion: [cS("s1", 4, 4)], aciertosPorArea: [cA("a1", 2, 2), cA("a2", 2, 2)] }),
    ],
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("derivación debió producir datos");
  // ⭐ Ámbitos: la externa (fuera de roster) cuenta en promedio/max, NO en X/Y ni filas.
  check("⭐ promedio en ámbito asignación (incluye a la externa): (1000+1300)/2", r.promedio.valor === redondearPuntaje(1150));
  check("⭐ X⊆Y: participación 1 de 3 (la externa no infla X)", r.participacion.completaron === 1 && r.participacion.total === 3);
  check("presentaronFueraDeRoster la hace visible", r.presentaronFueraDeRoster === 1);
  check("mayor/menor puntaje del ámbito asignación", r.mayorPuntaje === 1300 && r.menorPuntaje === 1000);
  check("participación 1/3 < 60 % → tono naranja", r.participacion.tono === "orange");
  // ⭐ Paridad: el promedio ES promedioDeAsignacion sobre los mismos insumos.
  const paridad = promedioDeAsignacion({ diagnosticos: q3.diagnosticos, legado: q3.legado, desbordado: false });
  check("⭐ paridad bit a bit con promedioDeAsignacion", r.promedio.valor === paridad.valor && r.promedio.incompleto === paridad.incompleto);
  // Filas: orden por nombre; estados y celdas.
  check("filas = roster ordenado por nombre", r.filas.map((f) => f.nombre).join(",") === "Ana,Beto,Carla");
  check("Ana completada con puntaje redondeado", r.filas[0].estado === "completado" && r.filas[0].puntaje === 1000 && r.filas[0].enviadoEn !== null);
  check("Beto en curso con fecha de inicio y sin puntaje", r.filas[1].estado === "en_curso" && r.filas[1].puntaje === null && r.filas[1].iniciadoEn !== null);
  check("Carla pendiente (la ventana sigue abierta)", r.filas[2].estado === "pendiente");
  check("celdas por sección alineadas a columnas (Ana: 2/4 en s1, — en s2)",
    r.filas[0].porSeccion[0]?.aciertos === 2 && r.filas[0].porSeccion[1] === null);
  // Columnas: el orden DECLARADO manda.
  check("columnas en el orden declarado del examen", r.columnas.map((c) => c.nombre).join("|") === "Pensamiento matemático|Comprensión lectora");
  // Acordeón: s1 = 6/8 = 75 %; áreas por orden del catálogo.
  const s1 = r.acordeon[0];
  check("acordeón: pct de sección agregado (6/8)", s1.pct !== null && Math.abs(s1.pct - 0.75) < 1e-9);
  check("acordeón: áreas de la sección en orden de catálogo", s1.areas.map((a) => a.nombre).join("|") === "Álgebra|Aritmética");
  check("mejor sección = la única con datos", r.mejorSeccion?.nombre === "Pensamiento matemático");
  check("fronteras = [cierraEn] cuando aún no cierra", JSON.stringify(r.fronteras) === JSON.stringify([AHORA + DIA]));
  check("sin legados sin desglose → datosCompletos", r.datosCompletos && r.desgloseIncompleto === 0);
}
{
  // ⭐ Frontera EXACTA del reloj (semiabierta, como estadoDeVentana): en `cierraEn` YA cerró.
  const q2 = q2Base({ cierraEn: AHORA, alumnas: [{ alumnoId: id("carla"), nombre: "Carla" }] });
  const r = derivarResultados(q2, q3Base(), AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("⭐ ahora === cierraEn → «No contestó» (frontera semiabierta)", r.filas[0].estado === "no_contesto");
  check("…y sin frontera futura que despierte el timer", r.fronteras.length === 0);
  const r2 = derivarResultados(q2Base({ cierraEn: AHORA + 1, alumnas: q2.alumnas }), q3Base(), AHORA);
  if (r2.estado !== "datos") throw new Error("datos");
  check("⭐ un ms antes del cierre sigue «Pendiente»", r2.filas[0].estado === "pendiente");
}
{
  // ⭐ Umbral de refuerzo ESTRICTO: 60.00 % exacto NO se marca; 59.9 % sí.
  const q3 = q3Base({
    diagnosticos: [
      intento("ana", {
        aciertosPorSeccion: [cS("s1", 3, 5)],
        aciertosPorArea: [cA("a1", 3, 5), cA("a2", 2, 5)],
      }),
    ],
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  const [alg, arit] = r.acordeon[0].areas;
  check(`⭐ ${UMBRAL_REFUERZO_AREA * 100} % EXACTO no se marca (3/5)`, alg.pct === 0.6 && !alg.reforzar);
  check("⭐ debajo del umbral se marca «REFORZAR» (2/5)", arit.pct === 0.4 && arit.reforzar);
}
{
  // ⭐ Legado sin desglose: fila «Completado» con celdas nulas + flags honestos.
  const q3 = q3Base({ legado: [legado("ana", { puntaje: 880.5, aciertosPorSeccion: undefined, aciertosPorArea: undefined })] });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("⭐ legado: Completado con puntaje redondeado y celdas «—»",
    r.filas[0].estado === "completado" && r.filas[0].puntaje === 881 && r.filas[0].porSeccion.every((c) => c === null) && r.filas[0].sinDesglose);
  check("⭐ desgloseIncompleto=1 y datosCompletos apagado", r.desgloseIncompleto === 1 && !r.datosCompletos);
  check("…pero el promedio SÍ lo cuenta (proxy del selector)", r.promedio.valor === 881);
}
{
  // ⭐ Cierre legítimo con N===0 (enviado SIN puntaje, desglose vacío como lo estampa el
  // player): fila «Completado» con «—», cuenta en participación, jamás en el promedio ni
  // en max/min — el discriminante completo (baja de la ronda 1 de auditoría de código).
  const q3 = q3Base({
    diagnosticos: [intento("ana", { puntaje: undefined, aciertosPorSeccion: [], aciertosPorArea: [] })],
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("⭐ enviado sin puntaje: fila «Completado» con puntaje null", r.filas[0].estado === "completado" && r.filas[0].puntaje === null);
  check("⭐ …cuenta como completó en X, no en el promedio", r.participacion.completaron === 1 && r.promedio.valor === null && !r.promedio.incompleto);
  check("…ni en mayor/menor puntaje", r.mayorPuntaje === null && r.menorPuntaje === null);
}
{
  // ⭐ Cubeta «Sin clasificación vigente»: área cuyo doc no resolvió.
  const q3 = q3Base({
    diagnosticos: [
      intento("ana", { aciertosPorSeccion: [cS("s1", 1, 2)], aciertosPorArea: [cA("fantasma", 1, 2)] }),
    ],
    catalogo: { ...catalogoBase, areas: [{ areaId: id("fantasma") as never, nombre: null, orden: null, seccionId: null }] },
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  const cubeta = r.acordeon[r.acordeon.length - 1];
  check("⭐ el área fantasma cae en la cubeta final (seccionId null)", cubeta.seccionId === null && cubeta.areas.length === 1 && cubeta.areas[0].nombre === null);
}
{
  // Mejor sección: desempate por pct → orden del catálogo → id; sin datos → null.
  const q3 = q3Base({
    diagnosticos: [intento("ana", { aciertosPorSeccion: [cS("s2", 3, 4), cS("s1", 3, 4)], aciertosPorArea: [] })],
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("⭐ empate de pct → gana el orden menor del catálogo", r.mejorSeccion?.nombre === "Pensamiento matemático");
  const vacio = derivarResultados(q2Base(), q3Base(), AHORA);
  if (vacio.estado !== "datos") throw new Error("datos");
  check("sin datos agregados → mejorSeccion null y max/min null", vacio.mejorSeccion === null && vacio.mayorPuntaje === null && vacio.menorPuntaje === null);
  check("sin enviados: promedio «—» (null sin incompleto)", vacio.promedio.valor === null && !vacio.promedio.incompleto);
}
{
  // Columnas: secciones agregadas FUERA de la estructura declarada van después, por orden.
  const q3 = q3Base({
    ordenSecciones: [id("s2") as never],
    diagnosticos: [intento("ana", { aciertosPorSeccion: [cS("s1", 1, 1)], aciertosPorArea: [] })],
  });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("⭐ declaradas primero, agregadas después", r.columnas.map((c) => c.nombre).join("|") === "Comprensión lectora|Pensamiento matemático");
  // Sin estructura declarada (examen borrado): orden del catálogo, jamás se inventa.
  const q3b = q3Base({ ordenSecciones: null, diagnosticos: q3.diagnosticos });
  const rb = derivarResultados(q2Base(), q3b, AHORA);
  if (rb.estado !== "datos") throw new Error("datos");
  check("ordenSecciones null → columnas por el catálogo", rb.columnas[0].nombre === "Pensamiento matemático");
}
{
  // Participación en la frontera del 60 %: 2 de 3 (66 %) verde; roster vacío naranja.
  const q3 = q3Base({ diagnosticos: [intento("ana"), intento("beto")] });
  const r = derivarResultados(q2Base(), q3, AHORA);
  if (r.estado !== "datos") throw new Error("datos");
  check("participación ≥60 % → tono verde", r.participacion.tono === "green" && r.participacion.completaron === 2);
  const sinRoster = derivarResultados(q2Base({ alumnas: [] }), q3, AHORA);
  if (sinRoster.estado !== "datos") throw new Error("datos");
  check("roster vacío: 0 de 0 en naranja, sin dividir entre cero", sinRoster.participacion.total === 0 && sinRoster.participacion.tono === "orange");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("9 · FASE B — metricas.ts migrado: fueAplicada, contarAplicadasMes, ultimosAplicados");
// ─────────────────────────────────────────────────────────────────────────────
{
  // ⭐ La regla nueva: existencia del read-model, jamás el valor.
  check("⭐ fueAplicada: campo presente → aplicada", fueAplicada({ envioRegistradoEn: 123 }));
  check("⭐ fueAplicada: campo ausente → NO aplicada (abierta sin envíos ≠ aplicada)", !fueAplicada({}));
}
{
  // ⭐ Invariante CUANTIFICADO (Media 2 del plan): ∀t ≥ envioRegistradoEn, la ventana ya
  // no es «programada» — y NO es implicación universal sobre t (antes de abrir SÍ era
  // programada aunque hoy exista envío).
  const abreEn = AHORA;
  const cierraEn = AHORA + DIA;
  const envio = AHORA + HORA; // ≥ abreEn, como garantiza la guarda de iniciarIntento
  const trasEnvio = [envio, envio + 1, cierraEn, cierraEn + DIA].every(
    (t) => estadoDeVentana(abreEn, cierraEn, t) !== "programada",
  );
  check("⭐ ∀t ≥ envioRegistradoEn: la ventana no es «programada»", trasEnvio);
  check(
    "…y ANTES de abrir sí lo era (la implicación no es universal sobre t)",
    estadoDeVentana(abreEn, cierraEn, abreEn - 1) === "programada",
  );
}
{
  // ⭐ contarAplicadasMes — frontera EXACTA del centinela 200/201.
  const fila = (aplicada: boolean) => (aplicada ? { envioRegistradoEn: 1 } : {});
  const en200 = Array.from({ length: MAX_APLICADAS_MES_PANEL }, (_, i) => fila(i % 2 === 0));
  const r200 = contarAplicadasMes(en200);
  check(`⭐ ${MAX_APLICADAS_MES_PANEL} filas: cuenta (100 aplicadas) sin flag`, r200.valor === 100 && !r200.incompleto);
  const r201 = contarAplicadasMes([...en200, fila(true)]);
  check("⭐ 201 filas (centinela lleno): {null, incompleto} — JAMÁS el prefijo", r201.valor === null && r201.incompleto);
  const rVacia = contarAplicadasMes([]);
  check("mes sin filas: 0 honesto, sin flag", rVacia.valor === 0 && !rVacia.incompleto);
}
{
  // ⭐ ultimosAplicados — la ventana de escaneo dice la verdad.
  const filaN = (aplicada: boolean, n: number) =>
    aplicada ? { envioRegistradoEn: n } : {};
  // 30 escaneadas, solo 3 aplicadas → incompleto (puede haber más antiguas sin ver).
  const treintaCon3 = Array.from({ length: SCAN_ULTIMOS_PANEL }, (_, i) => filaN(i < 3, i));
  const r30 = ultimosAplicados(treintaCon3);
  check("⭐ ventana llena (30) con <5 aplicadas → incompleto", r30.filas.length === 3 && r30.incompleto);
  // 29 escaneadas con 3 aplicadas → el historial entero ya fue visto: completo.
  const r29 = ultimosAplicados(treintaCon3.slice(0, SCAN_ULTIMOS_PANEL - 1));
  check("⭐ ventana NO llena (29) con <5 → completo (de verdad no hay más)", r29.filas.length === 3 && !r29.incompleto);
  // 30 escaneadas con ≥5 aplicadas → los 5 primeros en el orden dado, completo.
  const muchas = Array.from({ length: SCAN_ULTIMOS_PANEL }, (_, i) => filaN(true, i));
  const rMuchas = ultimosAplicados(muchas);
  check(
    "con ≥5 aplicadas: los 5 PRIMEROS del orden del índice, sin flag",
    rMuchas.filas.length === ULTIMOS_PANEL &&
      rMuchas.filas[0].envioRegistradoEn === 0 &&
      !rMuchas.incompleto,
  );
  check("cero escaneadas: vacío y completo", ultimosAplicados([]).filas.length === 0 && !ultimosAplicados([]).incompleto);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
