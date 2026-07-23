/**
 * Pruebas PURAS del Resumen de exámenes aplicados (LUI-32).
 *
 * Ejercitan el código de PRODUCCIÓN de `convex/resumen.ts` (jamás réplicas): el historial
 * por grupo, la abreviatura y el agregado por sección, la regla de la celda «x/T vs %», la
 * composición de cifras de fila y la derivación de bloques/ciclos/filtros. La paridad con el
 * instructor se ancla comparando `agregadoSeccionesResumen` contra `agregarDesgloses` de
 * `convex/resultados.ts`.
 *
 * Correr:  npm run test:resumen
 */
import {
  abreviaturaDeSeccion,
  agregadoSeccionesResumen,
  celdaSeccion,
  derivarCifrasFila,
  derivarEstructura,
  filasDeGrupoResumen,
  textoAciertosPorSeccion,
  codificarCiclo,
  MAX_SECCIONES_CIFRAS,
  type FilaCrudaResumen,
  type GrupoDeCatalogo,
  type SeccionAgregadaResumen,
} from "../convex/resumen";
import {
  agregarDesgloses,
  participacionDe,
  pctDeFraccion,
  type IntentoCrudoResultados,
} from "../convex/resultados";
import { MAX_HISTORIAL_ASIGNACIONES_GRUPO } from "../convex/asignacionDestino";
import { MAX_REACTIVOS } from "../convex/constructorExamen";

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
const cc = codificarCiclo;

const fila = (
  n: string,
  over: Partial<FilaCrudaResumen> = {},
): FilaCrudaResumen => ({
  asignacionId: id(`asig-${n}`),
  examenId: id(`ex-${n}`),
  titulo: `Examen ${n}`,
  abreEn: 1000,
  envioRegistradoEn: 900,
  ...over,
});

const desglose = (
  alumno: string,
  secciones: { s: string; a: number; t: number }[],
): IntentoCrudoResultados => ({
  alumnoId: id(alumno),
  estado: "enviado",
  numeroIntento: 1,
  iniciadoEn: 100,
  enviadoEn: 200,
  puntaje: 1000,
  aciertosPorSeccion: secciones.map((x) => ({
    seccionId: id(x.s),
    aciertos: x.a,
    total: x.t,
  })),
  aciertosPorArea: secciones.map((x) => ({
    areaId: id(`area-${x.s}`),
    aciertos: x.a,
    total: x.t,
  })),
});

