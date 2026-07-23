/**
 * E2E de LUI-32 — Resumen de exámenes aplicados (vista de la administradora). ×2 idempotente.
 *
 * Por PASADA: §0 pizarra + LÍNEA BASE (incl. temario) · §1 pantalla vs `resultadosEsperado`
 * (subtítulo, promedio, X/Y, secciones recalculadas, solo-aplicadas) · §2 paridad con el
 * instructor (X/Y Y CADA sección) · §3 legado sin desglose · §4 drill-down `?asignacion=`
 * (discriminante + selección inválida + click de fila) · §5 prueba reina de paginación · §6
 * candados de ciclo/historial · §7 filtros + ciclo default (más reciente aunque vacío) +
 * «Sin ciclo» DOM-safe · §8 vacío vs desbordado + cortes de intentos/catálogo · §9 examen
 * legado plano de 101 secciones (asignar REAL) · §10 authz de las 4 queries + fronteras de
 * `bloquesDe` + payload negativo + individuales · §12 restauración EXACTA.
 *
 * El objetivo de §1/§2/§4 se descubre por `grupoId` de un grupo con nombre ÚNICO (el dev
 * arrastra grupos de otros E2E, incluso homónimos en ciclos distintos), cruzando el oráculo
 * con lo que el instructor realmente ve.
 *
 * Requisitos: npm run dev + npx convex dev + playwright.
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
const BIOLOGIA = "Módulo Biología 1";
const cc = (ciclo) => (ciclo === null ? "n" : "c" + encodeURIComponent(ciclo)); // réplica de codificarCiclo

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
    console.error("✘ No hay NEXT_PUBLIC_CONVEX_URL.");
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
async function limpiarLui32() {
  let estado; // {faseIdx, cursor} — se propaga (paginación persistida)
  for (let i = 0; i < 400; i++) {
    const args = estado ? { confirmar: "SOLO_DEV", estado } : { confirmar: "SOLO_DEV" };
    const r = jsonDe(await correrConvex("seed:limpiarLui32", args));
    if (!r.quedan) return;
    estado = r.estado;
  }
  throw new Error("limpiarLui32 no convergió en 400 iteraciones — residuo posible; falla explícita en vez de continuar en silencio.");
}
async function limpiarLui30() {
  let ok1 = false;
  for (let i = 0; i < 60; i++) {
    if (!jsonDe(await correrConvex("seed:limpiarGruposLui30")).quedan) { ok1 = true; break; }
  }
  let ok2 = false;
  for (let i = 0; i < 60; i++) {
    if (!jsonDe(await correrConvex("seed:limpiarPerfilesLui30")).quedan) { ok2 = true; break; }
  }
  if (!ok1 || !ok2) throw new Error("limpiarLui30 no convergió — residuo posible; falla explícita.");
  await correrConvex("seed:limpiarClasificacionesMarcadas");
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

// ── Réplicas INDEPENDIENTES de convex/resumen.ts ──────────────────────────────
const STOP = new Set(["de","del","la","las","el","los","y","e","en","por","para","a","o","u","con"]);
function abrevEsperada(nombre) {
  const sig = nombre.trim().split(/\s+/).filter((p) => p && !STOP.has(p.toLocaleLowerCase("es")));
  if (sig.length === 0) return nombre.trim().slice(0, 3).toLocaleUpperCase("es");
  if (sig.length === 1) return sig[0].slice(0, 3).toLocaleUpperCase("es");
  return sig.slice(0, 3).map((p) => p.slice(0, 1).toLocaleUpperCase("es")).join("");
}
function celdaEsperada(nombre, { aciertos, total, k, totalComun }) {
  if (k === 0 || total === 0) return null;
  const a = abrevEsperada(nombre);
  const media = aciertos / k;
  if (totalComun !== null && Number.isInteger(media)) return `${a} ${media}/${totalComun}`;
  return `${a} ${Math.round((aciertos / total) * 100)}%`;
}
const pctEsperado = (aciertos, total) => Math.round((aciertos / total) * 100);
function seccionesEsperadas(asig) {
  return new Set(
    asig.porSeccionAgregado
      .map((s) => celdaEsperada(s.seccion, { aciertos: s.aciertos, total: s.total, k: s.k, totalComun: s.totalComun }))
      .filter(Boolean),
  );
}

// ── Lectura de la pantalla ────────────────────────────────────────────────────
async function elegirCicloValor(pg, valor) {
  await pg.locator("[data-filtro-ciclo]").selectOption(valor);
  await pg.waitForTimeout(400);
}
async function elegirCicloParcial(pg, parcial) {
  const sel = pg.locator("[data-filtro-ciclo]");
  const valor = await sel.evaluate((el, t) => {
    const o = [...el.options].find((x) => x.value.includes(t) || x.label.includes(t));
    return o ? o.value : null;
  }, parcial);
  if (!valor) throw new Error(`El filtro de ciclo no ofrece «${parcial}»`);
  await sel.selectOption(valor);
  await pg.waitForTimeout(400);
}
async function expandirBloque(pg, tituloParcial) {
  const bloque = pg.locator(`[data-bloque-grupo^="${tituloParcial}"]`).first();
  const abierto = await bloque.locator('button[aria-expanded="true"]').count();
  if (!abierto) await bloque.locator("button").first().click();
  await pg.waitForTimeout(400);
  return bloque;
}

async function correrPasada(navegador, oraculo, base, pasada) {
  console.log(`\n════════ PASADA ${pasada} ════════`);
  const ctxAdmin = await navegador.newContext();
  const pg = await ctxAdmin.newPage();
  await login(pg, ADMIN, /\/admin/);
  const convexAdmin = clienteConvex(await tokenDe(pg));
  const wait = poller(pg);
  const examenes = await convexAdmin.query("examenes:listar", {});
  const idDe = (t) => examenes.find((e) => e.titulo === t)?.id;

  // Catálogo real + nombres duplicados (el dev arrastra homónimos en ciclos distintos).
  const catAdmin = await convexAdmin.query("resumenExamenes:catalogo", {});
  const cicloDeId = new Map(catAdmin.grupos.map((g) => [g.grupoId, g.ciclo]));
  const vistos = new Set();
  const nombresDup = new Set();
  for (const g of catAdmin.grupos) {
    if (vistos.has(g.nombre)) nombresDup.add(g.nombre);
    vistos.add(g.nombre);
  }

  // Instructores para descubrir el objetivo (una asignación aplicada visible, grupo ÚNICO).
  const clientesInstr = [];
  for (const [nombreI, correoI] of [["cristian", CRISTIAN], ["diana", DIANA]]) {
    const ctxI = await navegador.newContext();
    const pgI = await ctxI.newPage();
    await login(pgI, correoI, /\/instructor/);
    clientesInstr.push({ nombreI, correoI, cli: clienteConvex(await tokenDe(pgI)) });
    await ctxI.close();
  }

  let obj = null;
  for (const a of oraculo) {
    if (a.porSeccionAgregado.length === 0 || a.promedio === null) continue;
    if (nombresDup.has(a.grupo)) continue; // nombre único ⇒ mapeo oráculo↔grupo inequívoco
    const examenId = idDe(a.examen);
    if (!examenId) continue;
    for (const { nombreI, correoI, cli } of clientesInstr) {
      const q1 = await cli.query("resultadosExamen:deExamen", { examenId });
      const match = q1 && q1.asignaciones && q1.asignaciones.find((x) => x.grupoNombre === a.grupo);
      if (!match) continue;
      const b = await convexAdmin.query("resumenExamenes:bloquesDe", { grupoIds: [match.grupoId] });
      const filas = b.porGrupo[match.grupoId]?.filas ?? [];
      if (!filas.some((f) => f.asignacionId === match.asignacionId)) continue;
      obj = { a, asigId: match.asignacionId, examenId, nombreI, correoI, grupoId: match.grupoId, aplicadas: filas.length };
      break;
    }
    if (obj) break;
  }
  if (!obj) throw new Error("No se halló objetivo aplicado en grupo de nombre único.");
  const cicloObj = cicloDeId.get(obj.grupoId) ?? null;
  const tituloBloqueObj = `${obj.a.grupo}${cicloObj ? ` — Ciclo ${cicloObj}` : ""}`;
  console.log(`Objetivo: ${obj.a.examen} · ${obj.a.grupo} · ciclo ${cicloObj} · ${obj.aplicadas} aplicadas · ${obj.nombreI}`);

  // ── §1 ──────────────────────────────────────────────────────────────────────
  console.log("§1 · pantalla vs oráculo");
  await pg.goto(`${BASE}/admin/examenes`);
  await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
  await elegirCicloValor(pg, cc(cicloObj));
  const bloque = await expandirBloque(pg, tituloBloqueObj);
  check("subtítulo «N simulacros aplicados»", (await bloque.locator("button").first().innerText()).includes(`${obj.aplicadas} simulacro`));
  const linkFila = bloque.locator(`[data-fila-examen="${obj.a.examen}"]`).first();
  await linkFila.waitFor({ timeout: 15_000 });
  const fila = linkFila.locator("xpath=ancestor::tr[1]");
  check("promedio de la fila == oráculo", (await fila.locator("td").nth(3).innerText()).trim() === String(obj.a.promedio));
  check("«A de B» == oráculo", (await fila.locator("[data-participacion]").innerText()).trim() === `${obj.a.participacion.completaron} de ${obj.a.participacion.deTotal}`);
  const secsVisible = fila.locator('[data-secciones] span[aria-hidden="true"]');
  const secsTxt = (await secsVisible.count()) > 0 ? (await secsVisible.innerText()).trim() : "";
  const segmentos = new Set(secsTxt.split(" · ").filter(Boolean));
  const esperado = seccionesEsperadas(obj.a);
  check("aciertos por sección == porSeccionAgregado recalculado", segmentos.size === esperado.size && [...esperado].every((s) => segmentos.has(s)), `${secsTxt} vs ${[...esperado].join(" · ")}`);
  check("la tabla lista exactamente las aplicadas", (await bloque.locator("tbody tr").count()) === obj.aplicadas);

  // ── §2 · Paridad con el instructor (X/Y Y cada sección) ─────────────────────
  console.log("§2 · paridad con el instructor");
  {
    const ctxP = await navegador.newContext();
    const pgP = await ctxP.newPage();
    await login(pgP, obj.correoI, /\/instructor/);
    await pgP.goto(`${BASE}/instructor/examenes/${obj.examenId}/resultados`);
    const waitP = poller(pgP);
    await waitP(() => pgP.locator("[data-selector-grupo]").count().then((n) => n > 0));
    await pgP.locator("[data-selector-grupo]").evaluate((el, asigId) => {
      const o = [...el.options].find((x) => x.value === asigId);
      if (o) el.value = o.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, obj.asigId);
    await waitP(() => pgP.locator("[data-promedio]").count().then((n) => n > 0), 8000);
    check("promedio instructor == oráculo", (await pgP.locator("[data-promedio]").innerText()).trim() === String(obj.a.promedio));
    check("X/Y instructor == oráculo", (await pgP.locator("[data-participacion]").innerText()).trim() === `${obj.a.participacion.completaron} de ${obj.a.participacion.deTotal}`);
    // CADA sección: el pct del acordeón del instructor == pctDeFraccion(ΣA/ΣT) del oráculo.
    let seccionesOk = true;
    for (const s of obj.a.porSeccionAgregado) {
      const btn = pgP.locator(`[data-acordeon-seccion="${s.seccion}"] button`).first();
      if ((await btn.count()) === 0) { seccionesOk = false; break; }
      const m = (await btn.innerText()).match(/(\d+)\s*%/);
      const pctI = m ? Number(m[1]) : null;
      if (pctI !== pctEsperado(s.aciertos, s.total)) { seccionesOk = false; break; }
    }
    check("⭐⭐ CADA sección del instructor == oráculo (pct)", seccionesOk);
    await ctxP.close();
  }

  // ── §3 · Legado sin desglose (precondición OBLIGATORIA: se siembra) ─────────
  console.log("§3 · legado sin desglose (caption visible)");
  {
    const legado = jsonDe(await correrConvex("seed:sembrarLegadoSinDesgloseLui32"));
    // El grupo «[E2E LUI-32] Legado» (ciclo 2026-A) tiene una fila con promedio pero sin
    // desglose por sección ⇒ caption «sin desglose» presente Y su promedio NO es «—».
    const bl = await convexAdmin.query("resumenExamenes:bloquesDe", { grupoIds: [legado.grupoId] });
    const filaLegada = bl.porGrupo[legado.grupoId]?.filas?.[0];
    check("legado sembrado y listado como aplicado", !!filaLegada);
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    await elegirCicloParcial(pg, "2026-A");
    const blq = await expandirBloque(pg, "[E2E LUI-32] Legado");
    const filaL = blq.locator("tbody tr").first();
    await filaL.waitFor({ timeout: 15_000 });
    check("⭐ fila legada muestra caption «sin desglose»", (await filaL.locator("[data-sin-desglose]").count()) > 0);
    check("⭐ el promedio de la fila legada NO es «—» (sí cuenta al promedio)", (await filaL.locator("td").nth(3).innerText()).trim() !== "—");
  }

  // ── §4 · Drill-down + selección inválida + click de fila ────────────────────
  console.log("§4 · drill-down, selección inválida y click de fila");
  {
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    await elegirCicloValor(pg, cc(cicloObj));
    const bl = await expandirBloque(pg, tituloBloqueObj);
    const link = bl.locator(`[data-fila-examen="${obj.a.examen}"]`).first();
    const href = await link.getAttribute("href");
    check("el Link lleva ?asignacion= de la fila", !!href && href.includes(`?asignacion=${obj.asigId}`));
    await link.click();
    await pg.waitForURL(/\/resultados\?asignacion=/, { timeout: 15_000 });
    const waitB = poller(pg);
    await waitB(() => pg.locator("[data-banner-solo-lectura]").count().then((n) => n > 0));
    check("⭐⭐ drill-down abre con la asignación clicada (no el default)", (await pg.locator("[data-selector-grupo]").inputValue()) === obj.asigId);
    // Default sin parámetro (la referencia).
    await pg.goto(`${BASE}/admin/examenes/biblioteca/${obj.examenId}/resultados`);
    await waitB(() => pg.locator("[data-banner-solo-lectura]").count().then((n) => n > 0));
    const defaultVal = await pg.locator("[data-selector-grupo]").inputValue();
    // Selección INVÁLIDA → debe caer EXACTAMENTE al mismo default (no al id inválido).
    await pg.goto(`${BASE}/admin/examenes/biblioteca/${obj.examenId}/resultados?asignacion=xxxinvalidoxxx`);
    await waitB(() => pg.locator("[data-banner-solo-lectura]").count().then((n) => n > 0));
    const valInvalido = await pg.locator("[data-selector-grupo]").inputValue();
    check("⭐ ?asignacion= inválida → cae al MISMO default (no al id inválido)", valInvalido === defaultVal && valInvalido !== "xxxinvalidoxxx");
    // Click de fila completa (mejora progresiva): navega también.
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    await elegirCicloValor(pg, cc(cicloObj));
    const bl2 = await expandirBloque(pg, tituloBloqueObj);
    const fila2 = bl2.locator(`[data-fila-examen="${obj.a.examen}"]`).first().locator("xpath=ancestor::tr[1]");
    await fila2.locator("td").nth(1).click(); // celda de fecha (no el Link)
    await pg.waitForURL(/\/resultados\?asignacion=/, { timeout: 15_000 });
    check("⭐ click de la fila completa navega (mejora)", pg.url().includes("/resultados?asignacion="));
  }

  // ── §5 · Prueba reina de paginación ─────────────────────────────────────────
  console.log("§5 · prueba reina de paginación");
  const { ciclo: cicloInact } = jsonDe(await correrConvex("seed:sembrarInactivosLui32"));
  {
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    await elegirCicloParcial(pg, cicloInact);
    check("⭐ página 1 muestra 10 inactivos vacíos (no queda vacía)", (await pg.locator("[data-bloque-grupo]").count()) === 10);
    await pg.locator("button", { hasText: "Siguientes" }).click();
    await pg.waitForTimeout(400);
    check("⭐ el activo con resultados aparece en la página 2", (await pg.locator("[data-resumen-examenes]").innerText()).includes("Inact ZZZ activo"));
  }

  // ── §6 · Candados ───────────────────────────────────────────────────────────
  console.log("§6 · candados de ciclo e historial");
  const { grupoId: grupoSinCiclo } = jsonDe(await correrConvex("seed:sembrarGrupoSinCicloLui32"));
  const cicloViejo = jsonDe(await correrConvex("seed:sembrarCicloLui32"));
  {
    const inst = (await convexAdmin.query("instructores:listar", {}))[0]?.id;
    const instIds = inst ? [inst] : [];
    const upd = (grupoId, nombre, ciclo, turno) => convexAdmin.mutation("grupos:actualizar", { grupoId, nombre, ciclo, turno, instructorIds: instIds });
    let r1 = false; try { await upd(cicloViejo.grupoId, "[E2E LUI-32] Ciclo viejo", "2020-b-e2e", "matutino"); } catch { r1 = true; }
    check("cambiar «2020-B-E2E»→«2020-b-e2e» con historial → RECHAZO", r1);
    let r2 = false; try { await upd(cicloViejo.grupoId, "[E2E LUI-32] Ciclo viejo", "2020-B-E2E", "vespertino"); r2 = true; } catch { r2 = false; }
    check("cambiar turno manteniendo ciclo exacto → OK", r2);
    let r3 = false; try { await upd(grupoSinCiclo, "[E2E LUI-32] Sin ciclo", "2021-COMPLETADO-E2E", "sabatino"); r3 = true; } catch { r3 = false; }
    check("legado sin ciclo: completar ciclo + editar turno → OK", r3);
    let r4 = false; try { await upd(grupoSinCiclo, "[E2E LUI-32] Sin ciclo", "2022-OTRO-E2E", "sabatino"); } catch { r4 = true; }
    check("ciclo ya completado no se puede volver a cambiar → RECHAZO", r4);
    // Frontera EXACTA del historial con el ESCRITOR REAL: 99 sembradas ⇒ la #100 (99→100)
    // PASA y la #101 (100→101) RECHAZA (una regresión que permitiera 101 pintaría rojo aquí).
    const { grupoId: grupoFront } = jsonDe(await correrConvex("seed:sembrarBloqueDesbordadoLui32", { confirmar: "SOLO_DEV", objetivo: 99, sufijo: "Frontera" }));
    const ahora = Date.now();
    const DIA_MS = 24 * 60 * 60_000;
    const asignarGrupo = (grupoId, dias) => convexAdmin.mutation("asignaciones:asignar", { examenId: idDe(BIOLOGIA), destino: { tipo: "grupos", grupoIds: [grupoId] }, abreEn: ahora + dias * DIA_MS, cierraEn: ahora + (dias + 2) * DIA_MS });
    let paso100 = false;
    try { await asignarGrupo(grupoFront, 1); paso100 = true; } catch (e) { console.error("    (#100 falló:", String(e).slice(0, 140), ")"); }
    check("⭐ asignación #100 (99→100) con el escritor real → PASA", paso100);
    let rechazo101 = false;
    try { await asignarGrupo(grupoFront, 5); } catch { rechazo101 = true; }
    check("⭐⭐ asignación #101 (100→101) con el escritor real → RECHAZO", rechazo101);
  }

  // ── §7 · Ciclo default + «Sin ciclo» DOM-safe ───────────────────────────────
  console.log("§7 · ciclo default y «Sin ciclo» seleccionable");
  await correrConvex("seed:sembrarGrupoVacioLui32", { confirmar: "SOLO_DEV", ciclo: "2099-A-E2E", sufijo: "Futuro" });
  {
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    check("⭐⭐ default = 2099-A-E2E codificado (más reciente, aunque vacío)", (await pg.locator("[data-filtro-ciclo]").inputValue()) === cc("2099-A-E2E"));
    await expandirBloque(pg, "[E2E LUI-32] Futuro");
    check("ciclo default vacío muestra su vacío honesto", (await pg.locator(`[data-bloque-grupo^="[E2E LUI-32] Futuro"]`).innerText()).includes("aún no tiene simulacros aplicados"));
    // «Sin ciclo» DOM-safe: un grupo legado FRESCO sin ciclo (el del §6 ya fue completado
    // por el candado) es seleccionable por su value "n" con otros ciclos presentes.
    await correrConvex("seed:sembrarGrupoSinCicloLui32", { confirmar: "SOLO_DEV", sufijo: "B" });
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    const tieneSinCiclo = await pg.locator("[data-filtro-ciclo]").evaluate((el) => [...el.options].some((o) => o.value === "n" && o.label === "Sin ciclo"));
    check("⭐ «Sin ciclo» presente con value DOM-safe «n»", tieneSinCiclo);
    if (tieneSinCiclo) {
      await elegirCicloValor(pg, "n");
      check("⭐⭐ seleccionar «Sin ciclo» (con otros ciclos) muestra su bloque", (await pg.locator(`[data-bloque-grupo^="[E2E LUI-32] Sin ciclo B"]`).count()) > 0);
    }
    // ⭐⭐ Dominio COMPLETO: un ciclo con U+0000 se muestra con value DOM-safe e HIDRATA sin
    // corromperse (el fix TOTAL de codificarCiclo, no un prefijo — el hallazgo mayor de r2).
    await correrConvex("seed:sembrarGrupoVacioLui32", { confirmar: "SOLO_DEV", ciclo: "\u0000CTRL-E2E", sufijo: "Ctrl" });
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    const valCtrl = cc("\u0000CTRL-E2E"); // "c%00CTRL-E2E"
    const opcionCtrl = await pg.locator("[data-filtro-ciclo]").evaluate((el, v) => [...el.options].some((o) => o.value === v), valCtrl);
    check("⭐⭐ ciclo con U+0000 → opción con value DOM-safe (encodeURIComponent)", opcionCtrl, valCtrl);
    if (opcionCtrl) {
      await elegirCicloValor(pg, valCtrl);
      check("⭐⭐ seleccionar el ciclo con U+0000 muestra su bloque (hidratación OK)", (await pg.locator(`[data-bloque-grupo^="[E2E LUI-32] Ctrl"]`).count()) > 0);
    }
    await elegirCicloParcial(pg, "2020-B-E2E");
    check("cambiar el Select muestra el bloque del ciclo viejo", (await pg.locator(`[data-bloque-grupo^="[E2E LUI-32] Ciclo viejo"]`).count()) > 0);
  }

  // ── §8 · Vacío vs desbordado + cortes ───────────────────────────────────────
  console.log("§8 · vacío/desbordado + cortes por HTTP");
  {
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    // Sufijo «Lleno» (único, NO prefijo de «Frontera» del §6) para localizar el de 101 filas.
    await correrConvex("seed:sembrarBloqueDesbordadoLui32", { confirmar: "SOLO_DEV", objetivo: 101, sufijo: "Lleno" });
    await pg.goto(`${BASE}/admin/examenes`);
    await wait(() => pg.locator("[data-resumen-examenes]").count().then((n) => n > 0));
    await elegirCicloParcial(pg, "2040-DESB-E2E");
    const blkDesb = pg.locator(`[data-bloque-grupo^="[E2E LUI-32] Desbordado Lleno"]`).first();
    if (!(await blkDesb.locator('button[aria-expanded="true"]').count())) await blkDesb.locator("button").first().click();
    await pg.waitForTimeout(500);
    const cuerpo = await blkDesb.innerText();
    check("⭐ bloque de 101 dice «Datos incompletos», NO «aún no tiene»", cuerpo.includes("Datos incompletos") && !cuerpo.includes("aún no tiene"), cuerpo.replace(/\s+/g, " ").slice(0, 120));
    // Corte de intentos (401) → cifrasDe problema:"intentos".
    const cota = jsonDe(await correrConvex("seed:sembrarIntentosParaCota", { confirmar: "SOLO_DEV", objetivo: 401 }));
    const cifrasCorte = await convexAdmin.query("resumenExamenes:cifrasDe", { asignacionId: cota.asignacionId });
    check("⭐ 401 intentos → cifrasDe problema:«intentos»", cifrasCorte && cifrasCorte.problema === "intentos");
    // Corte de catálogo (201 grupos) → catalogo problema:"catalogo".
    await correrConvex("seed:sembrarGruposParaCota", { confirmar: "SOLO_DEV", objetivo: 201 });
    const catCorte = await convexAdmin.query("resumenExamenes:catalogo", {});
    check("⭐ 201 grupos → catalogo problema:«catalogo» (fail-closed)", catCorte && catCorte.problema === "catalogo");
    await limpiarLui30(); // barre los namespaces LUI-30 sembrados por los cortes
  }

  // ── §9 · Examen legado plano de 101 secciones ───────────────────────────────
  console.log("§9 · examen legado plano de 101 secciones");
  {
    const plano = jsonDe(await correrConvex("seed:sembrarExamenPlanoLui32"));
    const ahora = Date.now();
    let asigno = false;
    try { await convexAdmin.mutation("asignaciones:asignar", { examenId: plano.examenId, destino: { tipo: "grupos", grupoIds: [plano.grupoId] }, abreEn: ahora - 60_000, cierraEn: ahora + 3 * 24 * 60 * 60_000 }); asigno = true; } catch (e) { console.error("    (asignar plano falló:", String(e).slice(0, 160), ")"); }
    check("examen legado plano VÁLIDO (asignar real lo aceptó)", asigno);
    await correrConvex("seed:sembrarIntentoPlanoLui32");
    const b = await convexAdmin.query("resumenExamenes:bloquesDe", { grupoIds: [plano.grupoId] });
    const filaP = b.porGrupo[plano.grupoId]?.filas?.[0];
    check("grupo plano lista su asignación aplicada", !!filaP);
    if (filaP) {
      const cifras = await convexAdmin.query("resumenExamenes:cifrasDe", { asignacionId: filaP.asignacionId });
      check("⭐⭐ cifrasDe procesa 101 secciones SIN problema (cota 240)", cifras && cifras.problema === null && cifras.secciones.length === 101, cifras ? `problema=${cifras.problema} secs=${cifras.secciones.length}` : "null");
    }
  }

  // ── §10 · authz de las 4 queries + fronteras + payload negativo + individuales ─
  console.log("§10 · authz, fronteras, payload negativo, individuales");
  const directa = jsonDe(await correrConvex("seed:sembrarDirectaLui32"));
  {
    // authz de las CUATRO queries con alumna e instructor.
    const ctxAl = await navegador.newContext();
    const pgAl = await ctxAl.newPage();
    await login(pgAl, FERNANDA, /\/(inicio|examenes|app|mis-examenes)/);
    const alu = clienteConvex(await tokenDe(pgAl));
    const algunGrupo = catAdmin.grupos[0]?.grupoId;
    const algunaAsig = obj.asigId;
    const rechaza = async (cli, fn, args) => { try { await cli.query(fn, args); return false; } catch { return true; } };
    const insCli = clientesInstr[0].cli;
    let alumnaTodas = true, instrTodas = true;
    for (const [fn, args] of [["resumenExamenes:catalogo", {}], ["resumenExamenes:bloquesDe", { grupoIds: [algunGrupo] }], ["resumenExamenes:rosterDe", { grupoId: algunGrupo }], ["resumenExamenes:cifrasDe", { asignacionId: algunaAsig }]]) {
      if (!(await rechaza(alu, fn, args))) alumnaTodas = false;
      if (!(await rechaza(insCli, fn, args))) instrTodas = false;
    }
    check("⭐ alumna → las 4 queries RECHAZADAS", alumnaTodas);
    check("⭐ instructor → las 4 queries RECHAZADAS (solo admin)", instrTodas);
    await ctxAl.close();

    // Fronteras de bloquesDe: >10 ids → rechazo; duplicados → rechazo.
    const onceIds = Array.from({ length: 11 }, () => algunGrupo);
    let rMax = false; try { await convexAdmin.query("resumenExamenes:bloquesDe", { grupoIds: onceIds }); } catch { rMax = true; }
    check("⭐ bloquesDe con >10 ids → RECHAZO (frontera de longitud)", rMax);
    let rDup = false; try { await convexAdmin.query("resumenExamenes:bloquesDe", { grupoIds: [algunGrupo, algunGrupo] }); } catch { rDup = true; }
    check("⭐ bloquesDe con ids duplicados → RECHAZO", rDup);

    // cifrasDe de la asignación DIRECTA (id sembrado) → null; y su alumna no crea bloque.
    const cifDirecta = await convexAdmin.query("resumenExamenes:cifrasDe", { asignacionId: directa.asignacionId });
    check("⭐⭐ cifrasDe de una asignación individual → null (no es de grupo)", cifDirecta === null);
    const directas = (await convexAdmin.query("resumenExamenes:catalogo", {})).grupos;
    check("⭐ la asignación individual no crea bloque de grupo", !directas.some((g) => g.nombre.includes("directa")));

    // Payload NEGATIVO: cifrasDe no filtra intentos crudos/_id/envioRegistradoEn.
    const cif = await convexAdmin.query("resumenExamenes:cifrasDe", { asignacionId: obj.asigId });
    const keys = Object.keys(cif ?? {}).sort().join(",");
    const s = JSON.stringify(cif ?? {});
    check("⭐ cifrasDe payload = solo cifras (sin intentos crudos/_id/envioRegistradoEn)", keys === "enviadasAlumnoIds,problema,promedio,secciones,sinDesglose,titulo" && !s.includes("_id") && !s.includes("envioRegistradoEn") && !s.includes("respuestas"));
  }

  // ── §12 · Restauración a línea base ─────────────────────────────────────────
  console.log("§12 · restauración a línea base");
  await limpiarLui32();
  await limpiarLui30();
  const finalBase = jsonDe(await correrConvex("seed:contarLineaBaseLui32"));
  const difs = Object.keys(base).filter((k) => base[k] !== finalBase[k]);
  check(`⭐ pasada ${pasada}: regreso EXACTO a la línea base`, difs.length === 0, difs.map((k) => `${k}:${base[k]}→${finalBase[k]}`).join(", "));

  await ctxAdmin.close();
}

let navegador = null;
try {
  navegador = await chromium.launch({ headless: !HEADED });
  for (let pasada = 1; pasada <= 2; pasada++) {
    console.log(`\nE2E LUI-32 · pizarra + línea base (pasada ${pasada})…`);
    await limpiarLui32();
    await limpiarLui30();
    await correrConvex("seed:limpiarContenidoDemo");
    const salidaSeed = jsonDe(await correrConvex("seed:cargarDatosDePrueba"));
    await correrConvex("seedAuth:credencialesDemo");
    const oraculo = salidaSeed.resultadosEsperado.porAsignacion;
    const base = jsonDe(await correrConvex("seed:contarLineaBaseLui32"));
    await correrPasada(navegador, oraculo, base, pasada);
  }
} catch (e) {
  console.error("\n✘ EXCEPCIÓN:", e);
  fallos++;
} finally {
  try {
    await limpiarLui32();
    await limpiarLui30();
    await correrConvex("seed:limpiarContenidoDemo");
    await correrConvex("seed:cargarDatosDePrueba");
    await correrConvex("seedAuth:credencialesDemo");
  } catch (e) {
    console.error("  (higiene final falló)", e);
  }
  if (navegador) await navegador.close();
}

console.log(`\n${ok} OK · ${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
