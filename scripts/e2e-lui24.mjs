/**
 * E2E de LUI-24 «Inicio — Mi progreso» (Diseño 23) y del read-model `ultimosDiagnosticos`.
 *
 * Corre con `npm run e2e:lui24`. Requisitos: `npx convex dev` + `npm run dev`. Usa la MISMA
 * base de dev que las demás suites: NUNCA correr dos a la vez. Idempotente: el `finally`
 * limpia (`limpiarLui24`) y re-siembra; el inventario vuelve EXACTO a la línea base.
 *
 * Cada testigo del read-model arranca desde una INVARIANTE ROTA (puntero borrado, no-máximo,
 * acumulado que cambia entre páginas) y conduce TODAS las páginas — un recómputo que no
 * hiciera nada NO pasaría. Lo DISCRIMINANTE (⭐):
 *  · §1 Estado completo: tarjeta y banner muestran el diagnóstico apuntado; «Ver» → resultado
 *    del MISMO intento. Anti-placeholder (ni «1082» ni «Continúa tu práctica»).
 *  · §2 Paridad: el próximo pendiente de Inicio == el primero de «Mis exámenes».
 *  · §3 Sin meta: «Pon tu meta» + header sin subtítulo.
 *  · §4 ⭐⭐ Prueba reina del header: con `mio` en error, /examenes operativa sin subtítulo;
 *    reparar + NAVEGAR hace reaparecer el subtítulo SIN recarga.
 *  · §5 ⭐ Puntero CRUZADO: la query LANZA sin filtrar dato ajeno.
 *  · §6 ⭐ Sin calificación: banner «— sin calificación».
 *  · §7 ⭐ El ESCRITOR ignora repasos.
 *  · §8 ⭐ Retroceso del apuntado: `decisionTrasParche` decide `borrarYRecomputar`, el
 *    conductor recompone y el puntero cae a B.
 *  · §9 ⭐⭐ Verificador bifásico: sano 0; duplicado/colgante/extra/NO-MÁXIMO cazados;
 *    malformada contada aparte.
 *  · §10 ⭐ SplitRequired LANZA en los TRES recorredores (backfill, fase 1, recómputo).
 *  · §11 ⭐⭐ Recómputo desde PUNTERO CORROMPIDO sobre 170 grandes, máximo en 1ª y última
 *    página, TODAS las páginas conducidas + idempotencia; backfill DESDE CERO conducido llega
 *    al máximo.
 *  · §13 ⭐ Modificación concurrente ENTRE páginas: cierre real + borrado del acumulado ⇒ el
 *    CAS revalida y no deja puntero rancio/colgante.
 *  · §14 ⭐ Cota post-limpieza: una alumna con >200 intentos, tras borrar el fixture, recompone
 *    ACOTADO (la limpieza borra primero).
 *  · §12 Authz: anónimo y staff no leen `ultimoDiagnostico`.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import {
  conducirBackfill,
  conducirRecomputo,
  conducirVerificacion,
} from "./lui24-drivers.mjs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const FERNANDA = "fernanda.alumna@demo.unx.mx";
const ANA = "ana.lopez@correo.com";
const BYTES_INFIMO = 4096; // fuerza SplitRequired sobre desgloses gordos

function urlConvexEfectiva() {
  let url = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  if (!url) {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      const m = env.match(/^NEXT_PUBLIC_CONVEX_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m);
      if (m) url = m[1].trim();
    } catch {
      /* cae al error */
    }
  }
  if (!url) {
    console.error("✘ No hay NEXT_PUBLIC_CONVEX_URL (ni en el proceso ni en .env.local).");
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
    throw new Error(`«convex run ${fn}» código ${code}: ${salida.trim()}`);
  return salida;
}
function jsonDe(salida) {
  const m = salida.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Salida sin JSON: ${salida.slice(0, 300)}`);
  return JSON.parse(m[0]);
}
/** `run` para los conductores compartidos: corre y parsea. */
const run = (fn, args = {}) => correrConvex(fn, args).then(jsonDe);
/** Corre un helper del seed (con `confirmar`) y parsea. */
const seed = (fn, extra = {}) => run(fn, { confirmar: "SOLO_DEV", ...extra });

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
  if (token) c.setAuth(token);
  return c;
}
async function rechazo(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e?.data ?? e?.message ?? e);
  }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function espera(cond, ms = 15_000, paso = 200) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await dormir(paso);
  }
}

const navegador = await chromium.launch({ headless: !HEADED });
const contextos = [];
async function abrirSesion(correo, urlRe, viewport = { width: 390, height: 844 }) {
  const ctx = await navegador.newContext({ viewport });
  contextos.push(ctx);
  const pg = await ctx.newPage();
  await login(pg, correo, urlRe);
  return { ctx, pg, convex: clienteConvex(await tokenDe(pg)) };
}

let inventarioAntes = null;
let sesFer = null;

try {
  // ── §0 · Pizarra e inventario base ────────────────────────────────────────
  console.log("\n0 · Pizarra e inventario base");
  await seed("seed:cargarDatosDePrueba");
  inventarioAntes = await seed("seed:contarLineaBase");
  const ver0 = await conducirVerificacion(run);
  check("⭐ el read-model del fixture es EXACTO (0 discrepancias, 0 malformados)",
    ver0.discrepancias === 0 && ver0.malformados === 0, JSON.stringify(ver0));

  // ── §1 · Estado completo (Fernanda) ───────────────────────────────────────
  console.log("\n1 · Estado completo con oráculo + anti-placeholder");
  sesFer = await abrirSesion(FERNANDA, /\/inicio/);
  const pgFer = sesFer.pg;
  await pgFer.goto(`${BASE}/inicio`);
  await pgFer.waitForSelector("[data-inicio]", { timeout: 20_000 });
  const puntero = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  const ferId = puntero.userId;
  check("Fernanda tiene puntero de diagnóstico", puntero.tienePuntero, JSON.stringify(puntero));
  const puntajeTarjeta = Number(
    (await pgFer.locator("[data-resultado-puntaje]").first().innerText()).trim(),
  );
  check("la tarjeta muestra un puntaje en escala 700–1300",
    puntajeTarjeta >= 700 && puntajeTarjeta <= 1300, String(puntajeTarjeta));
  const verHref = await pgFer.locator("[data-ver-ultimo]").getAttribute("href");
  check("⭐ «Ver» del banner apunta al intento APUNTADO",
    verHref === `/examenes/${puntero.intentoId}/resultado`, `${verHref}`);
  check("el subtítulo del header trae carrera — institución",
    (await pgFer.locator("[data-subtitulo-meta]").count()) === 1);
  const htmlInicio = await pgFer.content();
  check("⭐ anti-placeholder: /inicio ya no contiene «1082»", !htmlInicio.includes("1082"));
  check("⭐ anti-placeholder: ni «Continúa tu práctica»", !htmlInicio.includes("Continúa tu práctica"));

  // ── §2 · Paridad con Mis exámenes ─────────────────────────────────────────
  console.log("\n2 · Paridad Inicio ↔ Mis exámenes");
  const proximoInicio = pgFer.locator("[data-inicio] [data-pendiente]").first();
  const idInicio =
    (await proximoInicio.count()) > 0 ? await proximoInicio.getAttribute("data-pendiente") : null;
  await pgFer.goto(`${BASE}/examenes`);
  await pgFer.waitForSelector("[data-mis-examenes]", { timeout: 20_000 });
  const primerPend = pgFer.locator("[data-mis-examenes] [data-pendiente]").first();
  const idExamenes =
    (await primerPend.count()) > 0 ? await primerPend.getAttribute("data-pendiente") : null;
  check("⭐ el próximo pendiente de Inicio == el primero de Mis exámenes",
    idInicio === idExamenes, `inicio ${idInicio} vs examenes ${idExamenes}`);
  check("el subtítulo persiste en /examenes",
    (await pgFer.locator("[data-subtitulo-meta]").count()) === 1);

  // ── §3 · Sin meta ─────────────────────────────────────────────────────────
  console.log("\n3 · Sin meta (Pon tu meta + header sin subtítulo)");
  await seed("seed:borrarPerfilAlumnaLui28", { correo: FERNANDA });
  await pgFer.goto(`${BASE}/inicio`);
  await pgFer.waitForSelector("[data-inicio]", { timeout: 20_000 });
  check("⭐ sin meta ⇒ la tarjeta invita «Pon tu meta»",
    (await pgFer.locator("[data-sin-meta]").count()) === 1);
  check("…y el header pierde el subtítulo",
    (await pgFer.locator("[data-subtitulo-meta]").count()) === 0);
  await seed("seed:cargarDatosDePrueba");
  await pgFer.goto(`${BASE}/inicio`);
  await pgFer.waitForSelector("[data-subtitulo-meta]", { timeout: 20_000 });
  check("restaurada la meta, el subtítulo vuelve",
    (await pgFer.locator("[data-subtitulo-meta]").count()) === 1);

  // ── §4 · Prueba reina del header ──────────────────────────────────────────
  console.log("\n4 · Aislamiento del header ante query en error");
  await seed("seed:sembrarTripletaParcialLui28", { correo: FERNANDA });
  await pgFer.goto(`${BASE}/examenes`);
  await pgFer.waitForSelector("[data-mis-examenes]", { timeout: 20_000 });
  check("⭐⭐ con la query del perfil en ERROR, /examenes sigue operativa",
    (await pgFer.locator("[data-mis-examenes]").count()) === 1);
  check("…el subtítulo desaparece (boundary local)",
    (await pgFer.locator("[data-subtitulo-meta]").count()) === 0);
  check("…y el avatar → Perfil sigue vivo",
    (await pgFer.locator("[data-ir-perfil]").count()) === 1);
  await seed("seed:cargarDatosDePrueba");
  await dormir(800);
  await pgFer.evaluate(() =>
    document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()),
  );
  await pgFer.locator("nav a[href='/inicio']").click();
  await pgFer.waitForURL(/\/inicio/, { timeout: 20_000 });
  const volvio = await espera(
    async () => (await pgFer.locator("[data-subtitulo-meta]").count()) === 1, 20_000);
  check("⭐ reparado el perfil y tras NAVEGAR (cliente), el subtítulo reaparece sin recarga", volvio);

  // ── §5 · Puntero cruzado sin fuga ─────────────────────────────────────────
  console.log("\n5 · Puntero CRUZADO no filtra dato ajeno");
  const cruz = await seed("seed:sembrarPunteroCruzadoLui24", { correoDueno: FERNANDA, correoAjeno: ANA });
  const msgCruce = await rechazo(() => sesFer.convex.query("player:ultimoDiagnostico", {}));
  check("⭐ con puntero cruzado, la query LANZA", msgCruce !== null, String(msgCruce));
  check("…y el mensaje NO filtra el intento ajeno",
    msgCruce !== null && !msgCruce.includes(cruz.intentoAjeno), String(msgCruce));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §6 · Sin calificación ─────────────────────────────────────────────────
  console.log("\n6 · Diagnóstico SIN calificación");
  await seed("seed:sembrarDiagnosticoSinPuntajeLui24", { correo: FERNANDA });
  await pgFer.goto(`${BASE}/inicio`);
  await pgFer.waitForSelector("[data-inicio]", { timeout: 20_000 });
  const bannerSC = await pgFer.locator("[data-ultimo-resultado]").innerText();
  check("⭐ el banner dice «— sin calificación»", bannerSC.includes("sin calificación"), bannerSC);
  check("…la tarjeta dice que se registró pero no pudo calificarse",
    (await pgFer.locator("[data-inicio]").innerText()).includes("no pudo calificarse"));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §7 · El escritor ignora repasos ───────────────────────────────────────
  console.log("\n7 · Un repaso NO mueve el puntero (escritor)");
  const vol1 = await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 1 });
  const antesRepaso = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  const { intentoId: repasoId } = await sesFer.convex.mutation("player:iniciarIntento", {
    asignacionId: vol1.asignacionId,
  });
  await sesFer.convex.mutation("player:enviar", { intentoId: repasoId });
  const trasRepaso = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  check("⭐ el repaso quedó enviado con id distinto al del puntero", repasoId !== antesRepaso.intentoId);
  check("⭐ el puntero NO se movió al repaso (LUI-104 en el escritor)",
    trasRepaso.intentoId === antesRepaso.intentoId, `${antesRepaso.intentoId} → ${trasRepaso.intentoId}`);
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §8 · Retroceso del apuntado (decisionTrasParche + conductor) ───────────
  console.log("\n8 · Retroceso del intento apuntado");
  const ahora8 = Date.now();
  const par = await seed("seed:sembrarParLui24", { correo: FERNANDA, enviadoA: ahora8, enviadoB: ahora8 - 10 * 60_000 });
  const trasPar = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  check("el puntero apunta a A (el mayor)", trasPar.intentoId === par.intentoA, JSON.stringify(trasPar));
  const reanc = await seed("seed:reanclarLui24", {
    correo: FERNANDA, intentoId: par.intentoA, nuevoEnviadoEn: ahora8 - 20 * 60_000,
  });
  check("⭐ decisionTrasParche decide «borrarYRecomputar» y deja recómputo pendiente",
    reanc.decision === "borrarYRecomputar" && reanc.recomputoPendiente.length === 1, JSON.stringify(reanc));
  for (const uid of reanc.recomputoPendiente) await conducirRecomputo(run, uid);
  const trasReanclar = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  check("⭐ A retrocede por debajo de B ⇒ el conductor deja el puntero en B",
    trasReanclar.intentoId === par.intentoB, JSON.stringify(trasReanclar));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §9 · Verificador bifásico + roturas ────────────────────────────────────
  console.log("\n9 · Verificador bifásico caza cada rotura");
  const sano = await conducirVerificacion(run);
  check("sano ⇒ 0 discrepancias, 0 malformados", sano.discrepancias === 0 && sano.malformados === 0, JSON.stringify(sano));
  for (const tipo of ["duplicado", "colgante", "extra"]) {
    await seed("seed:romperVerificadorLui24", { correo: FERNANDA, tipo });
    const r = await conducirVerificacion(run);
    check(`⭐ rotura «${tipo}» ⇒ discrepancias > 0`, r.discrepancias > 0, JSON.stringify(r));
    await seed("seed:limpiarLui24");
    await seed("seed:cargarDatosDePrueba");
  }
  // ⭐ Puntero VÁLIDO pero NO-MÁXIMO multipágina: forzar al mínimo de un fixture de 170.
  const volNM = await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 170, maxEn: "ultima" });
  await seed("seed:forzarPunteroLui24", { correo: FERNANDA, intentoId: volNM.minIntentoId, enviadoEn: volNM.minEnviadoEn });
  const rNM = await conducirVerificacion(run);
  check("⭐ puntero VÁLIDO pero NO-MÁXIMO (con el máximo en otra página) ⇒ discrepancia",
    rNM.discrepancias > 0, JSON.stringify(rNM));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");
  // Malformada: contada aparte, sin discrepancia falsa.
  await seed("seed:romperVerificadorLui24", { correo: FERNANDA, tipo: "malformado" });
  const rMal = await conducirVerificacion(run);
  check("⭐ fila malformada ⇒ se cuenta aparte, sin discrepancia falsa",
    rMal.malformados > 0 && rMal.discrepancias === 0, JSON.stringify(rMal));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §10 · SplitRequired LANZA en los TRES recorredores ────────────────────
  console.log("\n10 · SplitRequired LANZA (no salta) en backfill, fase 1 y recómputo");
  await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 170, gordo: true, maxEn: "ultima" });
  const msgBF = await rechazo(() => correrConvex("migracionesMetricas:backfillUltimosDiagnosticos", { cursor: null, limiteBytesOverride: BYTES_INFIMO }));
  check("⭐ backfill LANZA (SplitRequired)", msgBF !== null && /SplitRequired/i.test(msgBF), String(msgBF).slice(0, 160));
  const msgF1 = await rechazo(() => correrConvex("migracionesMetricas:verificarUltimosDiagnosticos", { fase: 1, cursor: null, limiteBytesOverride: BYTES_INFIMO }));
  check("⭐ verificador fase 1 LANZA (SplitRequired)", msgF1 !== null && /SplitRequired/i.test(msgF1), String(msgF1).slice(0, 160));
  const msgRC = await rechazo(() => correrConvex("seed:recomputarPunteroDe", { confirmar: "SOLO_DEV", alumnoId: ferId, cursor: null, maximoParcial: null, limiteBytesOverride: BYTES_INFIMO }));
  check("⭐ recómputo LANZA (SplitRequired)", msgRC !== null && /SplitRequired/i.test(msgRC), String(msgRC).slice(0, 160));
  await seed("seed:limpiarLui24");
  await seed("seed:cargarDatosDePrueba");

  // ── §11 · Recómputo desde PUNTERO CORROMPIDO sobre 170 grandes ─────────────
  console.log("\n11 · Recómputo desde puntero corrompido (máximo en 1ª y última página)");
  for (const maxEn of ["primera", "ultima"]) {
    const vol = await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 170, gordo: true, maxEn });
    // CORROMPER: forzar el puntero al MÍNIMO (no-máximo) antes de recomputar.
    await seed("seed:forzarPunteroLui24", { correo: FERNANDA, intentoId: vol.minIntentoId, enviadoEn: vol.minEnviadoEn });
    await conducirRecomputo(run, ferId); // TODAS las páginas
    const p1 = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
    check(`⭐ recómputo (máximo en ${maxEn}) desde puntero corrompido ⇒ llega al máximo`,
      p1.intentoId === vol.maxIntentoId, `${p1.intentoId} vs ${vol.maxIntentoId}`);
    // Idempotencia: una segunda corrida no cambia el puntero.
    await conducirRecomputo(run, ferId);
    const p2 = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
    check(`…idempotente (${maxEn}): segunda corrida no cambia`, p2.intentoId === vol.maxIntentoId);
    // Backfill DESDE CERO (puntero borrado) conducido llega al máximo.
    await seed("seed:borrarPunteroLui24", { correo: FERNANDA });
    await conducirBackfill(run);
    const p3 = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
    check(`⭐ backfill desde CERO conducido (${maxEn}) ⇒ máximo`, p3.intentoId === vol.maxIntentoId, `${p3.intentoId}`);
    await seed("seed:limpiarLui24");
    await seed("seed:cargarDatosDePrueba");
  }

  // ── §13 · Modificación concurrente ENTRE páginas del recómputo ─────────────
  console.log("\n13 · Modificación concurrente entre páginas (CAS)");
  // (a) CIERRE REAL entre páginas: el puntero converge al diagnóstico más nuevo.
  {
    const vol = await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 20, maxEn: "primera" });
    const abierta = await seed("seed:sembrarAsignacionAbiertaLui24", { correo: FERNANDA });
    await seed("seed:forzarPunteroLui24", { correo: FERNANDA, intentoId: vol.minIntentoId, enviadoEn: vol.minEnviadoEn });
    // Page 1
    let r = await seed("seed:recomputarPunteroDe", { alumnoId: ferId, cursor: null, maximoParcial: null });
    // CIERRE REAL de un diagnóstico nuevo (enviadoEn = ahora, mayor que todo el fixture).
    const { intentoId: yId } = await sesFer.convex.mutation("player:iniciarIntento", { asignacionId: abierta.asignacionId });
    await sesFer.convex.mutation("player:enviar", { intentoId: yId });
    // Continuar hasta terminar.
    let guard = 0;
    while (!r.isDone && guard++ < 10_000) {
      if (r.reiniciar) { r = await seed("seed:recomputarPunteroDe", { alumnoId: ferId, cursor: null, maximoParcial: null }); continue; }
      r = await seed("seed:recomputarPunteroDe", { alumnoId: ferId, cursor: r.continueCursor, maximoParcial: r.maximoParcial });
    }
    check("el recómputo ALCANZÓ su commit final (isDone), no se estancó", r.isDone === true);
    const p = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
    check("⭐ un cierre REAL entre páginas: el puntero converge al diagnóstico más nuevo, sin corromperse",
      p.intentoId === yId, `${p.intentoId} vs ${yId}`);
    await seed("seed:limpiarLui24");
    await seed("seed:cargarDatosDePrueba");
  }
  // (b) BORRADO del acumulado entre páginas: el commit lo revalida y REINICIA.
  {
    const vol = await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 20, maxEn: "primera" });
    await seed("seed:borrarPunteroLui24", { correo: FERNANDA });
    let cursor = null, max = null, done = false, borradoM = false, reinicios = 0, guard = 0;
    while (!done && guard++ < 10_000) {
      const r = await seed("seed:recomputarPunteroDe", { alumnoId: ferId, cursor, maximoParcial: max });
      if (r.reiniciar) { cursor = null; max = null; reinicios++; continue; }
      if (!borradoM && r.maximoParcial && r.maximoParcial.intentoId === vol.maxIntentoId) {
        await seed("seed:borrarIntentoLui24", { intentoId: vol.maxIntentoId });
        borradoM = true;
      }
      cursor = r.continueCursor; max = r.maximoParcial; done = r.isDone;
    }
    check("el recómputo ALCANZÓ su commit final (isDone), no se estancó", done === true);
    const p = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
    check("borré el acumulado mientras el recómputo lo cargaba", borradoM);
    check("⭐ el commit REVALIDÓ el acumulado borrado y REINICIÓ", reinicios >= 1, `reinicios ${reinicios}`);
    check("⭐ el puntero final NO es el intento borrado, y es válido (sin colgante)",
      p.tienePuntero && p.intentoId !== vol.maxIntentoId, JSON.stringify(p));
    await seed("seed:limpiarLui24");
    await seed("seed:cargarDatosDePrueba");
  }

  // ── §14 · Cota real post-limpieza (>200 intentos) ─────────────────────────
  console.log("\n14 · La limpieza recompone ACOTADO tras borrar un fixture grande");
  await seed("seed:sembrarVoluminosoLui24", { correo: FERNANDA, n: 250, gordo: false, maxEn: "ultima" });
  const antesLimpia = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  check("con >200 intentos, el puntero apunta al fixture", antesLimpia.tienePuntero);
  // `limpiarLui24` borra el fixture y RECOMPONE (acotado: la alumna es pequeña YA sin el fixture).
  const limp = await seed("seed:limpiarLui24");
  check("⭐ la limpieza no lanza pese a >200 intentos (borra primero, recompone acotado)",
    typeof limp.intentos === "number" && limp.intentos >= 250, JSON.stringify(limp));
  const trasLimpia = await seed("seed:estadoPunteroLui24", { correo: FERNANDA });
  check("⭐ el puntero vuelve al diagnóstico real de Fernanda (no colgante)",
    trasLimpia.tienePuntero && trasLimpia.intentoId !== antesLimpia.intentoId, JSON.stringify(trasLimpia));
  await seed("seed:cargarDatosDePrueba");
  const verFinal = await conducirVerificacion(run);
  check("⭐ tras todo, el read-model sigue EXACTO (0/0)",
    verFinal.discrepancias === 0 && verFinal.malformados === 0, JSON.stringify(verFinal));

  // ── §12 · Authz negativa ──────────────────────────────────────────────────
  console.log("\n12 · Authz de ultimoDiagnostico");
  const anon = clienteConvex(null);
  check("⭐ anónimo NO puede leer ultimoDiagnostico",
    (await rechazo(() => anon.query("player:ultimoDiagnostico", {}))) !== null);
  const sesAdmin = await abrirSesion(ADMIN, /\/admin/);
  check("⭐ staff NO puede leer ultimoDiagnostico",
    (await rechazo(() => sesAdmin.convex.query("player:ultimoDiagnostico", {}))) !== null);
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e?.stack ?? e}`);
} finally {
  try {
    await seed("seed:limpiarLui24");
  } catch (e) {
    console.error("⚠︎ limpiarLui24:", String(e).slice(0, 200));
  }
  try {
    await seed("seed:cargarDatosDePrueba");
  } catch (e) {
    console.error("⚠︎ pizarra final:", String(e).slice(0, 200));
  }
  for (const ctx of contextos) await ctx.close().catch(() => {});
  await navegador.close().catch(() => {});

  if (inventarioAntes) {
    try {
      const tras = await seed("seed:contarLineaBase");
      const difs = Object.keys(inventarioAntes).filter((k) => tras[k] !== inventarioAntes[k]);
      check("⭐ inventario final == línea base (idempotente)", difs.length === 0,
        difs.map((k) => `${k} ${inventarioAntes[k]}→${tras[k]}`).join(", "));
    } catch (e) {
      fallos++;
      console.error("⚠︎ inventario final:", String(e).slice(0, 200));
    }
  }
}

console.log(`\n──────────────\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