const grupo = (over: Partial<GrupoDeCatalogo>): GrupoDeCatalogo => ({
  grupoId: id("g"),
  nombre: "Grupo",
  ciclo: "2026-A",
  turno: "matutino",
  activo: true,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · filasDeGrupoResumen — solo aplicadas, orden y frontera 100/101");
// ─────────────────────────────────────────────────────────────────────────────
{
  const r = filasDeGrupoResumen([
    fila("a", { envioRegistradoEn: undefined }), // NO aplicada
    fila("b", { envioRegistradoEn: 5 }),
    fila("c"),
  ]);
  check("solo cuenta las aplicadas", r.filas.length === 2);
  check("excluye la no aplicada", !r.filas.some((f) => f.asignacionId === id("asig-a")));
  check("no marca incompleto con pocas filas", r.incompleto === false);
}
{
  // ⭐ Orden abreEn desc → asignacionId.
  const r = filasDeGrupoResumen([
    fila("x", { abreEn: 100, asignacionId: id("asig-x") }),
    fila("y", { abreEn: 300, asignacionId: id("asig-y") }),
    fila("z", { abreEn: 300, asignacionId: id("asig-a") }),
  ]);
  check(
    "⭐ orden abreEn desc → id (empate por id)",
    r.filas[0].asignacionId === id("asig-a") &&
      r.filas[1].asignacionId === id("asig-y") &&
      r.filas[2].asignacionId === id("asig-x"),
  );
}
{
  // ⭐ Frontera: 100 pasa, 101 corta (fail-closed).
  const cien = Array.from({ length: MAX_HISTORIAL_ASIGNACIONES_GRUPO }, (_, i) =>
    fila(String(i)),
  );
  const r100 = filasDeGrupoResumen(cien);
  check("⭐ 100 pasa (no incompleto)", r100.incompleto === false && r100.filas.length === 100);
  const r101 = filasDeGrupoResumen([...cien, fila("extra")]);
  check("⭐ 101 corta: incompleto y filas vacías (fail-closed)", r101.incompleto === true && r101.filas.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("2 · abreviaturaDeSeccion — derivada del nombre real");
// ─────────────────────────────────────────────────────────────────────────────
{
  check("⭐ «Pensamiento matemático» → PM", abreviaturaDeSeccion("Pensamiento matemático") === "PM");
  check("⭐ «Comprensión lectora» → CL", abreviaturaDeSeccion("Comprensión lectora") === "CL");
  check("⭐ «Redacción indirecta» → RI", abreviaturaDeSeccion("Redacción indirecta") === "RI");
  check("una palabra → 3 letras («Biología» → BIO)", abreviaturaDeSeccion("Biología") === "BIO");
  check("ignora stopwords («Estructura de la lengua» → EL)", abreviaturaDeSeccion("Estructura de la lengua") === "EL");
  check("máx 3 iniciales", abreviaturaDeSeccion("Uno Dos Tres Cuatro") === "UDT");
  check("mayúsculas siempre", abreviaturaDeSeccion("química orgánica") === "QO");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("3 · agregadoSeccionesResumen — elegibilidad y totalComun");
// ─────────────────────────────────────────────────────────────────────────────
{
  const sel = [
    desglose("ana", [{ s: "s1", a: 18, t: 30 }]),
    desglose("beto", [{ s: "s1", a: 22, t: 30 }]),
  ];
  const { porSeccion, sinDesglose } = agregadoSeccionesResumen(sel);
  const s1 = porSeccion.get(id("s1"))!;
  check("suma aciertos y totales", s1.sumaAciertos === 40 && s1.sumaTotales === 60);
  check("k cuenta intentos con la sección", s1.k === 2);
  check("⭐ totalComun cuando todos coinciden (30)", s1.totalComun === 30);
  check("sin desglose = 0 con ambos arreglos", sinDesglose === 0);
}
{
  // ⭐ Totales dispares → totalComun null.
  const sel = [
    desglose("ana", [{ s: "s1", a: 2, t: 3 }]),
    desglose("beto", [{ s: "s1", a: 3, t: 5 }]),
  ];
  const s1 = agregadoSeccionesResumen(sel).porSeccion.get(id("s1"))!;
  check("⭐ totalComun null cuando difieren (3 vs 5)", s1.totalComun === null);
}
{
  // ⭐ Elegibilidad idéntica a agregarDesgloses: sección presente + área ausente → excluido.
  const soloSeccion: IntentoCrudoResultados = {
    ...desglose("ana", [{ s: "s1", a: 5, t: 10 }]),
    aciertosPorArea: undefined,
  };
  const r = agregadoSeccionesResumen([soloSeccion]);
  check("⭐ sección sin área → excluida y sinDesglose+1", r.sinDesglose === 1 && r.porSeccion.size === 0);
}
{
  // ⭐ Área presente + sección ausente → excluido.
  const soloArea: IntentoCrudoResultados = {
    ...desglose("ana", [{ s: "s1", a: 5, t: 10 }]),
    aciertosPorSeccion: undefined,
  };
  const r = agregadoSeccionesResumen([soloArea]);
  check("⭐ área sin sección → excluida (sinDesglose+1)", r.sinDesglose === 1 && r.porSeccion.size === 0);
}
{
  // ⭐ Ambas presentes → incluido.
  const r = agregadoSeccionesResumen([desglose("ana", [{ s: "s1", a: 5, t: 10 }])]);
  check("⭐ ambos arreglos → incluida", r.sinDesglose === 0 && r.porSeccion.size === 1);
}
{
  // en_curso jamás cuenta (ni como sinDesglose).
  const enCurso: IntentoCrudoResultados = {
    alumnoId: id("ana"),
    estado: "en_curso",
    iniciadoEn: 100,
  };
  const r = agregadoSeccionesResumen([enCurso]);
  check("en_curso no aporta ni a sinDesglose", r.sinDesglose === 0 && r.porSeccion.size === 0);
}
{
  // ⭐ Equivalencia con agregarDesgloses (misma población, ΣA/ΣT idéntico).
  const sel = [
    desglose("ana", [{ s: "s1", a: 18, t: 30 }, { s: "s2", a: 10, t: 20 }]),
    desglose("beto", [{ s: "s1", a: 22, t: 30 }, { s: "s2", a: 15, t: 20 }]),
  ];
  const mio = agregadoSeccionesResumen(sel).porSeccion.get(id("s1"))!;
  const suyo = agregarDesgloses(sel).porSeccion.get(id("s1"))!;
  check(
    "⭐ agregadoSeccionesResumen ≡ agregarDesgloses (por sección)",
    mio.sumaAciertos === suyo.aciertos && mio.sumaTotales === suyo.total,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("4 · celdaSeccion — regla «x/T» vs «%», sin redondear el numerador");
// ─────────────────────────────────────────────────────────────────────────────
{
  // ⭐ totalComun + media entera → «PM 18/30».
  const c = celdaSeccion({
    abreviatura: "PM",
    agregado: { sumaAciertos: 36, sumaTotales: 60, k: 2, totalComun: 30 },
  });
  check("⭐ media entera con totalComun → «PM 18/30»", c === "PM 18/30");
}
{
  // ⭐ Caso del dictamen k=3, aciertos 0,0,1, total 3: instructor 1/9 = 11 %.
  const c = celdaSeccion({
    abreviatura: "PM",
    agregado: { sumaAciertos: 1, sumaTotales: 9, k: 3, totalComun: 3 },
  });
  check("⭐ k=3 (0,0,1)/3 → «PM 11%» (idéntico al instructor)", c === "PM 11%");
}
{
  // ⭐ 1/3 + 2/3 → 50 % (media 1.5 no entera).
  const c = celdaSeccion({
    abreviatura: "CL",
    agregado: { sumaAciertos: 3, sumaTotales: 6, k: 2, totalComun: 3 },
  });
  check("⭐ media fraccionaria con totalComun → «CL 50%»", c === "CL 50%");
}
{
  // ⭐ Totales dispares → porcentaje ΣA/ΣT.
  const c = celdaSeccion({
    abreviatura: "RI",
    agregado: { sumaAciertos: 5, sumaTotales: 8, k: 2, totalComun: null },
  });
  check("⭐ totales dispares → «RI 63%» (5/8)", c === `RI ${pctDeFraccion(5 / 8)}%`);
}
{
  check("k=0 → null (se omite)", celdaSeccion({ abreviatura: "X", agregado: { sumaAciertos: 0, sumaTotales: 0, k: 0, totalComun: null } }) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("5 · participacionDe + derivarCifrasFila + textoAciertosPorSeccion");
// ─────────────────────────────────────────────────────────────────────────────
{
  // ⭐ ∩ y − de conjuntos: enviadas ∩ roster = X; enviadas − roster = fuera.
  const p = participacionDe(
    [id("a"), id("b"), id("z")], // z está fuera del roster
    [id("a"), id("b"), id("c")],
  );
  check("⭐ completaron = |enviadas ∩ roster|", p.completaron === 2);
  check("deTotal = |roster|", p.deTotal === 3);
  check("⭐ fuerasDeRoster = |enviadas − roster|", p.fuerasDeRoster === 1);
}
{
  const secciones: SeccionAgregadaResumen[] = [
    { seccionId: id("s1"), nombre: "Pensamiento matemático", sumaAciertos: 36, sumaTotales: 60, k: 2, totalComun: 30 },
    { seccionId: id("s2"), nombre: null, sumaAciertos: 10, sumaTotales: 20, k: 2, totalComun: 10 },
  ];
  const t = textoAciertosPorSeccion(secciones);
  check("texto une celdas por « · »", t.seccionesTexto === "PM 18/30 · — 5/10");
  check("título con nombre completo", t.seccionesTitulo.includes("Pensamiento matemático"));
  check("sección eliminada en el título", t.seccionesTitulo.includes("Sección eliminada"));

  const fila = derivarCifrasFila(
    { secciones, sinDesglose: 1, enviadasAlumnoIds: [id("a"), id("b")] },
    { alumnoIds: [id("a"), id("b"), id("c")], deTotal: 3 },
  );
  check("⭐ derivarCifrasFila compone participación", fila.participacion.completaron === 2 && fila.participacion.deTotal === 3);
  check("derivarCifrasFila arrastra sinDesglose", fila.sinDesglose === 1);
  check("derivarCifrasFila arrastra secciones", fila.seccionesTexto === "PM 18/30 · — 5/10");
}
{
  const t = textoAciertosPorSeccion([]);
  check("sin secciones → texto vacío", t.seccionesTexto === "");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("6 · cota de secciones — frontera 240/241");
// ─────────────────────────────────────────────────────────────────────────────
{
  check("cota derivada de MAX_REACTIVOS (240)", MAX_SECCIONES_CIFRAS === MAX_REACTIVOS && MAX_SECCIONES_CIFRAS === 240);
  check("⭐ 240 NO desborda", 240 <= MAX_SECCIONES_CIFRAS);
  check("⭐ 241 desborda (fail-closed)", 241 > MAX_SECCIONES_CIFRAS);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("7 · derivarEstructura — bloques, ciclos, filtros y paginación");
// ─────────────────────────────────────────────────────────────────────────────
{
  const catalogo = {
    grupos: [
      grupo({ grupoId: id("g1"), nombre: "Matutino A", ciclo: "2026-A", turno: "matutino" }),
      grupo({ grupoId: id("g2"), nombre: "Vespertino B", ciclo: "2026-A", turno: "vespertino" }),
      grupo({ grupoId: id("g3"), nombre: "Sabatino C", ciclo: "2026-B", turno: "sabatino" }),
    ],
  };
  const e = derivarEstructura(catalogo, { cicloSel: "", grupoSel: "", paginaBloques: 1 });
  check("⭐ cicloDefault = el más reciente (2026-B)", e.cicloEfectivo === cc("2026-B"));
  check("opciones de ciclo desc", e.opcionesCiclo[0].valor === cc("2026-B") && e.opcionesCiclo[1].valor === cc("2026-A"));
  check("⭐ bloques del ciclo efectivo (solo 2026-B)", e.bloques.length === 1 && e.bloques[0].grupoId === id("g3"));
  check("título «{nombre} — Ciclo {ciclo}»", e.bloques[0].titulo === "Sabatino C — Ciclo 2026-B");
}
{
  // ⭐ Cambiar de ciclo muestra sus grupos, ordenados nombre asc.
  const catalogo = {
    grupos: [
      grupo({ grupoId: id("g2"), nombre: "Vespertino B", ciclo: "2026-A" }),
      grupo({ grupoId: id("g1"), nombre: "Matutino A", ciclo: "2026-A" }),
    ],
  };
  const e = derivarEstructura(catalogo, { cicloSel: cc("2026-A"), grupoSel: "", paginaBloques: 1 });
  check("⭐ orden de bloques nombre asc", e.bloques[0].titulo.startsWith("Matutino A") && e.bloques[1].titulo.startsWith("Vespertino B"));
}
{
  // «Sin ciclo» al final + default puede ser un ciclo con grupos vacíos.
  const catalogo = {
    grupos: [
      grupo({ grupoId: id("g1"), nombre: "A", ciclo: "2099-A" }),
      grupo({ grupoId: id("g2"), nombre: "B", ciclo: null }),
    ],
  };
  const e = derivarEstructura(catalogo, { cicloSel: "", grupoSel: "", paginaBloques: 1 });
  check("⭐ default = ciclo más reciente aunque no tenga aplicaciones (2099-A)", e.cicloEfectivo === cc("2099-A"));
  const conSinCiclo = e.opcionesCiclo.some((o) => o.valor === cc(null) && o.etiqueta === "Sin ciclo");
  check("«Sin ciclo» presente al final", conSinCiclo && e.opcionesCiclo[e.opcionesCiclo.length - 1].valor === cc(null));
}
{
  // Agrupar por grupoId, NO por etiqueta: dos grupos con mismo nombre+ciclo se DESAMBIGUAN.
  const catalogo = {
    grupos: [
      grupo({ grupoId: id("gA"), nombre: "Matutino", ciclo: "2026-A", turno: "matutino" }),
      grupo({ grupoId: id("gB"), nombre: "Matutino", ciclo: "2026-A", turno: "vespertino" }),
    ],
  };
  const e = derivarEstructura(catalogo, { cicloSel: cc("2026-A"), grupoSel: "", paginaBloques: 1 });
  check("⭐ etiquetas duplicadas se desambiguan (por turno)", e.bloques[0].titulo !== e.bloques[1].titulo);
  check("bloques separados por grupoId (no fusionados)", e.bloques.length === 2);
}
{
  // ⭐ Prueba reina: 10 inactivos vacíos ANTES de un activo → paginación NO oculta el activo.
  const grupos: GrupoDeCatalogo[] = [];
  for (let i = 0; i < 10; i++) {
    grupos.push(grupo({ grupoId: id(`inact-${i}`), nombre: `AAA-${i}`, ciclo: "2026-A", activo: false }));
  }
  grupos.push(grupo({ grupoId: id("activo"), nombre: "ZZZ activo", ciclo: "2026-A", activo: true }));
  const catalogo = { grupos };
  const p1 = derivarEstructura(catalogo, { cicloSel: cc("2026-A"), grupoSel: "", paginaBloques: 1 });
  check("⭐ página 1 muestra los 10 inactivos (NO queda vacía)", p1.bloques.length === 10);
  check("⭐ inactivos visibles marcados inactivo", p1.bloques.every((b) => b.inactivo));
  check("total de páginas = 2 (11 grupos / 10)", p1.totalPaginasBloques === 2);
  const p2 = derivarEstructura(catalogo, { cicloSel: cc("2026-A"), grupoSel: "", paginaBloques: 2 });
  check("⭐ el activo con resultados aparece en la página 2", p2.bloques.length === 1 && p2.bloques[0].grupoId === id("activo"));
}
{
  // Filtro por grupo: solo su bloque.
  const catalogo = {
    grupos: [
      grupo({ grupoId: id("g1"), nombre: "A", ciclo: "2026-A" }),
      grupo({ grupoId: id("g2"), nombre: "B", ciclo: "2026-A" }),
    ],
  };
  const e = derivarEstructura(catalogo, { cicloSel: cc("2026-A"), grupoSel: "g2", paginaBloques: 1 });
  check("filtro de grupo deja solo su bloque", e.bloques.length === 1 && e.bloques[0].grupoId === id("g2"));
}
{
  // Sin grupos → estructura vacía coherente.
  const e = derivarEstructura({ grupos: [] }, { cicloSel: "", grupoSel: "", paginaBloques: 1 });
  check("catálogo vacío → sin bloques ni opciones", e.bloques.length === 0 && e.opcionesCiclo.length === 0 && e.cicloEfectivo === "");
}
{
  // Página fuera de rango se acota.
  const grupos = Array.from({ length: 15 }, (_, i) =>
    grupo({ grupoId: id(`g${i}`), nombre: `G${String(i).padStart(2, "0")}`, ciclo: "2026-A" }),
  );
  const e = derivarEstructura({ grupos }, { cicloSel: cc("2026-A"), grupoSel: "", paginaBloques: 99 });
  check("página fuera de rango se acota a la última", e.paginaBloques === 2 && e.bloques.length === 5);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("8 · pctDeFraccion — el formateador compartido");
// ─────────────────────────────────────────────────────────────────────────────
{
  check("pctDeFraccion(0.5) = 50", pctDeFraccion(0.5) === 50);
  check("pctDeFraccion(1/9) = 11", pctDeFraccion(1 / 9) === 11);
  check("pctDeFraccion(0.605) = 61 (redondeo)", pctDeFraccion(0.605) === 61);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("9 · codificarCiclo — inyectivo y DOM-safe (fix del sentinela con NUL)");
// ─────────────────────────────────────────────────────────────────────────────
{
  const hayControl = (v: string) => [...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0xfffd);
  check("⭐ «Sin ciclo» NO usa carácter de control (DOM-safe)", !hayControl(cc(null)), JSON.stringify(cc(null)));
  check("⭐ ciclo real NO usa carácter de control", !hayControl(cc("2026-A")));
  // ⭐ El dominio COMPLETO del schema: un ciclo con U+0000 (o cualquier control) NO puede
  // producir un value con control — la codificación es TOTAL, no un prefijo (fix ronda 2).
  check("⭐⭐ ciclo con U+0000 → value SIN control (encodeURIComponent)", !hayControl(cc("\u0000A")) && cc("\u0000A") === "c%00A", JSON.stringify(cc("\u0000A")));
  check("⭐ ciclo con espacios/no-ASCII/tab → value SIN control", !hayControl(cc("2026 Ñ\t")) && !hayControl(cc("")));
  check("⭐ inyectivo: null ≠ cualquier ciclo real", cc(null) !== cc("2026-A") && cc(null) !== cc("") && cc(null) !== cc("n"));
  check("⭐ inyectivo: dos ciclos distintos → values distintos", cc("2026-A") !== cc("2026-a") && cc("\u0000A") !== cc("A"));
  const g1 = grupo({ grupoId: id("gn"), nombre: "Sin", ciclo: null });
  const g2 = grupo({ grupoId: id("gr"), nombre: "Real", ciclo: "2026-A" });
  const e = derivarEstructura({ grupos: [g1, g2] }, { cicloSel: cc(null), grupoSel: "", paginaBloques: 1 });
  check("⭐ seleccionar «Sin ciclo» (con otro ciclo presente) filtra el grupo sin ciclo", e.bloques.length === 1 && e.bloques[0].grupoId === id("gn"));
  // ⭐ Un grupo con ciclo de control es seleccionable por su value codificado (sin romper).
  const gc = grupo({ grupoId: id("gc"), nombre: "Ctrl", ciclo: "\u0000A" });
  const ec = derivarEstructura({ grupos: [gc, g2] }, { cicloSel: cc("\u0000A"), grupoSel: "", paginaBloques: 1 });
  check("⭐⭐ ciclo con U+0000 es filtrable por su value codificado", ec.bloques.length === 1 && ec.bloques[0].grupoId === id("gc"));
}
console.log("");
if (fallos === 0) console.log(`${ok} pruebas OK, 0 fallos`);
else {
  console.error(`\n${ok} OK · ${fallos} FALLOS`);
  process.exit(1);
}
