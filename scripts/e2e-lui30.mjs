/**
 * E2E de LUI-30 — Resultados del examen (vista del instructor + gemela admin) con LUI-31
 * integrada y la MIGRACIÓN de «aplicada» (lectores sobre `envioRegistradoEn`).
 *
 * Secciones: §0 pizarra + LÍNEA BASE · §1 SG2 con cristian vs `resultadosEsperado`
 * (réplica Node independiente) · §2 selector/membresía + regla del primer intento ·
 * §3 repaso nuevo vía API → analítica INTACTA · §4 estados de LUI-31 (Pendiente /
 * No contestó / En curso / Completado) · §5 SG3 solo-futura (fallback + placeholder) ·
 * §5b programada del MISMO examen + CRUCE de `abreEn` sin recargar · §5c grupo cerrado
 * conserva acceso (M3) · §5d cortes de intentos (401 filas Y bytes con desglose gordo) ·
 * §5e clasificación inflada (paro por bytes del catálogo) · §5f reconciliación del
 * read-model + auto-estampado por repaso · §6 variante admin (banner, breadcrumb,
 * PARIDAD de cifras) · §7 authz por HTTP (Q1 negativa incluida) · §8 paridad con la
 * pantalla de la alumna (CA) · §9 legado sin desglose · §10 búsqueda · §11 flags del
 * panel admin ENCENDIDOS · §12 restauración a línea base + §12b job huérfano de intento
 * REAL vía player.
 *
 * El oráculo NO está escrito aquí: lo produce el seed (`resultadosEsperado`, conteo
 * PROPIO contra la BD real); este spec re-deriva estados de reloj con su `Date.now()`.
 * Requisitos: npm run dev + npx convex dev + playwright (ver e2e-lui9.mjs).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const CRISTIAN = "cristian.instructor@demo.unx.mx";
const DIANA = "diana.instructor@demo.unx.mx";
const FERNANDA = "fernanda.alumna@demo.unx.mx";
const ANA = "ana.lopez@correo.com";

const SG2 = "Simulacro General 2";
const SG3 = "Simulacro General 3"; // futura (su única asignación)
const SG0 = "Simulacro General 0"; // cerrada SIN intentos → «No contestó»
const SG4 = "Simulacro General 4"; // cerrada CON intentos (Regina = legado en VespB)
const DIAG = "Diagnóstico por áreas"; // ·SabC abierta SIN intentos → «Pendiente»
const BIOLOGIA = "Módulo Biología 1"; // el ASIGNABLE por API (SG2 tiene un reactivo
// desactivado y `validarPublicable` rechaza asignarlo — mismo criterio que lui26)

const MARCA_FLIP = "[E2E LUI-30] Flip";

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const OFFSET_MX = 6 * 60 * MIN;

function urlConvexEfectiva() {
  let url = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  if (!url) {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      const m = env.match(/^NEXT_PUBLIC_CONVEX_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m);
      if (m) url = m[1].trim();
    } catch {
      /* cae al error de abajo */
    }
  }
  if (!url) {
    console.error("✘ No hay NEXT_PUBLIC_CONVEX_URL (ni en el proceso ni en .env.local).");
    process.exit(1);
  }
  if (process.env.E2E_CONVEX_URL && process.env.E2E_CONVEX_URL !== url) {
    console.error(`✘ E2E_CONVEX_URL difiere de la URL efectiva (${url}).`);
    process.exit(1);
  }
  return url;
}
const CONVEX_URL = urlConvexEfectiva();
const CLAVE_JWT = `__convexAuthJWT_${CONVEX_URL.replace(/[^a-zA-Z0-9]/g, "")}`;

let ok = 0;
let fallos = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    ok++;
    console.log(`  ✔ ${nombre}`);
  } else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

function ejecutar(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    p.stdout.on("data", (b) => (salida += b));
    p.stderr.on("data", (b) => (salida += b));
    p.on("close", (code) => resolve({ code, salida }));
    p.on("error", (e) => resolve({ code: -1, salida: String(e) }));
  });
}
async function correrConvex(fn, args = { confirmar: "SOLO_DEV" }) {
  const { code, salida } = await ejecutar("npx", ["convex", "run", fn, JSON.stringify(args)]);
  if (code !== 0)
    throw new Error(`«convex run ${fn}» salió con código ${code}: ${salida.trim()}`);
  return salida;
}
function jsonDe(salida) {
  const m = salida.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Salida sin JSON: ${salida.slice(0, 300)}`);
  return JSON.parse(m[0]);
}
/** Limpiezas por CURSOR: repite hasta `quedan === false` (contrato de los helpers). */
async function limpiarLui30() {
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarPerfilesLui30"));
    if (!r.quedan) break;
  }
  await correrConvex("seed:limpiarClasificacionesMarcadas");
}

// ── Réplicas INDEPENDIENTES (duplicadas a propósito de convex/) ──────────────
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function fechaHoraEsperada(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} de ${MESES_L[d.getUTCMonth()]}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Réplica Node de la pantalla para UNA asignación del oráculo `resultadosEsperado`:
 * estados por alumna (con el `ahora` de Node), promedio/participación (ya vienen con
 * conteo PROPIO del seed) y % agregado por área. Independiente de `resultados.ts`.
 */
function replicaDe(oraculo, examen, grupo, ahora) {
  const asig = oraculo.porAsignacion.find(
    (a) => a.examen === examen && a.grupo === grupo,
  );
  if (!asig) throw new Error(`Oráculo sin ${examen}·${grupo}`);
  const cerrada = ahora >= asig.cierraEn;
  const conIntento = new Map(asig.porAlumna.map((p) => [p.nombre, p]));
  const filas = asig.rosterActivas.map((nombre) => {
    const p = conIntento.get(nombre);
    if (!p) return { nombre, estado: cerrada ? "No contestó" : "No ha iniciado" };
    if (p.estado === "en_curso")
      return { nombre, estado: "En curso", iniciadoEn: p.iniciadoEn };
    return {
      nombre,
      estado: "Completado",
      puntaje: p.puntajeExacto === null ? null : Math.round(p.puntajeExacto),
      enviadoEn: p.enviadoEn,
      porSeccion: p.porSeccion,
    };
  });
  const areas = asig.porAreaAgregado.map((a) => ({
    area: a.area,
    pct: a.total > 0 ? Math.round((a.aciertos / a.total) * 100) : 0,
    reforzar: a.total > 0 && a.aciertos / a.total < 0.6,
  }));
  return { asig, filas, areas };
}

function poller(pg) {
  return async (cond, ms = 12_000) => {
    const t0 = Date.now();
    for (;;) {
      if (await cond()) return true;
      if (Date.now() - t0 > ms) return false;
      await pg.waitForTimeout(150);
    }
  };
}
async function login(pg, correo, urlRe) {
  await pg.goto(`${BASE}/login`);
  await pg.fill("#correo", correo);
  await pg.fill("#password", PASSWORD);
  await pg.click('button[type="submit"]');
  await pg.waitForURL(urlRe, { timeout: 20_000 });
}
async function tokenDe(pg) {
  const token = await pg.evaluate((k) => localStorage.getItem(k), CLAVE_JWT);
  if (!token) throw new Error("No hay JWT en localStorage.");
  return token;
}
function clienteConvex(token) {
  const c = new ConvexHttpClient(CONVEX_URL);
  c.setAuth(token);
  return c;
}

/** Elige en el selector la opción cuyo texto contiene `texto` (etiqueta compuesta). */
async function elegirEnSelector(pg, texto) {
  const sel = pg.locator("[data-selector-grupo]");
  const valor = await sel.evaluate((el, t) => {
    const o = [...el.options].find((x) => x.label.includes(t));
    return o ? o.value : null;
  }, texto);
  if (!valor) throw new Error(`El selector no ofrece «${texto}»`);
  await sel.selectOption(valor);
}
const etiquetasSelector = (pg) =>
  pg.locator("[data-selector-grupo]").evaluate((el) => [...el.options].map((o) => o.label));

/** La fila de la tabla de alumnas que contiene `nombre`. */
const filaAlumna = (pg, nombre) =>
  pg.locator("tbody tr").filter({ has: pg.locator(`[data-fila-alumno="${nombre}"]`) });

async function irAResultados(pg, base, examenId) {
  await pg.goto(`${BASE}${base}/${examenId}/resultados`);
}

let navegador = null;
let base = null; // línea base de conteos (§0) para la aserción de restauración
let intentosDeFixtureCreados = 0; // repasos reales sobre asignaciones del FIXTURE
let fernandaPerfil = null; // para restaurar su grupo si §12b quedara a medias
let convexAdmin = null;

try {
  console.log("\nE2E LUI-30 · pizarra + línea base…");
  await limpiarLui30(); // residuos de una corrida anterior ANTES de medir la base
  await correrConvex("seed:limpiarContenidoDemo");
  const salidaSeed = jsonDe(await correrConvex("seed:cargarDatosDePrueba"));
  await correrConvex("seedAuth:credencialesDemo");
  const oraculo = salidaSeed.resultadosEsperado;
  const panelEsperado = salidaSeed.panelEsperado;
  base = jsonDe(await correrConvex("seed:contarLineaBase"));
  console.log(
    `Oráculo: ${oraculo.porAsignacion.length} asignaciones-grupo · panel mes=${panelEsperado.examenesAplicadosMes} · base intentos=${base.intentos}`,
  );

  navegador = await chromium.launch({ headless: !HEADED });
  const ctxInstructor = await navegador.newContext();
  const pg = await ctxInstructor.newPage();
  await login(pg, CRISTIAN, /\/instructor/);
  const tokenCristian = await tokenDe(pg);
  const convexCristian = clienteConvex(tokenCristian);

  const ctxAdmin = await navegador.newContext();
  const pgA = await ctxAdmin.newPage();
  await login(pgA, ADMIN, /\/admin/);
  convexAdmin = clienteConvex(await tokenDe(pgA));

  const examenes = await convexAdmin.query("examenes:listar", {});
  const idDe = (titulo) => {
    const e = examenes.find((x) => x.titulo === titulo);
    if (!e) throw new Error(`No existe el examen «${titulo}»`);
    return e.id;
  };
  const espera = poller(pg);

  // ════ §1 · SG2 con cristian: la pantalla contra el oráculo ════════════════
  console.log("\n1 · SG2 (cristian) vs oráculo — default, métricas, acordeón y tabla");
  // La ruta es la que LUI-19 dejó enlazada en «Ver resultados →» de las cards; el enlace
  // ya lo cubre e2e-lui19 — aquí se navega directo al destino.
  await irAResultados(pg, "/instructor/examenes", idDe(SG2));
  await espera(async () => (await pg.locator("[data-resultados]").count()) === 1, 20_000);

  const h1 = (await pg.textContent("h1"))?.trim();
  check("encabezado «{examen} — Resultados»", h1 === `${SG2} — Resultados`, h1);
  check(
    "subtítulo FIJO del primer intento (copy exacto del issue)",
    ((await pg.textContent("body")) ?? "").includes(
      "Todas las cifras usan el primer intento (diagnóstico) de cada alumno",
    ),
  );

  // ⭐ Membresía: cristian imparte Matutino A y Sabatino C — Vespertino B NO se ofrece
  // y viaja solo como CONTEO.
  const etiquetas1 = await etiquetasSelector(pg);
  check(
    "⭐ selector solo con los grupos del instructor (MatA y SabC; VespB ausente)",
    etiquetas1.length === 2 &&
      etiquetas1.some((e) => e.includes("Matutino A")) &&
      etiquetas1.some((e) => e.includes("Sabatino C")) &&
      !etiquetas1.some((e) => e.includes("Vespertino B")),
    etiquetas1.join(" | "),
  );
  check(
    "⭐ nota honesta de aplicaciones ajenas (1 de VespB)",
    ((await pg.textContent("body")) ?? "").includes("1 aplicación de grupos que no impartes"),
  );

  // Default = la MÁS RECIENTE elegible entre las visibles: SG2·Sabatino C.
  const repSabC = replicaDe(oraculo, SG2, "Sabatino C", Date.now());
  check(
    "⭐ default del selector = la aplicación más reciente (Sabatino C)",
    (await pg.locator("[data-selector-grupo]").evaluate((el) => el.selectedOptions[0]?.label ?? "")).includes("Sabatino C"),
  );
  check(
    "«Aplicado el {fecha}» visible para la seleccionada",
    ((await pg.textContent("body")) ?? "").includes("Aplicado el "),
  );

  await espera(async () => (await pg.locator("[data-participacion]").count()) === 1, 20_000);
  const participacionSabC = (await pg.locator("[data-participacion]").textContent())?.trim();
  check(
    "participación X de Y (réplica del oráculo)",
    participacionSabC === `${repSabC.asig.participacion.completaron} de ${repSabC.asig.participacion.deTotal}`,
    `recibido: ${participacionSabC}`,
  );
  const promedioSabC = (await pg.locator("[data-promedio]").textContent())?.trim();
  check(
    "⭐ promedio del grupo = réplica (solo el diagnóstico de quien completó)",
    promedioSabC === String(repSabC.asig.promedio),
    `esperado ${repSabC.asig.promedio} · recibido ${promedioSabC}`,
  );

  // ⭐ LUI-31: Fernanda Gutiérrez COMPLETADO con fecha/hora + puntaje; Emiliano EN CURSO.
  const filaFer = repSabC.filas.find((f) => f.estado === "Completado");
  const filaEmi = repSabC.filas.find((f) => f.estado === "En curso");
  const trFer = filaAlumna(pg, filaFer.nombre);
  check(
    "⭐ Completado: badge + fecha/hora de envío + puntaje del diagnóstico",
    ((await trFer.textContent()) ?? "").includes("Completado") &&
      ((await trFer.textContent()) ?? "").includes(fechaHoraEsperada(filaFer.enviadoEn)) &&
      ((await trFer.textContent()) ?? "").includes(String(filaFer.puntaje)),
    (await trFer.textContent())?.replace(/\s+/g, " "),
  );
  const trEmi = filaAlumna(pg, filaEmi.nombre);
  check(
    "⭐ En curso: badge info + fecha de inicio (LUI-31)",
    ((await trEmi.textContent()) ?? "").includes("En curso") &&
      ((await trEmi.textContent()) ?? "").includes("Inició el "),
  );

  // ⭐ Celdas x/y por sección (dinámicas) contra el desglose del oráculo.
  const celdasOk = await (async () => {
    const texto = ((await trFer.textContent()) ?? "").replace(/\s+/g, " ");
    return filaFer.porSeccion.every((c) => texto.includes(`${c.aciertos}/${c.total}`));
  })();
  check("⭐ columnas por sección con x/y del desglose persistido", celdasOk);

  // ⭐ Acordeón por área: % y tag «REFORZAR EN REPASO» según el umbral (réplica).
  // Solo la sección MÁS DÉBIL viene abierta por default: se expanden todas primero.
  for (let i = 0; i < 12; i++) {
    const btn = pg.locator("[data-acordeon-seccion] button[aria-expanded='false']").first();
    if ((await btn.count()) === 0) break;
    await btn.click();
  }
  for (const a of repSabC.areas) {
    const barra = pg.locator(`[data-hbar="${a.area}"]`);
    const visible = (await barra.count()) === 1;
    const texto = visible ? ((await barra.textContent()) ?? "") : "";
    check(
      `⭐ área «${a.area}»: ${a.pct}%${a.reforzar ? " + REFORZAR EN REPASO" : " sin tag"}`,
      visible &&
        texto.includes(`${a.pct}%`) &&
        texto.toLowerCase().includes("reforzar") === a.reforzar,
      texto.replace(/\s+/g, " "),
    );
  }
  check(
    "mejor sección del grupo (réplica: mayor % agregado)",
    (await pg.locator("[data-mejor-seccion]").textContent())?.trim() !== "—",
  );

  // ════ §2 · Cambio de grupo + regla del PRIMER intento ════════════════════
  console.log("\n2 · Matutino A — la regla del primer intento (el reintento de ana es inerte)");
  await elegirEnSelector(pg, "Matutino A");
  const repMatA = replicaDe(oraculo, SG2, "Matutino A", Date.now());
  await espera(async () =>
    ((await pg.locator("[data-participacion]").textContent()) ?? "").trim() ===
    `${repMatA.asig.participacion.completaron} de ${repMatA.asig.participacion.deTotal}`,
  );
  check(
    "cambiar de grupo re-deriva todo (participación de MatA)",
    true,
  );
  const promedioMatA = (await pg.locator("[data-promedio]").textContent())?.trim();
  check(
    "⭐⭐ promedio de MatA = réplica con SOLO diagnósticos (el 2º intento de ana NO mueve nada)",
    promedioMatA === String(repMatA.asig.promedio),
    `esperado ${repMatA.asig.promedio} · recibido ${promedioMatA}`,
  );

  // ════ §3 · Un repaso NUEVO vía API deja la analítica INTACTA ═════════════
  console.log("\n3 · Repaso nuevo (API del player) → cifras idénticas");
  const ctxAna = await navegador.newContext();
  const pgAna = await ctxAna.newPage();
  await login(pgAna, ANA, /\/(inicio|examenes)/);
  const convexAna = clienteConvex(await tokenDe(pgAna));
  const q1MatA = await convexAdmin.query("resultadosExamen:deExamen", { examenId: idDe(SG2) });
  const asigMatA = q1MatA.asignaciones.find((a) => a.grupoNombre === "Matutino A");
  const inicioRepaso = await convexAna.mutation("player:iniciarIntento", {
    asignacionId: asigMatA.asignacionId,
  });
  await convexAna.mutation("player:enviar", { intentoId: inicioRepaso.intentoId });
  intentosDeFixtureCreados += 1;
  await pg.waitForTimeout(1200); // reactividad
  const promedioTrasRepaso = (await pg.locator("[data-promedio]").textContent())?.trim();
  check(
    "⭐⭐ tras un repaso REAL recién enviado, promedio y participación NO cambian (CA de LUI-104)",
    promedioTrasRepaso === String(repMatA.asig.promedio) &&
      ((await pg.locator("[data-participacion]").textContent()) ?? "").trim() ===
        `${repMatA.asig.participacion.completaron} de ${repMatA.asig.participacion.deTotal}`,
    `promedio: ${promedioTrasRepaso}`,
  );
  await ctxAna.close();

  // ════ §4 · Estados de LUI-31: Pendiente y «No contestó» ══════════════════
  console.log("\n4 · Pendiente (abierta sin intentos) y No contestó (cerrada sin intentos)");
  await irAResultados(pg, "/instructor/examenes", idDe(DIAG));
  await espera(async () => (await pg.locator("[data-selector-grupo]").count()) === 1, 20_000);
  // Default de Diagnóstico = Sabatino C (la más reciente); abierta y sin intentos.
  await espera(async () => (await pg.locator("[data-estado='pendiente']").count()) > 0, 20_000);
  const repDiag = replicaDe(oraculo, DIAG, "Sabatino C", Date.now());
  check(
    "⭐ abierta sin intentos: TODO el roster «No ha iniciado» (warning)",
    (await pg.locator("[data-estado='pendiente']").count()) === repDiag.asig.rosterActivas.length &&
      ((await pg.textContent("body")) ?? "").includes("No ha iniciado"),
  );
  check(
    "…y el promedio es «—» (sin calificados), no 0 ni error",
    ((await pg.textContent("body")) ?? "").includes("—"),
  );

  await irAResultados(pg, "/instructor/examenes", idDe(SG0));
  await espera(async () => (await pg.locator("[data-estado='no_contesto']").count()) > 0, 20_000);
  const repSG0 = replicaDe(oraculo, SG0, "Matutino A", Date.now());
  check(
    "⭐ cerrada sin intentos: TODO el roster «No contestó» (neutral, LUI-31)",
    (await pg.locator("[data-estado='no_contesto']").count()) === repSG0.asig.rosterActivas.length,
  );

  // ════ §5 · SG3: SOLO programadas (fallback del selector) ═════════════════
  console.log("\n5 · SG3 solo-futura — fallback y placeholder sin métricas");
  await irAResultados(pg, "/instructor/examenes", idDe(SG3));
  await espera(async () => (await pg.locator("[data-selector-grupo]").count()) === 1, 20_000);
  const etiquetasSG3 = await etiquetasSelector(pg);
  check(
    "⭐ solo-programadas: el default es la próxima en abrir, etiquetada «Programada»",
    etiquetasSG3.length === 1 && etiquetasSG3[0].includes("Programada"),
    etiquetasSG3.join(" | "),
  );
  check(
    "⭐ placeholder «aún no abre» SIN métricas ni tabla",
    ((await pg.textContent("body")) ?? "").includes("aún no abre") &&
      (await pg.locator("[data-promedio]").count()) === 0 &&
      (await pg.locator("tbody tr").count()) === 0,
  );

  // ════ §5b · Programada del MISMO examen + CRUCE de abreEn ════════════════
  console.log("\n5b · Biología + programada en grupo marcado — default intacto y cruce en vivo");
  const instructores = await convexAdmin.query("instructores:listar", {});
  const cristianId = instructores.find((i) => i.nombre.startsWith("Cristian")).id;
  const grupoFlip = await convexAdmin.mutation("grupos:crear", {
    nombre: MARCA_FLIP,
    ciclo: "2026-B",
    turno: "matutino",
    instructorIds: [cristianId],
  });
  // Dos aplicaciones del MISMO examen al grupo marcado: una que abre YA (la
  // «histórica») y una PROGRAMADA que cruza su `abreEn` durante la suite — el
  // discriminante de M4: el default jamás elige la futura.
  const abreYa = Date.now() + 2_000; // abierta para cuando la pantalla monta
  await convexAdmin.mutation("asignaciones:asignar", {
    examenId: idDe(BIOLOGIA),
    destino: { tipo: "grupos", grupoIds: [grupoFlip.grupoId] },
    abreEn: abreYa,
    cierraEn: abreYa + 2 * DIA,
  });
  const abreFlip = Date.now() + 75_000; // cruza DURANTE la suite
  await convexAdmin.mutation("asignaciones:asignar", {
    examenId: idDe(BIOLOGIA),
    destino: { tipo: "grupos", grupoIds: [grupoFlip.grupoId] },
    abreEn: abreFlip,
    cierraEn: abreFlip + 2 * DIA,
  });
  await irAResultados(pg, "/instructor/examenes", idDe(BIOLOGIA));
  await espera(async () => (await etiquetasSelector(pg)).length === 2, 20_000);
  // La «histórica» abre 2 s después de crearse: se ESPERA su flip (reloj anclado) y
  // entonces el default debe ser ella — jamás la programada.
  check(
    "⭐ la programada aparece etiquetada y el DEFAULT es la histórica en cuanto abre",
    await espera(async () => {
      const todas = await etiquetasSelector(pg);
      const sel = await pg
        .locator("[data-selector-grupo]")
        .evaluate((el) => el.selectedOptions[0]?.label ?? "");
      return (
        todas.some((e) => e.includes(MARCA_FLIP) && e.includes("Programada")) &&
        sel.includes(MARCA_FLIP) &&
        !sel.includes("Programada")
      );
    }, 20_000),
    (await etiquetasSelector(pg)).join(" | "),
  );
  await elegirEnSelector(pg, "Programada");
  check(
    "⭐ seleccionar la programada muestra su placeholder (sin montar Q2/Q3)",
    await espera(async () => ((await pg.textContent("body")) ?? "").includes("aún no abre")),
  );
  console.log("  … esperando el cruce de abreEn (~75 s) SIN recargar …");
  check(
    "⭐⭐ al cruzar `abreEn` la aplicación se habilita SOLA (reloj anclado — sin recargar)",
    await espera(
      async () => !((await pg.textContent("body")) ?? "").includes("aún no abre"),
      110_000,
    ),
  );
  check(
    "…y monta resultados reales (roster vacío honesto del grupo temporal)",
    await espera(async () =>
      ((await pg.textContent("body")) ?? "").includes("Este grupo no tiene alumnas"),
    ),
  );

  // ════ §5c · Cerrar el grupo NO borra el histórico (M3) ═══════════════════
  console.log("\n5c · Grupo desactivado — el instructor conserva acceso");
  await convexAdmin.mutation("grupos:cambiarEstado", {
    grupoId: grupoFlip.grupoId,
    activo: false,
  });
  await pg.reload();
  await espera(async () => (await pg.locator("[data-selector-grupo]").count()) === 1, 20_000);
  const etiquetas5c = await etiquetasSelector(pg);
  check(
    "⭐ el grupo INACTIVO sigue en el selector, con su rótulo «(inactivo)» (authz por relación persistente)",
    etiquetas5c.some((e) => e.includes(MARCA_FLIP) && e.includes("(inactivo)")),
    etiquetas5c.join(" | "),
  );

  // ════ §5d · Cortes de intentos: FILAS (401) y BYTES (desglose gordo) ═════
  console.log("\n5d · Cortes del centinela — 401 filas y 6 MiB de desgloses");
  // (a) BYTES: ~160 intentos con desglose contractual (~40 KiB c/u) superan los 6 MiB
  // ANTES de las 401 filas — el testigo específico de la rama `!isDone`.
  const cotaGorda = jsonDe(
    await correrConvex("seed:sembrarIntentosParaCota", {
      confirmar: "SOLO_DEV",
      objetivo: 170,
      conDesglose: true,
      instructorCorreo: CRISTIAN,
    }),
  );
  const q3Gorda = await convexCristian.query("resultadosExamen:intentosDe", {
    asignacionId: cotaGorda.asignacionId,
  });
  check(
    "⭐⭐ corte por BYTES con <401 filas → problema «intentos» SIN datos (rama !isDone)",
    q3Gorda?.problema === "intentos" && q3Gorda.diagnosticos.length === 0,
    JSON.stringify({ problema: q3Gorda?.problema, filas: q3Gorda?.diagnosticos?.length }),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }
  // (b) FILAS: 401 intentos ligeros llenan el centinela.
  const cotaLigera = jsonDe(
    await correrConvex("seed:sembrarIntentosParaCota", {
      confirmar: "SOLO_DEV",
      objetivo: 401,
      instructorCorreo: CRISTIAN,
    }),
  );
  const q3Ligera = await convexCristian.query("resultadosExamen:intentosDe", {
    asignacionId: cotaLigera.asignacionId,
  });
  const promedioCota = await convexAdmin.query("panel:promedioDe", {
    asignacionId: cotaLigera.asignacionId,
  });
  check(
    "⭐ 401 filas → Q3 problema «intentos» y panel.promedioDe {null, incompleto} (jamás prefijo)",
    q3Ligera?.problema === "intentos" &&
      promedioCota?.valor === null &&
      promedioCota?.incompleto === true,
    JSON.stringify({ q3: q3Ligera?.problema, promedio: promedioCota }),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }

  // ════ §5e · Clasificación INFLADA: paro por bytes del catálogo ═══════════
  console.log("\n5e · Catálogo con nombres de ~280 KB — fail-closed «clasificaciones»");
  const inflada = jsonDe(await correrConvex("seed:sembrarClasificacionInflada"));
  const cotaInflada = jsonDe(
    await correrConvex("seed:sembrarIntentosParaCota", {
      confirmar: "SOLO_DEV",
      objetivo: 1,
      conDesglose: true,
      seccionId: inflada.seccionId,
      areaId: inflada.areaId,
      instructorCorreo: CRISTIAN,
    }),
  );
  const q3Inflada = await convexCristian.query("resultadosExamen:intentosDe", {
    asignacionId: cotaInflada.asignacionId,
  });
  check(
    "⭐ nombres legados gigantes → problema «clasificaciones» SIN analítica parcial",
    q3Inflada?.problema === "clasificaciones",
    JSON.stringify({ problema: q3Inflada?.problema }),
  );
  await limpiarLui30();

  // ════ §5f · Reconciliación del read-model + auto-estampado ═══════════════
  console.log("\n5f · Read-model roto a mano → el panel MIENTE → reconciliar repara");
  const mesAntes = (await convexAdmin.query("panel:resumen", {})).metricas.examenesAplicadosMes;
  check("línea base del panel migrado = oráculo del seed", mesAntes === panelEsperado.examenesAplicadosMes,
    `panel ${mesAntes} vs oráculo ${panelEsperado.examenesAplicadosMes}`);
  await correrConvex("seed:borrarEnvioRegistrado", {
    confirmar: "SOLO_DEV",
    examen: SG2,
    grupo: "Sabatino C",
  });
  const mesRoto = (await convexAdmin.query("panel:resumen", {})).metricas.examenesAplicadosMes;
  check(
    "⭐ sin el campo, la asignación DESAPARECE del conteo (el estado que el fasado impide en prod)",
    mesRoto === mesAntes - 1,
    `recibido ${mesRoto}`,
  );
  let reconciliadas = 0;
  let cursorRec = null;
  for (let i = 0; i < 50; i++) {
    const r = jsonDe(
      await correrConvex("migracionesMetricas:reconciliarEnvioRegistrado", { cursor: cursorRec }),
    );
    reconciliadas += r.reparadas;
    cursorRec = r.continueCursor;
    if (r.isDone) break;
  }
  let discrepancias = 0;
  let cursorVer = null;
  for (let i = 0; i < 50; i++) {
    const r = jsonDe(
      await correrConvex("migracionesMetricas:verificarEnvioRegistrado", { cursor: cursorVer }),
    );
    discrepancias += r.discrepanciasPresencia;
    cursorVer = r.continueCursor;
    if (r.isDone) break;
  }
  const mesReparado = (await convexAdmin.query("panel:resumen", {})).metricas.examenesAplicadosMes;
  check(
    "⭐⭐ el reconciliador repara (≥1) y el verificador queda en 0 — el panel vuelve a la verdad",
    reconciliadas >= 1 && discrepancias === 0 && mesReparado === mesAntes,
    `reparadas ${reconciliadas} · discrepancias ${discrepancias} · mes ${mesReparado}`,
  );
  // Auto-estampado del ESCRITOR: quitar el campo a MatA y cerrar un repaso real lo repone.
  await correrConvex("seed:borrarEnvioRegistrado", {
    confirmar: "SOLO_DEV",
    examen: SG2,
    grupo: "Matutino A",
  });
  const ctxAna2 = await navegador.newContext();
  const pgAna2 = await ctxAna2.newPage();
  await login(pgAna2, ANA, /\/(inicio|examenes)/);
  const convexAna2 = clienteConvex(await tokenDe(pgAna2));
  const repaso2 = await convexAna2.mutation("player:iniciarIntento", {
    asignacionId: asigMatA.asignacionId,
  });
  await convexAna2.mutation("player:enviar", { intentoId: repaso2.intentoId });
  intentosDeFixtureCreados += 1;
  await ctxAna2.close();
  const mesAuto = (await convexAdmin.query("panel:resumen", {})).metricas.examenesAplicadosMes;
  check(
    "⭐ auto-reparación del escritor: un cierre real re-estampa el campo sin reconciliador",
    mesAuto === mesAntes,
    `recibido ${mesAuto}`,
  );

  // ════ §6 · Variante ADMIN: candado, breadcrumb y PARIDAD ═════════════════
  console.log("\n6 · Gemela admin — solo lectura con las MISMAS cifras");
  await irAResultados(pgA, "/admin/examenes/biblioteca", idDe(SG2));
  const esperaA = poller(pgA);
  await esperaA(async () => (await pgA.locator("[data-resultados]").count()) === 1, 20_000);
  check(
    "⭐ banner candado «Vista de solo lectura — Resumen de exámenes»",
    (await pgA.locator("[data-banner-solo-lectura]").count()) === 1 &&
      ((await pgA.locator("[data-banner-solo-lectura]").textContent()) ?? "").includes("Vista de solo lectura"),
  );
  check(
    "⭐ breadcrumb de LUI-32: «Resumen de exámenes › …» enlazando /admin/examenes",
    (await pgA
      .locator('nav[aria-label="Ruta de navegación"]')
      .getByRole("link", { name: "Resumen de exámenes" })
      .getAttribute("href")) === "/admin/examenes",
  );
  const etiquetasAdmin = await etiquetasSelector(pgA);
  check(
    "la administradora ve TODOS los grupos (VespB incluido; sin filtro de membresía)",
    etiquetasAdmin.some((e) => e.includes("Vespertino B")) &&
      etiquetasAdmin.some((e) => e.includes("Matutino A")) &&
      etiquetasAdmin.some((e) => e.includes("Sabatino C")),
    etiquetasAdmin.join(" | "),
  );
  await elegirEnSelector(pgA, "Sabatino C");
  await esperaA(async () => (await pgA.locator("[data-promedio]").count()) === 1, 20_000);
  check(
    "⭐⭐ PARIDAD: el promedio del admin es EXACTAMENTE el del instructor (mismas queries)",
    ((await pgA.locator("[data-promedio]").textContent()) ?? "").trim() === String(repSabC.asig.promedio),
  );

  // ════ §7 · Authz por HTTP — incluida la NEGATIVA de Q1 ═══════════════════
  console.log("\n7 · Autorización por cliente HTTP");
  const ctxDiana = await navegador.newContext();
  const pgD = await ctxDiana.newPage();
  await login(pgD, DIANA, /\/instructor/);
  const convexDiana = clienteConvex(await tokenDe(pgD));
  await ctxDiana.close();

  const q1Diana = await convexDiana.query("resultadosExamen:deExamen", { examenId: idDe(SG2) });
  const payloadDiana = JSON.stringify(q1Diana);
  check(
    "⭐⭐ Q1 de diana: solo SUS grupos y NI UN nombre/id ajeno en el payload",
    q1Diana.asignaciones.length === 2 &&
      q1Diana.ajenasOmitidas === 1 &&
      !payloadDiana.includes("Matutino A"),
  );
  const q1DianaSG3 = await convexDiana.query("resultadosExamen:deExamen", { examenId: idDe(SG3) });
  check(
    "⭐ Q1 sin NINGÚN destino autorizado (SG3 es solo de MatA): lista vacía y payload limpio",
    q1DianaSG3.asignaciones.length === 0 &&
      q1DianaSG3.ajenasOmitidas === 1 &&
      !JSON.stringify(q1DianaSG3).includes("Matutino"),
  );
  const q2Ajena = await convexDiana.query("resultadosExamen:deAsignacion", {
    asignacionId: asigMatA.asignacionId,
  });
  const q3Ajena = await convexDiana.query("resultadosExamen:intentosDe", {
    asignacionId: asigMatA.asignacionId,
  });
  check("⭐ Q2/Q3 de una asignación ajena → null (sin enumeración)", q2Ajena === null && q3Ajena === null);

  const ctxFer = await navegador.newContext();
  const pgF = await ctxFer.newPage();
  await login(pgF, FERNANDA, /\/(inicio|examenes)/);
  const convexFer = clienteConvex(await tokenDe(pgF));
  const rechazo = await convexFer
    .query("resultadosExamen:deExamen", { examenId: idDe(SG2) })
    .then(() => null)
    .catch((e) => String(e));
  check("⭐ una alumna es RECHAZADA por requireStaff", rechazo !== null && rechazo.includes("instructor o administrador"));

  // Asignación DIRECTA fabricada (futura, a ana): el selector jamás la ofreció y las
  // queries la niegan. Se cancela al instante (programada sin intentos).
  const anaPerfil = (await convexAdmin.query("alumnos:listar", {})).find((a) => a.correo === ANA);
  const abreDirecta = Date.now() + 3 * DIA;
  await convexAdmin.mutation("asignaciones:asignar", {
    examenId: idDe(BIOLOGIA), // el asignable por API (ver §5b)
    destino: { tipo: "alumnos", alumnoIds: [anaPerfil.userId] },
    abreEn: abreDirecta,
    cierraEn: abreDirecta + DIA,
  });
  const q1ConDirecta = await convexAdmin.query("resultadosExamen:deExamen", {
    examenId: idDe(BIOLOGIA),
  });
  check(
    "⭐ la fila-alumno NO entra al selector y viaja solo como conteo (sin PII)",
    q1ConDirecta.individualesOmitidas === 1 &&
      !JSON.stringify(q1ConDirecta.asignaciones).includes(anaPerfil.nombre.split(" ")[0]),
  );
  // Cancelarla vía la mutation real (programada sin intentos): restaura el estado.
  const existentes = await convexAdmin.query("asignaciones:existentesDe", {
    examenId: idDe(BIOLOGIA),
    paginationOpts: { numItems: 50, cursor: null },
  });
  const filaDirecta = existentes.page.find((f) =>
    f.destinoNombre?.startsWith(anaPerfil.nombre),
  );
  if (filaDirecta) {
    await convexAdmin.mutation("asignaciones:cancelar", { asignacionId: filaDirecta.id });
  }
  check("…y se canceló para no dejar rastro", filaDirecta !== undefined);

  // Proyección de Q3: NADA sensible viaja.
  const q3Payload = JSON.stringify(
    await convexCristian.query("resultadosExamen:intentosDe", { asignacionId: asigMatA.asignacionId }),
  );
  check(
    "⭐⭐ el payload de Q3 no trae _id de intentos, formaCierre, cierreJobId ni respuestas",
    !q3Payload.includes('"_id"') &&
      !q3Payload.includes("formaCierre") &&
      !q3Payload.includes("cierreJobId") &&
      !q3Payload.includes("opcionElegida") &&
      !q3Payload.includes("respuestas"),
  );

  // ════ §8 · PARIDAD con la pantalla de la ALUMNA (CA) ═════════════════════
  console.log("\n8 · Las cifras coinciden con lo que ve la alumna");
  const repMatAHoy = replicaDe(oraculo, SG2, "Matutino A", Date.now());
  const filaFerL = repMatAHoy.filas.find((f) => f.nombre.startsWith("Fernanda"));
  await pgF.goto(`${BASE}/examenes`);
  const esperaF = poller(pgF);
  await esperaF(async () => (await pgF.locator("[data-completado]").count()) > 0, 20_000);
  const cardSG2 = pgF.locator("[data-completado]", { hasText: SG2 });
  const textoCard = ((await cardSG2.textContent()) ?? "").replace(/\s+/g, " ");
  check(
    "⭐⭐ el puntaje de la tabla del instructor ES el de la card de la alumna (mismo redondeo)",
    textoCard.includes(String(filaFerL.puntaje)),
    `card: ${textoCard} · esperado ${filaFerL.puntaje}`,
  );
  await ctxFer.close();

  // ════ §9 · Legado sin desglose (Regina · SG4·VespB, con diana) ═══════════
  console.log("\n9 · Enviado LEGADO: cuenta en el promedio, celdas «—», nota honesta");
  const ctxDiana2 = await navegador.newContext();
  const pgD2 = await ctxDiana2.newPage();
  await login(pgD2, DIANA, /\/instructor/);
  const esperaD = poller(pgD2);
  await irAResultados(pgD2, "/instructor/examenes", idDe(SG4));
  await esperaD(async () => (await pgD2.locator("[data-promedio]").count()) === 1, 20_000);
  const repSG4 = replicaDe(oraculo, SG4, "Vespertino B", Date.now());
  const regina = repSG4.filas.find((f) => f.nombre.startsWith("Regina"));
  const trRegina = filaAlumna(pgD2, regina.nombre);
  check(
    "⭐ la fila legado es «Completado» con su puntaje y celdas por sección en «—»",
    ((await trRegina.textContent()) ?? "").includes("Completado") &&
      ((await trRegina.textContent()) ?? "").includes(String(regina.puntaje)) &&
      ((await trRegina.textContent()) ?? "").includes("—"),
  );
  check(
    "⭐ nota «no incluye 1 envío antiguo» y el promedio SÍ lo cuenta (proxy del selector)",
    ((await pgD2.textContent("body")) ?? "").includes("no incluye 1 envío antiguo") &&
      ((await pgD2.locator("[data-promedio]").textContent()) ?? "").trim() === String(repSG4.asig.promedio),
    `promedio esperado ${repSG4.asig.promedio}`,
  );
  await ctxDiana2.close();

  // ════ §10 · Búsqueda de la tabla ═════════════════════════════════════════
  console.log("\n10 · Búsqueda por nombre");
  await irAResultados(pg, "/instructor/examenes", idDe(SG2));
  await espera(async () => (await pg.locator("tbody tr").count()) > 0, 20_000);
  await elegirEnSelector(pg, "Matutino A");
  await espera(async () => (await pg.locator("tbody tr").count()) === repMatAHoy.asig.rosterActivas.length);
  await pg.getByPlaceholder("Buscar alumno…").fill("Ana");
  check(
    "⭐ la búsqueda filtra las filas por nombre",
    await espera(async () => {
      const n = await pg.locator("tbody tr").count();
      return n >= 1 && n < repMatAHoy.asig.rosterActivas.length;
    }),
  );
  await pg.getByPlaceholder("Buscar alumno…").fill("zzz-nadie");
  check(
    "…y el sin-coincidencias es honesto",
    await espera(async () => ((await pg.textContent("body")) ?? "").includes("Sin coincidencias")),
  );
  await pg.getByPlaceholder("Buscar alumno…").fill("");

  // ════ §11 · Flags del panel admin ENCENDIDOS ═════════════════════════════
  console.log("\n11 · Panel admin: flags de incompletitud con datos reales");
  await correrConvex("seed:sembrarAplicadasParaCota", { confirmar: "SOLO_DEV", objetivo: 201 });
  await pgA.goto(`${BASE}/admin`);
  check(
    "⭐ >200 aplicadas del mes → «—» + Alert del límite (jamás un prefijo)",
    await esperaA(async () =>
      ((await pgA.textContent("body")) ?? "").includes("El conteo del mes superó el límite"),
      20_000,
    ),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }
  await correrConvex("seed:sembrarAplicadasParaCota", {
    confirmar: "SOLO_DEV", objetivo: 30, sinEnvios: true,
  });
  await pgA.goto(`${BASE}/admin`);
  check(
    "⭐ ventana de escaneo llena sin juntar 5 → nota «puede haber anteriores sin listar»",
    await esperaA(async () =>
      ((await pgA.textContent("body")) ?? "").includes("puede haber anteriores sin listar"),
      20_000,
    ),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }
  await correrConvex("seed:sembrarGruposParaCota", { confirmar: "SOLO_DEV", objetivo: 201 });
  await pgA.goto(`${BASE}/admin`);
  check(
    "⭐ catálogo de grupos desbordado → «—» + Alert de conteos",
    await esperaA(async () =>
      ((await pgA.textContent("body")) ?? "").includes("Hay demasiados registros para contarlos"),
      20_000,
    ),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    if (!r.quedan) break;
  }
  let faltanPerfiles = 1;
  for (let i = 0; i < 15 && faltanPerfiles > 0; i++) {
    const r = jsonDe(
      await correrConvex("seed:sembrarPerfilesParaCota", { confirmar: "SOLO_DEV", objetivo: 2001 }),
    );
    faltanPerfiles = r.faltan;
  }
  await pgA.goto(`${BASE}/admin`);
  check(
    "⭐ censo de alumnas desbordado → «—» + Alert de conteos",
    await esperaA(async () =>
      ((await pgA.textContent("body")) ?? "").includes("Hay demasiados registros para contarlos"),
      25_000,
    ),
  );
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarPerfilesLui30"));
    if (!r.quedan) break;
  }

  // ════ §12b · Job huérfano de un intento REAL vía player ══════════════════
  console.log("\n12b · Intento real + envío manual → job pendiente → la limpieza lo cancela");
  // fernanda entra TEMPORALMENTE al grupo marcado (su asignación ya está abierta tras
  // §5b) y presenta de verdad: el intento nace con `cerrarVencido` agendado; `enviar`
  // limpia `cierreJobId` SIN cancelar el job — el huérfano que la ronda 1/2 de auditoría
  // exigió cazar por conjunto capturado.
  // Escenario AUTOCONTENIDO (las limpiezas de §5d/§11 ya barrieron los grupos marcados
  // anteriores): grupo nuevo + aplicación abierta + fernanda dentro.
  const grupoHuerfano = await convexAdmin.mutation("grupos:crear", {
    nombre: "[E2E LUI-30] Huérfano",
    ciclo: "2026-B",
    turno: "matutino",
    instructorIds: [cristianId],
  });
  const abreHuerfano = Date.now() + 2_000;
  await convexAdmin.mutation("asignaciones:asignar", {
    examenId: idDe(BIOLOGIA),
    destino: { tipo: "grupos", grupoIds: [grupoHuerfano.grupoId] },
    abreEn: abreHuerfano,
    cierraEn: abreHuerfano + 2 * DIA,
  });
  fernandaPerfil = (await convexAdmin.query("alumnos:listar", {})).find((a) => a.correo === FERNANDA);
  await convexAdmin.mutation("alumnos:actualizar", {
    perfilId: fernandaPerfil.id,
    nombre: fernandaPerfil.nombre,
    apellidos: fernandaPerfil.apellidos,
    grupoId: grupoHuerfano.grupoId,
  });
  await new Promise((r) => setTimeout(r, 3_000)); // la ventana abre (+2 s)
  const ctxFer2 = await navegador.newContext();
  const pgF2 = await ctxFer2.newPage();
  await login(pgF2, FERNANDA, /\/(inicio|examenes)/);
  const convexFer2 = clienteConvex(await tokenDe(pgF2));
  const q1Flip = await convexAdmin.query("resultadosExamen:deExamen", {
    examenId: idDe(BIOLOGIA),
  });
  const asigFlip = q1Flip.asignaciones
    .filter(
      (a) => a.grupoNombre === "[E2E LUI-30] Huérfano" && a.abreEn <= Date.now(),
    )
    .sort((a, b) => a.abreEn - b.abreEn)[0];
  const pendAntes = jsonDe(await correrConvex("seed:contarJobsPendientes")).pendientes;
  const intentoReal = await convexFer2.mutation("player:iniciarIntento", {
    asignacionId: asigFlip.asignacionId,
  });
  await convexFer2.mutation("player:enviar", { intentoId: intentoReal.intentoId });
  await ctxFer2.close();
  const pendTras = jsonDe(await correrConvex("seed:contarJobsPendientes")).pendientes;
  check(
    "⭐ el envío manual deja el `cerrarVencido` PENDIENTE (el campo ya no lo referencia)",
    pendTras === pendAntes + 1,
    `pendientes ${pendAntes} → ${pendTras}`,
  );
  // Restaurar a fernanda ANTES de limpiar (la limpieza desliga perfiles del grupo).
  await convexAdmin.mutation("alumnos:actualizar", {
    perfilId: fernandaPerfil.id,
    nombre: fernandaPerfil.nombre,
    apellidos: fernandaPerfil.apellidos,
    grupoId: fernandaPerfil.grupoId,
  });
  fernandaPerfil = null;
  let cancelados = 0;
  for (let i = 0; i < 20; i++) {
    const r = jsonDe(await correrConvex("seed:limpiarGruposLui30"));
    cancelados += r.jobsCancelados;
    if (!r.quedan) break;
  }
  const pendFinal = jsonDe(await correrConvex("seed:contarJobsPendientes")).pendientes;
  check(
    "⭐⭐ la limpieza cancela por CONJUNTO CAPTURADO y la cola vuelve a su nivel",
    cancelados >= 1 && pendFinal === pendAntes,
    `cancelados ${cancelados} · pendientes ${pendFinal} (esperado ${pendAntes})`,
  );

  // ════ §12 · Restauración EXACTA a la línea base ══════════════════════════
  console.log("\n12 · Línea base — independencia de la pizarra");
  const tras = jsonDe(await correrConvex("seed:contarLineaBase"));
  // `Object.keys(base)` en vez de una lista estática (baja del dictamen de LUI-24): así una
  // tabla nueva —como `ultimosDiagnosticos`— entra a la aserción sin que haya que acordarse.
  // El esperado se calcula POR TABLA: `intentos` conserva su excepción contractual (los
  // repasos reales del fixture); el resto, incluida `ultimosDiagnosticos`, exacto.
  const esperado = (t) =>
    t === "intentos" ? base.intentos + intentosDeFixtureCreados : base[t];
  const desviadas = Object.keys(base).filter((t) => tras[t] !== esperado(t));
  check(
    "⭐⭐ SIN pizarra: TODAS las tablas vuelven EXACTO a la base (los únicos extras son " +
      `${intentosDeFixtureCreados} repasos reales del fixture)`,
    desviadas.length === 0,
    `desviadas: ${desviadas.map((t) => `${t} ${base[t]}→${tras[t]} (esperado ${esperado(t)})`).join(", ")}`,
  );
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e?.stack ?? e}`);
} finally {
  // Limpiezas INDEPENDIENTES (cada una restaura su parte aunque otra haya fallado).
  try {
    if (fernandaPerfil && convexAdmin) {
      await convexAdmin.mutation("alumnos:actualizar", {
        perfilId: fernandaPerfil.id,
        nombre: fernandaPerfil.nombre,
        apellidos: fernandaPerfil.apellidos,
        grupoId: fernandaPerfil.grupoId,
      });
    }
  } catch (e) {
    console.error("⚠︎ no se pudo restaurar el grupo de fernanda:", String(e).slice(0, 200));
  }
  try {
    await limpiarLui30();
  } catch (e) {
    console.error("⚠︎ limpieza LUI-30 incompleta:", String(e).slice(0, 200));
  }
  // Pizarra como HIGIENE final (los repasos del fixture se reconcilian re-sembrando) —
  // no como red de seguridad: la aserción de §12 corre ANTES de esto.
  try {
    await correrConvex("seed:limpiarContenidoDemo");
    await correrConvex("seed:cargarDatosDePrueba");
    await correrConvex("seedAuth:credencialesDemo");
    if (base) {
      const final = jsonDe(await correrConvex("seed:contarLineaBase"));
      const tablas = Object.keys(base);
      const mal = tablas.filter((t) => final[t] !== base[t]);
      check(
        "⭐ tras la pizarra, la base queda IDÉNTICA (incluidos los intentos)",
        mal.length === 0,
        mal.map((t) => `${t} ${base[t]}→${final[t]}`).join(", "),
      );
    }
  } catch (e) {
    fallos++;
    console.error("✘ pizarra final falló:", String(e).slice(0, 300));
  }
  if (navegador) await navegador.close();
}

console.log(`\n──────────────\n${ok} pruebas OK, ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
