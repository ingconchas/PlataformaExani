/**
 * E2E del PAQUETE PLAYER — LUI-25 «Mis exámenes» · LUI-26 simulacro en curso ·
 * LUI-27 cierre por tiempo · LUI-104 repasos (motor).
 *
 * Corre con `npm run e2e:lui26`. Requisitos: `npx convex dev` + `npm run dev`.
 *
 * ⚠️ Usa la MISMA base de dev que las demás suites: NUNCA correr dos a la vez. Es
 * idempotente (dos corridas seguidas dan el mismo resultado): la pizarra del `finally`
 * restaura el fixture y cada limpieza se intenta por SEPARADO, sumando fallos si falla —
 * un verde con la pizarra sucia sería un falso verde para la siguiente suite.
 *
 * Lo DISCRIMINANTE (⭐ = demostrada en ROJO antes del GO):
 *  · §2 la lista se deriva del oráculo CRUDO con el `Date.now()` de Node AL ASERTAR: una
 *    futura AUSENTE, una cerrada sin envío como VENCIDA no accionable, y el puntaje de la
 *    card = el del DIAGNÓSTICO (un repaso mejor NO lo mueve).
 *  · §3 el testigo de TIEMPO de la lista: la card APARECE sola al cruzar `abreEn` (sin
 *    recargar) — una query que estampara el estado, o una derivación única al montar,
 *    dejaría «no tienes simulacros» para siempre.
 *  · §4/§5 el cursor de navegación es DURABLE y su confirmación OBSERVABLE: se navega a
 *    una pregunta SIN responderla, se espera la confirmación y se cierra el contexto de
 *    inmediato; al volver, el player abre EN ESA pregunta (la «primera sin responder»
 *    sería otra — por eso el caso no es vacuo).
 *  · §6 el mapa se abre desde el CONTADOR y sus conteos salen de la réplica.
 *  · §7 testigo de TIEMPO del player: cruza el umbral de 5 minutos (banner + chip) y el
 *    CERO (pantalla terminal), con deadlines DERIVADOS y anti-vacuidad (`data-limite`).
 *  · §8 ⭐⭐ CIERRE DURABLE: con el navegador CERRADO por completo, el intento vencido
 *    aparece `enviado` con `formaCierre: "tiempo_agotado"` — sin cliente que lo empuje.
 *  · §9 envío manual: el resumen de confirmación con números y singular EXACTOS y el
 *    puntaje EXACTO de la fórmula (sin responder = incorrecta).
 *  · §10 repasos: `numeroIntento` incremental, «Repaso en curso» mientras vive, y la
 *    ANALÍTICA INTACTA tras TRES repeticiones (el promedio del panel no se mueve).
 *  · §11 ⭐⭐ authz por cliente HTTP: intento ajeno → `null`, mutations ajenas → error, y
 *    el PAYLOAD del examen NO contiene `opcionCorrecta`, `retroalimentacion` ni `correcta`.
 *  · §12 ⭐⭐ una alumna SIN grupo no ve las asignaciones individuales de otras (la
 *    semántica `eq(campo, undefined)` de Convex, que sin el guard filtraría todas).
 *  · §13 idempotencia: iniciar dos veces devuelve el MISMO intento; enviar dos veces no
 *    recalcula.
 *  · §14 solo-futuras ≠ vacío exitoso.
 *
 * Lo que la suite NO puede probar (revisión de código): los techos de 30 intentos por
 * serie y 30 vivas por alumna (30 envíos por UI es impracticable — los bordes exactos
 * viven en `test:simulacro`); el desborde de `MAX_INTENTOS_PANEL_POR_ASIGNACION` (400
 * intentos); las cotas de `misExamenes` (120/60 filas).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const FERNANDA = "fernanda.alumna@demo.unx.mx";
const ANA = "ana.lopez@correo.com";

const SG2 = "Simulacro General 2"; // `esteMes` de índice ≥3: SIEMPRE abierta
const SG3 = "Simulacro General 3"; // futura (+7 d)
const SG0 = "Simulacro General 0"; // cerrada sin intentos → vencida
// Asignable por UI (SG3 es el publicado DEGRADADO del fixture: `asignar` lo rechaza).
// ⚠️ Tiene UNA sola pregunta: sirve para el testigo de la lista, no para navegar.
const BIOLOGIA = "Módulo Biología 1";
/** Nombre del grupo TEMPORAL de §14; la limpieza del `finally` solo toca ese. */
const MARCA_E2E = "[E2E LUI-26] Solo futuras";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const OFFSET_MX = 6 * HORA;
const ALERTA_MS = 5 * MIN;
/** Intentos que esta suite crea como MÁXIMO (§5, §8, §9 y los 2 repasos de §10, con
 *  holgura). Es la cota contra la que se aserta el trabajo residual del scheduler. */
const MAX_INTENTOS_DE_LA_CORRIDA = 16;

function urlConvexEfectiva() {
  let url = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  if (!url) {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      const m = env.match(/^NEXT_PUBLIC_CONVEX_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m);
      if (m) url = m[1].trim();
    } catch {
      /* sin .env.local: cae al error de abajo */
    }
  }
  if (!url) {
    console.error("✘ No hay NEXT_PUBLIC_CONVEX_URL (ni en el proceso ni en .env.local).");
    process.exit(1);
  }
  if (process.env.E2E_CONVEX_URL && process.env.E2E_CONVEX_URL !== url) {
    console.error(
      `✘ E2E_CONVEX_URL (${process.env.E2E_CONVEX_URL}) difiere de la URL efectiva (${url}).`,
    );
    process.exit(1);
  }
  return url;
}
const CONVEX_URL = urlConvexEfectiva();
const CLAVE_JWT = `__convexAuthJWT_${CONVEX_URL.replace(/[^a-zA-Z0-9]/g, "")}`;

let ok = 0;
let fallos = 0;
let jobsAlInicio = 0;
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
  const { code, salida } = await ejecutar("npx", [
    "convex", "run", fn, JSON.stringify(args),
  ]);
  if (code !== 0)
    throw new Error(`«convex run ${fn}» salió con código ${code}: ${salida.trim()}`);
  return salida;
}
function jsonDe(salida) {
  const m = salida.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Salida sin JSON: ${salida.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

function relojMx(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const alMinuto = (ts) => ts - ((ts - OFFSET_MX) % MIN);

// ── Réplicas INDEPENDIENTES (duplicadas a propósito de convex/) ──────────────
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MESES_C = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fechaCortaEsperada(ts) {
  const d = new Date(ts - OFFSET_MX);
  return `${d.getUTCDate()} ${MESES_C[d.getUTCMonth()]}`;
}
function fechaHoraEsperada(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} de ${MESES_L[d.getUTCMonth()]}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** 700 + aciertos×600/N, redondeado para mostrar (réplica de `simulacro.ts`). */
const puntajeEsperado = (aciertos, n) => Math.round(700 + (aciertos * 600) / n);

/**
 * Réplica de `derivarMisExamenes`: del oráculo CRUDO del seed + el `ahora` de Node AL
 * ASERTAR produce las tres listas. Independiente del código de producción a propósito.
 */
function derivarReplica(oraculo, ahora) {
  const pendientes = [], completados = [], vencidos = [];
  let hayFuturas = false;
  for (const f of oraculo.filas) {
    const enviados = f.intentos.filter((i) => i.estado === "enviado");
    if (ahora < f.abreEn) { hayFuturas = true; continue; }
    const cerrada = ahora >= f.cierraEn;
    if (enviados.length > 0) {
      completados.push({
        examen: f.examen,
        puntaje: enviados[0].puntaje === null ? null : Math.round(enviados[0].puntaje),
        contestadoEn: enviados[0].enviadoEn,
        abierta: !cerrada,
        repaso: enviados.length > 1,
      });
    } else if (cerrada) {
      vencidos.push({ examen: f.examen, cierraEn: f.cierraEn });
    } else {
      pendientes.push({
        examen: f.examen,
        cierraEn: f.cierraEn,
        numReactivos: f.numReactivos,
        duracionMin: f.duracionMin,
      });
    }
  }
  pendientes.sort((a, b) => a.cierraEn - b.cierraEn || a.examen.localeCompare(b.examen, "es"));
  completados.sort(
    (a, b) =>
      Number(b.abierta) - Number(a.abierta) ||
      (b.contestadoEn ?? 0) - (a.contestadoEn ?? 0) ||
      a.examen.localeCompare(b.examen, "es"),
  );
  vencidos.sort((a, b) => b.cierraEn - a.cierraEn);
  return { pendientes, completados, vencidos, hayFuturas };
}

function poller(pg) {
  return async (cond, ms = 10_000) => {
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
  if (!token) throw new Error("No hay JWT en localStorage (clave namespaced).");
  return token;
}
function clienteConvex(token) {
  const c = new ConvexHttpClient(CONVEX_URL);
  c.setAuth(token);
  return c;
}

const pendientes = (pg) => pg.locator("[data-pendiente]");
const completados = (pg) => pg.locator("[data-completado]");
const vencidos = (pg) => pg.locator("[data-vencido]");
const cardDe = (loc, titulo) => loc.filter({ hasText: titulo }).first();

/** Abre «Asignar» de un examen desde la biblioteca de admin (calcado de lui19/lui22). */
async function abrirAsignar(pg, titulo) {
  const espera = poller(pg);
  await pg.goto(`${BASE}/admin/examenes/biblioteca`);
  await espera(async () => (await pg.locator("tbody tr").count()) > 0);
  await pg.getByPlaceholder("Buscar por título…").fill(titulo);
  await espera(
    async () => (await pg.locator("tbody tr").filter({ hasText: titulo }).count()) === 1,
  );
  await pg.getByRole("link", { name: `Asignar «${titulo}»` }).click();
  await pg.waitForURL(/\/asignar$/, { timeout: 15_000 });
  await espera(async () =>
    ((await pg.textContent("body")) ?? "").includes("¿A quién va dirigido?"),
  );
}

let navegador = null;
try {
  console.log("\nE2E LUI-26 · pizarra en dos tiempos…");
  // Línea base del trabajo agendado: lo que interesa es el DELTA que deja ESTA corrida,
  // no un absoluto (los huérfanos de corridas previas siguen pendientes hasta disparar).
  jobsAlInicio = jsonDe(await correrConvex("seed:contarJobsPendientes")).huerfanos;
  await correrConvex("seed:limpiarContenidoDemo");
  await correrConvex("seedAuth:credencialesDemo");

  navegador = await chromium.launch({ headless: !HEADED });
  const ctxAlumna = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctxAlumna.newPage();
  const espera = poller(pg);

  // ── §1 · VACÍO honesto ────────────────────────────────────────────────────
  console.log("\n1 · Sin asignaciones");
  await login(pg, FERNANDA, /\/inicio/);
  await pg.goto(`${BASE}/examenes`);
  await espera(async () => (await pg.locator("[data-mis-examenes]").count()) === 1, 20_000);
  await espera(async () => (await pg.locator("[data-vacio]").count()) === 1);
  check(
    "vacío del diseño: «Aún no tienes simulacros asignados»",
    ((await pg.textContent("body")) ?? "").includes("Aún no tienes simulacros asignados"),
  );
  check("⭐ sin secciones de pendientes/completados/vencidos",
    (await pendientes(pg).count()) === 0 &&
      (await completados(pg).count()) === 0 &&
      (await vencidos(pg).count()) === 0);
  check("la BottomNav sigue presente (no es modo examen)",
    (await pg.locator("nav a[href='/examenes']").count()) === 1);

  // ── §2 · Carga REACTIVA + lista contra el oráculo ─────────────────────────
  console.log("\n2 · Fixture cargado con la pantalla abierta");
  const oraculoTodo = jsonDe(await correrConvex("seed:cargarDatosDePrueba"));
  const oraculoFer = oraculoTodo.misExamenesEsperado[FERNANDA];
  check(
    "⭐ la lista aparece SIN recargar (reactividad)",
    await espera(async () => (await completados(pg).count()) > 0, 20_000),
  );

  const r = derivarReplica(oraculoFer, Date.now());
  check(
    "conteo de completados = réplica",
    (await completados(pg).count()) === r.completados.length,
    `ui ${await completados(pg).count()} vs réplica ${r.completados.length}`,
  );
  check(
    "conteo de vencidos = réplica",
    (await vencidos(pg).count()) === r.vencidos.length,
  );
  check(
    "⭐ el examen FUTURO (SG3, abre en +7 d) NO aparece en ninguna lista",
    !((await pg.textContent("body")) ?? "").includes(SG3) && r.hayFuturas,
  );
  const sg0 = cardDe(vencidos(pg), SG0);
  check(
    "⭐ una ventana cerrada sin envío es VENCIDA y no accionable (sin botones ni enlaces)",
    (await sg0.count()) === 1 &&
      (await sg0.locator("button, a").count()) === 0,
  );
  const compSg2 = cardDe(completados(pg), SG2);
  const textoSg2 = ((await compSg2.textContent()) ?? "").replace(/\s+/g, " ");
  const espSg2 = r.completados.find((c) => c.examen === SG2);
  check(
    "⭐ el puntaje de la card es el del DIAGNÓSTICO (no el del repaso, +150)",
    textoSg2.includes(String(espSg2.puntaje)),
    `esperado ${espSg2.puntaje} · card «${textoSg2.slice(0, 90)}»`,
  );
  check(
    "«Contestado el {fecha corta}» = réplica",
    textoSg2.includes(fechaCortaEsperada(espSg2.contestadoEn)),
  );
  check(
    "ventana abierta ⇒ ofrece «Repetir como repaso»",
    (await compSg2.locator('[data-cta="repasar"]').count()) === 1,
  );
  const cerrado = r.completados.find((c) => !c.abierta);
  check(
    "⭐ un completado con ventana CERRADA dice «ventana cerrada» y NO ofrece repaso",
    (await cardDe(completados(pg), cerrado.examen).locator('[data-cta="repasar"]').count()) === 0 &&
      ((await cardDe(completados(pg), cerrado.examen).textContent()) ?? "").includes("ventana cerrada"),
  );
  check(
    "nota al pie del repaso (copy del diseño)",
    ((await pg.textContent("body")) ?? "").includes(
      "El repaso no cambia tu puntaje: cuenta el primer intento.",
    ),
  );

  // ── §3 · Testigo de TIEMPO en la lista ────────────────────────────────────
  console.log("\n3 · La card aparece sola al abrirse la ventana");
  // El ancla ANTES de que exista la asignación: su cambio demuestra que hubo entrega
  // reactiva (la card no aparece por un re-render cualquiera).
  const anclaAntes = await pg
    .locator("[data-mis-examenes]")
    .getAttribute("data-ahora-servidor");
  const ctxAdmin = await navegador.newContext();
  const pgAdmin = await ctxAdmin.newPage();
  await login(pgAdmin, ADMIN, /\/admin/);
  await abrirAsignar(pgAdmin, BIOLOGIA);
  await pgAdmin.getByRole("combobox").click();
  await pgAdmin.getByRole("option", { name: /^Matutino A/ }).click();
  await pgAdmin.keyboard.press("Escape");
  // Apertura en el PRÓXIMO minuto con ≥20 s de margen (el input tiene granularidad de
  // minuto); cierre bien lejos para que el límite del intento NO quede recortado.
  let abre = alMinuto(Date.now() + 90_000);
  while (abre - Date.now() < 20_000) abre += MIN;
  await pgAdmin.fill("#asignar-apertura", relojMx(abre));
  await pgAdmin.fill("#asignar-cierre", relojMx(abre + 5 * DIA));
  await poller(pgAdmin)(
    async () => !(await pgAdmin.getByRole("button", { name: "Confirmar asignación" }).isDisabled()),
  );
  await pgAdmin.getByRole("button", { name: "Confirmar asignación" }).click();
  await pgAdmin.waitForURL(/biblioteca$/, { timeout: 15_000 });

  check(
    "la asignación PROGRAMADA todavía no se lista",
    (await cardDe(pendientes(pg), BIOLOGIA).count()) === 0,
  );
  check(
    "⭐ anti-vacuidad: la entrega reactiva del ancla llegó ANTES del cruce (si no, la card " +
      "aparecería por un re-render cualquiera y el testigo sería vacuo)",
    (await pg.locator("[data-mis-examenes]").getAttribute("data-ahora-servidor")) !==
      anclaAntes,
  );
  check(
    "⭐⭐ la card APARECE al cruzar `abreEn`, SIN recargar (timer a la frontera)",
    await espera(
      async () => (await cardDe(pendientes(pg), BIOLOGIA).count()) === 1,
      Math.max(2_000, abre - Date.now() + 8_000),
    ),
  );
  const cardBio = cardDe(pendientes(pg), BIOLOGIA);
  const textoBio = ((await cardBio.textContent()) ?? "").replace(/\s+/g, " ");
  check(
    "la card trae duración y número de preguntas (read-models de la asignación)",
    /\d+ (h|min).*·.*\d+ pregunta/.test(textoBio),
    textoBio.slice(0, 90),
  );
  check(
    "el deadline se formatea como el servidor (réplica de `fechaHoraMx`)",
    textoBio.includes(fechaHoraEsperada(abre + 5 * DIA)),
  );

  // ── §4 · Iniciar el simulacro ─────────────────────────────────────────────
  console.log("\n4 · Comenzar");
  await cardBio.getByRole("button", { name: "Comenzar" }).click();
  await pg.waitForURL(/\/examen\//, { timeout: 20_000 });
  await espera(async () => (await pg.locator("[data-player]").count()) === 1, 20_000);
  const intentoUrl = pg.url().split("/examen/")[1];
  check("⭐ la BottomNav NO existe en modo examen", (await pg.locator("nav a[href='/inicio']").count()) === 0);
  check("⭐ «Anterior» está deshabilitado en la pregunta 1",
    await pg.locator('[data-nav="anterior"]').isDisabled());
  check("arranca en la pregunta 1",
    (await pg.locator("[data-player]").getAttribute("data-pregunta")) === "1");
  const tokenFer = await tokenDe(pg);
  const convexFer = clienteConvex(tokenFer);
  const res1 = await convexFer.query("player:resultado", { intentoId: intentoUrl });
  check("⭐ el intento nace como DIAGNÓSTICO (numeroIntento 1)",
    (await convexFer.query("player:intento", { intentoId: intentoUrl }))?.numeroIntento === 1,
    JSON.stringify(res1)?.slice(0, 80));

  // ── §5 · Autosave y CURSOR durable ────────────────────────────────────────
  // A partir de aquí el escenario es SG2: «Módulo Biología 1» tiene UNA pregunta (perfecto
  // para el testigo de la lista, inútil para navegar). SG2 trae 9 y su ventana `esteMes`
  // de índice ≥3 está SIEMPRE abierta, así que además ejercita el camino del REPASO.
  console.log("\n5 · Autoguardado y reanudación (repaso de 9 preguntas)");
  await pg.goto(`${BASE}/examenes`);
  await espera(async () => (await completados(pg).count()) > 0, 20_000);
  await cardDe(completados(pg), SG2).locator('[data-cta="repasar"]').click();
  await pg.waitForURL(/\/examen\//, { timeout: 20_000 });
  await espera(async () => (await pg.locator("[data-player]").count()) === 1, 20_000);
  const intentoSg2 = pg.url().split("/examen/")[1];
  const totalSg2 = Number(
    (await pg.locator("[data-abrir-mapa]").getAttribute("aria-label"))?.match(/de (\d+)/)?.[1],
  );
  check("el repaso abre un examen de varias preguntas", totalSg2 >= 3, `N=${totalSg2}`);

  await pg.locator('[role="radio"]').first().click();
  check(
    "«✓ Respuesta guardada» tras contestar (autoguardado al momento)",
    await espera(async () =>
      ((await pg.locator("[data-guardado]").textContent()) ?? "").includes("Respuesta guardada"),
    ),
  );

  // ── Caso «contestar SIN moverse» ──────────────────────────────────────────
  // El más común y el que se rompía: sin cursor inicial persistido, reabrir mandaba a la
  // «primera sin responder» —la 2—, que NO es donde se quedó.
  await ctxAlumna.close();
  const ctxVuelta = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pgVuelta = await ctxVuelta.newPage();
  const esperaVuelta = poller(pgVuelta);
  await login(pgVuelta, FERNANDA, /\/inicio/);
  await pgVuelta.goto(`${BASE}/examen/${intentoSg2}`);
  await esperaVuelta(async () => (await pgVuelta.locator("[data-player]").count()) === 1, 20_000);
  check(
    "⭐⭐ contestar la pregunta 1 y cerrar SIN navegar reabre en la 1 (no en la primera " +
      "sin responder, que sería la 2)",
    (await pgVuelta.locator("[data-player]").getAttribute("data-pregunta")) === "1",
    `abrió en ${await pgVuelta.locator("[data-player]").getAttribute("data-pregunta")}`,
  );
  await ctxVuelta.close();

  // ── Caso «navegar sin responder» ──────────────────────────────────────────
  const ctxNav = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pgNav = await ctxNav.newPage();
  const esperaNav = poller(pgNav);
  await login(pgNav, FERNANDA, /\/inicio/);
  await pgNav.goto(`${BASE}/examen/${intentoSg2}`);
  await esperaNav(async () => (await pgNav.locator("[data-player]").count()) === 1, 20_000);
  // Navegar a la pregunta 3 SIN responderla: «primera sin responder» sería la 2, así que
  // reabrir en la 3 solo puede venir del cursor persistido (el caso NO es vacuo).
  await pgNav.locator('[data-nav="siguiente"]').click();
  await esperaNav(async () =>
    (await pgNav.locator("[data-player]").getAttribute("data-pregunta")) === "2",
  );
  await pgNav.locator('[data-nav="siguiente"]').click();
  check(
    "⭐ la confirmación del cursor es OBSERVABLE (el examen no da por persistida la " +
      "navegación hasta que el servidor la devuelve; el timeout es generoso a propósito: " +
      "la ausencia de debounce es propiedad de código, no un SLA de CI)",
    await esperaNav(
      async () =>
        (await pgNav.locator("[data-player]").getAttribute("data-posicion-confirmada")) === "2",
      15_000,
    ),
  );
  // Cierre INMEDIATO tras la confirmación: nada de esperas que disimulen una pérdida.
  await ctxNav.close();
  const ctxAlumna2 = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg2 = await ctxAlumna2.newPage();
  const espera2 = poller(pg2);
  await login(pg2, FERNANDA, /\/inicio/);
  await pg2.goto(`${BASE}/examenes`);
  await espera2(async () => (await completados(pg2).count()) > 0, 20_000);
  const compSg2Vivo = cardDe(completados(pg2), SG2);
  check(
    "⭐⭐ con un repaso VIVO la card dice «Repaso en curso» y ofrece «Continuar» (el reloj " +
      "de ese intento corre: esconderlo sería mentir)",
    ((await compSg2Vivo.textContent()) ?? "").includes("Repaso en curso") &&
      (await compSg2Vivo.locator('[data-cta="continuar-repaso"]').count()) === 1 &&
      (await compSg2Vivo.locator('[data-cta="repasar"]').count()) === 0,
  );
  await compSg2Vivo.locator('[data-cta="continuar-repaso"]').click();
  await pg2.waitForURL(/\/examen\//, { timeout: 20_000 });
  await espera2(async () => (await pg2.locator("[data-player]").count()) === 1, 20_000);
  check(
    "⭐⭐ reabre en la pregunta 3 (la ÚLTIMA VISITADA), no en la primera sin responder",
    (await pg2.locator("[data-player]").getAttribute("data-pregunta")) === "3",
    `abrió en ${await pg2.locator("[data-player]").getAttribute("data-pregunta")}`,
  );
  await pg2.locator('[data-nav="anterior"]').click();
  await pg2.locator('[data-nav="anterior"]').click();
  check(
    "⭐ la respuesta de la pregunta 1 sobrevivió al cierre del navegador",
    await espera2(async () => (await pg2.locator('[data-seleccionada="si"]').count()) === 1),
  );

  // ── §6 · Mapa de preguntas ────────────────────────────────────────────────
  console.log("\n6 · Mapa");
  await pg2.locator("[data-abrir-mapa]").click();
  await espera2(async () => (await pg2.locator("[data-mapa]").count()) === 1);
  check("⭐ el mapa se abre desde el CONTADOR del header (affordance del diseño)", true);
  check(
    "conteo del mapa = 1 contestada · resto por contestar",
    ((await pg2.locator("[data-mapa-conteo]").textContent()) ?? "").trim() ===
      `1 contestadas · ${totalSg2 - 1} por contestar`,
    (await pg2.locator("[data-mapa-conteo]").textContent()) ?? "",
  );
  check("una celda por pregunta", (await pg2.locator("[data-celda]").count()) === totalSg2);
  check(
    "los estados de celda son exhaustivos: UNA actual y el resto sin contestar",
    (await pg2.locator('[data-celda-estado="actual"]').count()) === 1 &&
      (await pg2.locator('[data-celda-estado="sin"]').count()) === totalSg2 - 1,
    `actual ${await pg2.locator('[data-celda-estado="actual"]').count()} · sin ${await pg2.locator('[data-celda-estado="sin"]').count()}`,
  );
  await pg2.locator("[data-celda]").nth(4).click();
  await pg2.locator("[data-mapa-ir]").click();
  check(
    "«Ir a la pregunta» navega a la elegida",
    await espera2(async () =>
      (await pg2.locator("[data-player]").getAttribute("data-pregunta")) === "5",
    ),
  );

  // ── §6b · Teclado, ampliación y desconexión ───────────────────────────────
  console.log("\n6b · Teclado del radiogroup, imagen y conexión");
  await pg2.locator('[data-nav="anterior"]').click();
  await espera2(async () =>
    (await pg2.locator("[data-player]").getAttribute("data-pregunta")) === "4",
  );
  // Patrón ARIA: la flecha mueve selección Y FOCO (si solo moviera la selección, el foco
  // quedaría en un elemento que acaba de volverse `tabIndex=-1`).
  await pg2.locator('[role="radio"]').first().focus();
  await pg2.keyboard.press("ArrowDown");
  await pg2.waitForTimeout(600);
  const focoEnSegunda = await pg2.evaluate(() => {
    const opciones = [...document.querySelectorAll('[role="radio"]')];
    return opciones.indexOf(document.activeElement);
  });
  check(
    "⭐ ArrowDown en el radiogroup mueve la SELECCIÓN y el FOCO a la siguiente opción",
    focoEnSegunda === 1 &&
      (await pg2.locator('[role="radio"][data-seleccionada="si"]').nth(0).getAttribute("data-opcion")) === "B",
    `foco en índice ${focoEnSegunda}`,
  );

  // Ampliación de imagen: solo si el examen trae alguna (el fixture puede no tenerla en
  // ESTE examen). Se recorre el mapa buscándola; si no hay, se dice — no se finge.
  let hayImagen = false;
  for (;;) {
    if ((await pg2.locator("[data-ampliar]").count()) > 0) {
      hayImagen = true;
      break;
    }
    const actual = Number(
      await pg2.locator("[data-player]").getAttribute("data-pregunta"),
    );
    // ⚠️ Nunca se pulsa «Siguiente» en la ÚLTIMA: ahí abre la confirmación de envío y su
    // overlay bloquearía el resto de la sección.
    if (actual >= totalSg2) break;
    await pg2.locator('[data-nav="siguiente"]').click();
    await espera2(
      async () =>
        Number(await pg2.locator("[data-player]").getAttribute("data-pregunta")) ===
        actual + 1,
    );
  }
  if (hayImagen) {
    await pg2.locator("[data-ampliar]").first().click();
    check(
      "⭐ «Ampliar» abre de verdad la imagen (botón, no un texto decorativo)",
      await espera2(async () => (await pg2.locator("[data-imagen-ampliada]").count()) === 1),
    );
    await pg2.keyboard.press("Escape");
    check(
      "…y cierra con Escape",
      await espera2(async () => (await pg2.locator("[data-imagen-ampliada]").count()) === 0),
    );
  } else {
    console.log("  (sin reactivos con imagen en este examen: la ampliación queda a revisión de código)");
  }

  // Desconexión SOSTENIDA → overlay; reconexión → se puede continuar.
  await ctxAlumna2.setOffline(true);
  check(
    "⭐ una desconexión sostenida pinta «Perdiste conexión» con la pregunta en curso",
    await espera2(
      async () => (await pg2.locator('[data-terminal="conexion"]').count()) === 1,
      20_000,
    ),
  );
  await ctxAlumna2.setOffline(false);
  check(
    "⭐ al reconectar, «Continuar» vuelve a habilitarse",
    await espera2(
      async () =>
        (await pg2.locator("[data-terminal-cta]").count()) === 1 &&
        !(await pg2.locator("[data-terminal-cta]").isDisabled()),
      20_000,
    ),
  );
  await pg2.locator("[data-terminal-cta]").click();
  check(
    "…y el examen sigue exactamente donde estaba",
    await espera2(async () => (await pg2.locator("[data-player]").count()) === 1),
  );

  // ── §7 · Testigo de TIEMPO del player ─────────────────────────────────────
  console.log("\n7 · Cronómetro: umbral de 5 minutos y cero");
  const limiteAntes = await pg2.locator("[data-player]").getAttribute("data-limite");
  await correrConvex("seed:envejecerIntento", {
    confirmar: "SOLO_DEV",
    correo: FERNANDA,
    examen: SG2,
    msRestantes: ALERTA_MS + 10_000,
  });
  check(
    "⭐ anti-vacuidad: el límite del intento cambió (entrega reactiva del crudo)",
    await espera2(async () =>
      (await pg2.locator("[data-player]").getAttribute("data-limite")) !== limiteAntes,
    20_000),
  );
  const limiteNuevo = Number(await pg2.locator("[data-player]").getAttribute("data-limite"));
  check(
    "⭐⭐ al cruzar los 5 minutos aparecen el banner y el chip naranja",
    await espera2(
      async () =>
        (await pg2.locator("[data-banner-5min]").count()) === 1 &&
        (await pg2.locator('[role="timer"][data-alerta="si"]').count()) === 1,
      Math.max(2_000, limiteNuevo - ALERTA_MS - Date.now() + 8_000),
    ),
  );
  // ⭐⭐ La transición del cierre por tiempo en DOS FASES — la corrección del Mayor 2,
  // demostrada de forma DISCRIMINANTE. Se corta la red ANTES de cruzar el cero: entonces
  // el auto-envío del cliente queda encolado y `player.intento` no se actualiza, así que
  // la terminal se queda en su fase PENDIENTE. La implementación anterior —que afirmaba
  // «se envió» al instante, por el reloj local— fallaría estas aserciones.
  await correrConvex("seed:envejecerIntento", {
    confirmar: "SOLO_DEV",
    correo: FERNANDA,
    examen: SG2,
    msRestantes: 8_000,
  });
  // Esperar a que el nuevo límite se acerque, y cortar la red JUSTO antes del cruce.
  await espera2(async () => {
    const l = Number(await pg2.locator("[data-player]").getAttribute("data-limite"));
    return l < limiteNuevo && l - Date.now() < 6_000;
  }, 20_000);
  await ctxAlumna2.setOffline(true);
  check(
    "⭐⭐ FASE 1 · al cruzar el CERO la terminal está PENDIENTE de confirmación: «Estamos " +
      "entregando…» con el CTA DESHABILITADO (no afirma el envío por el reloj local)",
    await espera2(
      async () =>
        (await pg2.locator('[data-terminal="tiempo"][data-pendiente="si"]').count()) === 1 &&
        (await pg2.locator("[data-terminal-cta]").isDisabled()) &&
        ((await pg2.locator('[data-terminal="tiempo"]').textContent()) ?? "").includes(
          "Estamos entregando",
        ),
      20_000,
    ),
  );
  // Restaurar la red: la mutation encolada llega (o el job durable ya cerró) → el
  // read-model pasa a `enviado` → la terminal transiciona a su copy DEFINITIVO.
  await ctxAlumna2.setOffline(false);
  check(
    "⭐⭐ FASE 2 · solo cuando el READ-MODEL confirma el envío aparece «se envió " +
      "automáticamente» y el CTA se HABILITA",
    await espera2(
      async () =>
        (await pg2.locator('[data-terminal="tiempo"][data-pendiente="no"]').count()) === 1 &&
        !(await pg2.locator("[data-terminal-cta]").isDisabled()) &&
        ((await pg2.locator('[data-terminal="tiempo"]').textContent()) ?? "").includes(
          "se envió automáticamente",
        ),
      30_000,
    ),
  );
  const convexFer2 = clienteConvex(await tokenDe(pg2));
  check(
    "el intento quedó ENVIADO con forma de cierre «tiempo_agotado»",
    await (async () => {
      for (let i = 0; i < 60; i++) {
        const r = await convexFer2.query("player:resultado", { intentoId: intentoSg2 });
        if (r && r.problema === null) return r.formaCierre === "tiempo_agotado";
        await pg2.waitForTimeout(250);
      }
      return false;
    })(),
  );

  // ── §8 · CIERRE DURABLE con el navegador cerrado ──────────────────────────
  console.log("\n8 · El servidor cierra el intento aunque nadie mire");
  await pg2.goto(`${BASE}/examenes`);
  await espera2(async () => (await completados(pg2).count()) > 0, 20_000);
  await cardDe(completados(pg2), SG2).locator('[data-cta="repasar"]').click();
  await pg2.waitForURL(/\/examen\//, { timeout: 20_000 });
  const intentoDurable = pg2.url().split("/examen/")[1];
  const tokenDurable = await tokenDe(pg2);
  await correrConvex("seed:envejecerIntento", {
    confirmar: "SOLO_DEV",
    correo: FERNANDA,
    examen: SG2,
    msRestantes: 6_000,
  });
  await ctxAlumna2.close(); // ⚠️ NADIE mirando: ni pestaña, ni contexto, ni cliente
  const convexDurable = clienteConvex(tokenDurable);
  let cerradoSolo = false;
  for (let i = 0; i < 60; i++) {
    const r = await convexDurable.query("player:resultado", { intentoId: intentoDurable });
    if (r && r.problema === null && r.formaCierre === "tiempo_agotado") {
      cerradoSolo = true;
      break;
    }
    await new Promise((s) => setTimeout(s, 500));
  }
  check(
    "⭐⭐ el intento se entregó SOLO al vencer, con el navegador CERRADO (cierre durable)",
    cerradoSolo,
  );

  // ── §9 · Envío MANUAL, confirmación y puntaje exacto ──────────────────────
  console.log("\n9 · Envío manual y puntaje exacto");
  const ctxAlumna3 = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pg3 = await ctxAlumna3.newPage();
  const espera3 = poller(pg3);
  // Interceptor del WebSocket de Convex: cuando `rechazarEnvio` está activo, la mutation
  // `player:enviar` recibe una respuesta de ERROR sin llegar al servidor. Es un rechazo
  // CONTROLADO y determinista (un `context.setOffline` solo ENCOLA la mutation; Convex
  // reintenta hasta tener éxito y nunca rechaza). Todo lo demás pasa intacto.
  let rechazarEnvio = false;
  await pg3.routeWebSocket(/convex/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (rechazarEnvio && typeof m === "string") {
        try {
          const msg = JSON.parse(m);
          if (msg.type === "Mutation" && msg.udfPath === "player:enviar") {
            ws.send(
              JSON.stringify({
                type: "MutationResponse",
                requestId: msg.requestId,
                success: false,
                result: "Fallo de red simulado (E2E)",
                logLines: [],
              }),
            );
            return;
          }
        } catch {
          /* no es JSON: pasa intacto */
        }
      }
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await login(pg3, FERNANDA, /\/inicio/);
  const convexFer3 = clienteConvex(await tokenDe(pg3));
  // Promedio del panel ANTES de los repasos (oráculo REAL de la analítica).
  const pgAdminPanel = await ctxAdmin.newPage();
  await pgAdminPanel.goto(`${BASE}/admin`);
  const convexAdmin = clienteConvex(await tokenDe(pgAdminPanel));
  const panelAntes = await convexAdmin.query("panel:resumen", {});
  // Desde LUI-30 los promedios salieron de `resumen`: se piden por fila (promedioDe).
  const promediosDe = async (panel) =>
    Promise.all(
      panel.ultimosExamenes.map((e) =>
        convexAdmin.query("panel:promedioDe", { asignacionId: e.id }),
      ),
    );
  const promediosAntes = await promediosDe(panelAntes);

  const lista0 = await convexFer3.query("player:misExamenes", {});
  await pg3.goto(`${BASE}/examenes`);
  await espera3(async () => (await completados(pg3).count()) > 0, 20_000);
  await cardDe(completados(pg3), SG2).locator('[data-cta="repasar"]').click();
  await pg3.waitForURL(/\/examen\//, { timeout: 20_000 });
  await espera3(async () => (await pg3.locator("[data-player]").count()) === 1, 20_000);
  const intentoManual = pg3.url().split("/examen/")[1];
  // Contestar SOLO la primera —y a PROPÓSITO MAL— para que el puntaje sea EXACTO y
  // conocido: 0 aciertos ⇒ 700 justo. Cuál es la correcta se pregunta con la sesión de
  // ADMIN (`examenes.obtener`, tras `requireStaff`); la alumna nunca la recibe, que es
  // justo lo que §11 comprueba.
  const examenIdSg2 = lista0.filas.find((f) => f.titulo === SG2)?.examenId ?? null;
  const detalleExamen = await convexAdmin.query("examenes:obtener", {
    examenId: examenIdSg2,
  });
  const primerItem = detalleExamen.items.find((it) => !it.faltante);
  const indiceIncorrecta = primerItem.opciones.findIndex(
    (o) => o.id !== primerItem.opcionCorrecta,
  );
  await pg3.locator('[role="radio"]').nth(indiceIncorrecta).click();
  await espera3(async () =>
    ((await pg3.locator("[data-guardado]").textContent()) ?? "").includes("Respuesta guardada"),
  );
  await pg3.locator("[data-abrir-mapa]").click();
  await espera3(async () => (await pg3.locator("[data-mapa]").count()) === 1);
  await pg3.locator("[data-celda]").nth(totalSg2 - 1).click();
  await pg3.locator("[data-mapa-ir]").click();
  await espera3(async () =>
    (await pg3.locator("[data-player]").getAttribute("data-pregunta")) === String(totalSg2),
  );
  await pg3.locator('[data-nav="siguiente"]').click();
  await espera3(async () => (await pg3.locator("[data-resumen-envio]").count()) === 1);
  check(
    "⭐ el resumen de confirmación trae los números EXACTOS y el plural correcto",
    ((await pg3.locator("[data-resumen-envio]").textContent()) ?? "").trim() ===
      `1 de ${totalSg2} contestadas. Las ${totalSg2 - 1} sin responder cuentan como incorrectas.`,
    (await pg3.locator("[data-resumen-envio]").textContent()) ?? "",
  );
  await pg3.locator("[data-revisar-pendientes]").click();
  await espera3(async () => (await pg3.locator("[data-mapa]").count()) === 1);
  check(
    "⭐ «Revisar pendientes» abre el mapa FILTRADO a las sin contestar",
    (await pg3.locator("[data-celda]").count()) === totalSg2 - 1,
    `${await pg3.locator("[data-celda]").count()} celdas de ${totalSg2 - 1}`,
  );
  await pg3.keyboard.press("Escape");
  await espera3(async () => (await pg3.locator("[data-mapa]").count()) === 0);
  await pg3.locator('[data-nav="siguiente"]').click();
  await espera3(async () => (await pg3.locator("[data-enviar-ahora]").count()) === 1);

  // ⭐⭐ RECHAZO CONTROLADO del envío manual: se fuerza el fallo, se pulsa «Enviar ahora»
  // y se comprueba que la alumna PERMANECE en el player con un error VISIBLE — jamás en
  // una pantalla de resultados que contestaría «todavía está en curso».
  rechazarEnvio = true;
  await pg3.locator("[data-enviar-ahora]").click();
  check(
    "⭐⭐ un envío manual RECHAZADO deja a la alumna EN el player (la URL sigue en /examen/) " +
      "con un error observable, sin navegar a un falso resultado",
    await espera3(
      async () =>
        pg3.url().includes("/examen/") &&
        (await pg3.locator("[data-error-envio]").count()) === 1,
      15_000,
    ),
    pg3.url(),
  );
  // Reintento: la MISMA acción vuelve a llamar la mutation (no un no-op) y ahora sí navega.
  rechazarEnvio = false;
  await pg3.locator("[data-enviar-ahora]").click();
  await pg3.waitForURL(/\/resultado$/, { timeout: 20_000 });
  check(
    "⭐ el reintento re-ejecuta la mutation y navega al resultado",
    pg3.url().includes("/resultado"),
  );
  await espera3(async () => (await pg3.locator("[data-resultado-puntaje]").count()) === 1, 20_000);
  const puntajeUi = Number(await pg3.locator("[data-resultado-puntaje]").textContent());
  const detalle = await convexFer3.query("player:resultado", { intentoId: intentoManual });
  check(
    "⭐⭐ el puntaje es EXACTAMENTE 700: una respuesta INCORRECTA y el resto sin " +
      "contestar dan 0 aciertos sobre N (700 + 0×600/N)",
    puntajeUi === puntajeEsperado(0, totalSg2) && puntajeUi === 700,
    `ui ${puntajeUi} · esperado ${puntajeEsperado(0, totalSg2)} con N=${totalSg2}`,
  );
  check("el cierre manual se etiqueta «manual»", detalle?.formaCierre === "manual");
  check(
    "la pantalla dice cuándo se contestó",
    ((await pg3.textContent("body")) ?? "").includes("Contestado el"),
  );
  check(
    "⭐ el resultado de un repaso se rotula «— repaso N» con su aviso oficial",
    ((await pg3.textContent("body")) ?? "").includes(`${SG2} — repaso `) &&
      ((await pg3.textContent("body")) ?? "").includes(
        "tu resultado oficial es el del primer intento",
      ),
  );

  // ── §10 · REPASOS ILIMITADOS y analítica intacta (LUI-104) ────────────────
  console.log("\n10 · Repasos y analítica");
  const lista = await convexFer3.query("player:misExamenes", {});
  const asignacionSg2 = lista.filas.find((f) => f.titulo === SG2)?.asignacionId ?? null;
  const numeros = [];
  for (let k = 0; k < 2; k++) {
    const { intentoId } = await convexFer3.mutation("player:iniciarIntento", {
      asignacionId: asignacionSg2,
    });
    const info = await convexFer3.query("player:intento", { intentoId });
    numeros.push(info?.numeroIntento ?? null);
    await convexFer3.mutation("player:enviar", { intentoId });
  }
  check(
    "⭐ cada repaso numera de UNO en UNO y siempre por encima del diagnóstico",
    numeros.length === 2 &&
      numeros[1] === numeros[0] + 1 &&
      numeros[0] > 1,
    numeros.join(","),
  );
  const panelDespues = await convexAdmin.query("panel:resumen", {});
  const promediosDespues = await promediosDe(panelDespues);
  check(
    "⭐⭐ varias repeticiones NO mueven el promedio del panel (regla del primer intento)",
    promediosAntes.length > 0 &&
      JSON.stringify(promediosDespues.map((r) => r?.valor)) ===
        JSON.stringify(promediosAntes.map((r) => r?.valor)),
    `antes ${JSON.stringify(promediosAntes.map((r) => r?.valor))} · después ${JSON.stringify(promediosDespues.map((r) => r?.valor))}`,
  );
  check(
    "ningún promedio se reporta incompleto con el fixture",
    promediosDespues.length > 0 &&
      promediosDespues.every((r) => r?.incompleto === false),
  );
  await pg3.goto(`${BASE}/examenes`);
  await espera3(async () => (await completados(pg3).count()) > 0, 20_000);
  const compFinal = cardDe(completados(pg3), SG2);
  const textoFinal = ((await compFinal.textContent()) ?? "").replace(/\s+/g, " ");
  check(
    "⭐ tras repasar, el badge «Repaso realizado» convive con la acción (ilimitados en ventana)",
    textoFinal.includes("Repaso realizado") &&
      (await compFinal.locator('[data-cta="repasar"]').count()) === 1,
  );
  check(
    "⭐⭐ el puntaje de la card sigue siendo el del PRIMER intento (el del fixture)",
    textoFinal.includes(String(espSg2.puntaje)),
    `card «${textoFinal.slice(0, 100)}» · esperado ${espSg2.puntaje}`,
  );

  // ── §11 · Authz y fuga de la respuesta correcta ───────────────────────────
  console.log("\n11 · Autorización y payload del examen");
  const ctxAna = await navegador.newContext();
  const pgAna = await ctxAna.newPage();
  await login(pgAna, ANA, /\/inicio/);
  const convexAna = clienteConvex(await tokenDe(pgAna));
  check(
    "⭐ el intento de otra alumna responde `null` (cero oráculo de existencia)",
    (await convexAna.query("player:intento", { intentoId: intentoManual })) === null &&
      (await convexAna.query("player:posicionDe", { intentoId: intentoManual })) === null,
  );
  const rechaza = async (fn, args) => {
    try {
      await convexAna.mutation(fn, args);
      return false;
    } catch {
      return true;
    }
  };
  // El payload PROPIO de ana: el examen que puede jugar. Se resuelve ANTES del rechazo
  // porque de aquí sale un reactivoId VÁLIDO para la prueba de `responder`.
  const listaAna = await convexAna.query("player:misExamenes", {});
  const filaAna = listaAna.filas.find((f) => f.enviados.length > 0 || f.enCurso);
  // Un intento EN CURSO de ana para tener un payload con `items` (los enviados devuelven
  // `{problema:"enviado"}`, sin items); si no hay, se inicia uno sobre una asignación ABIERTA
  // suya (una futura daría «todavía no abre»).
  let intentoAna = filaAna?.enCurso?.intentoId ?? null;
  if (!intentoAna) {
    const ahoraAna = Date.now();
    const asignAna =
      listaAna.filas.find(
        (f) => f.abreEn <= ahoraAna && ahoraAna < f.cierraEn,
      )?.asignacionId ?? null;
    if (asignAna) {
      intentoAna = (
        await convexAna.mutation("player:iniciarIntento", { asignacionId: asignAna })
      ).intentoId;
    }
  }
  const propio = intentoAna
    ? await convexAna.query("player:intento", { intentoId: intentoAna })
    : null;
  // ⚠️ Un reactivoId VÁLIDO (del propio examen de ana): así el rechazo de `responder` sobre
  // el intento AJENO ocurre por la guarda de PROPIEDAD, no por la validación de args
  // —mandar un id de otra tabla moriría antes de llegar a la guarda y no probaría el authz—.
  const reactivoValido =
    propio && propio.problema === null ? propio.items[0]?.id : null;
  check(
    "⭐ responder / enviar / marcarPosicion sobre un intento ajeno se RECHAZAN (responder " +
      "con un reactivoId VÁLIDO, para que el rechazo sea del authz y no de la validación de args)",
    (await rechaza("player:enviar", { intentoId: intentoManual })) &&
      (await rechaza("player:marcarPosicion", { intentoId: intentoManual, indice: 0 })) &&
      reactivoValido !== null &&
      (await rechaza("player:responder", {
        intentoId: intentoManual,
        reactivoId: reactivoValido,
        opcionElegida: "a",
      })),
    `reactivoValido=${reactivoValido}`,
  );
  const crudo = JSON.stringify(propio ?? {});
  check(
    "⭐⭐ el payload del examen NO contiene `opcionCorrecta`, `retroalimentacion` ni `correcta`",
    !crudo.includes("opcionCorrecta") &&
      !crudo.includes("retroalimentacion") &&
      !crudo.includes('"correcta"'),
  );
  const respAna = intentoAna
    ? await convexAna.query("player:misRespuestas", { intentoId: intentoAna })
    : null;
  check(
    "⭐ tampoco viaja la calificación de cada respuesta",
    !JSON.stringify(respAna ?? {}).includes("correcta"),
  );

  // ── §12 · Alumna SIN grupo ────────────────────────────────────────────────
  console.log("\n12 · Una alumna sin grupo no ve lo ajeno");
  // Sin el guard de rama, el `eq("grupoId", undefined)` de Convex —que selecciona los
  // documentos SIN el campo— le devolvería a una alumna sin grupo TODAS las asignaciones
  // individuales de la institución, que son justamente las que no tienen `grupoId`.
  const alumnas = await convexAdmin.query("alumnos:listar", {});
  const anaFila = alumnas.find((u) => u.correo === ANA) ?? null;
  const ferFila = alumnas.find((u) => u.correo === FERNANDA) ?? null;
  const examenesAdmin = await convexAdmin.query("examenes:listar", {});
  const bioId = examenesAdmin.find((e) => e.titulo === BIOLOGIA)?.id ?? null;
  if (anaFila && ferFila && bioId) {
    const abre2 = Date.now() - HORA;
    await convexAdmin.mutation("asignaciones:asignar", {
      examenId: bioId,
      destino: { tipo: "alumnos", alumnoIds: [anaFila.userId] },
      abreEn: abre2,
      cierraEn: abre2 + 3 * DIA,
    });
    const individualDeAna = (await convexAna.query("player:misExamenes", {})).filas.filter(
      (f) => f.titulo === BIOLOGIA,
    );
    check(
      "la asignación INDIVIDUAL sí le llega a su destinataria",
      individualDeAna.length >= 1,
    );
    // Fernanda se queda sin grupo (la mutation de alumnos acepta `grupoId` opcional).
    await convexAdmin.mutation("alumnos:actualizar", {
      perfilId: ferFila.id,
      nombre: ferFila.nombre,
      apellidos: ferFila.apellidos,
    });
    const listaSinGrupo = await convexFer3.query("player:misExamenes", {});
    check(
      "⭐⭐ sin grupo, su lista queda VACÍA: no hereda las asignaciones individuales ajenas",
      listaSinGrupo.filas.length === 0,
      `${listaSinGrupo.filas.length} filas: ${listaSinGrupo.filas.map((f) => f.titulo).join(", ")}`,
    );
    // Restaurar su grupo (la pizarra del finally también lo haría, pero el resto de la
    // suite no debe correr con una alumna mutilada).
    if (ferFila.grupoId) {
      await convexAdmin.mutation("alumnos:actualizar", {
        perfilId: ferFila.id,
        nombre: ferFila.nombre,
        apellidos: ferFila.apellidos,
        grupoId: ferFila.grupoId,
      });
    }
    check(
      "con su grupo de vuelta, la lista se repuebla",
      (await convexFer3.query("player:misExamenes", {})).filas.length > 0,
    );
  } else {
    check("⭐⭐ escenario de alumna sin grupo preparado", false, "faltan ids del fixture");
  }

  // ── §13 · Idempotencia ────────────────────────────────────────────────────
  console.log("\n13 · Idempotencia de las mutations");
  if (asignacionSg2) {
    const a = await convexFer3.mutation("player:iniciarIntento", { asignacionId: asignacionSg2 });
    const b = await convexFer3.mutation("player:iniciarIntento", { asignacionId: asignacionSg2 });
    check("⭐ iniciar dos veces devuelve el MISMO intento (jamás duplica)",
      a.intentoId === b.intentoId && b.reanudado === true);
    const e1 = await convexFer3.mutation("player:enviar", { intentoId: a.intentoId });
    const e2 = await convexFer3.mutation("player:enviar", { intentoId: a.intentoId });
    check("⭐ enviar dos veces no recalcula: el segundo dice `yaEnviado` con el mismo puntaje",
      e2.yaEnviado === true && e1.puntaje === e2.puntaje);
  } else {
    check("⭐ idempotencia comprobable", false, "sin asignación de referencia");
  }

  // ── §14 · Solo futuras ────────────────────────────────────────────────────
  console.log("\n14 · Solo asignaciones futuras");
  // El estado «tiene simulacros, pero ninguno empezó»: si la pantalla dijera «Aún no
  // tienes simulacros asignados» estaría MINTIENDO. Se construye un grupo temporal con
  // UNA asignación futura y se mueve a fernanda ahí (su grupo real tiene historial).
  // `grupos.crear` exige al menos un instructor (regla de LUI-12): se usa el primero
  // de la institución — el grupo se cierra y se borra al final.
  const instructores = await convexAdmin.query("instructores:listar", {});
  const grupoTemp = await convexAdmin.mutation("grupos:crear", {
    nombre: MARCA_E2E,
    ciclo: "2026-B",
    turno: "matutino",
    instructorIds: [instructores[0].id],
  });
  const ferAhora = (await convexAdmin.query("alumnos:listar", {})).find(
    (u) => u.correo === FERNANDA,
  );
  const grupoOriginal = ferAhora?.grupoId ?? null;
  await convexAdmin.mutation("alumnos:actualizar", {
    perfilId: ferAhora.id,
    nombre: ferAhora.nombre,
    apellidos: ferAhora.apellidos,
    grupoId: grupoTemp.grupoId,
  });
  const abreFutura = Date.now() + 3 * DIA;
  await convexAdmin.mutation("asignaciones:asignar", {
    examenId: bioId,
    destino: { tipo: "grupos", grupoIds: [grupoTemp.grupoId] },
    abreEn: abreFutura,
    cierraEn: abreFutura + 5 * DIA,
  });
  await pg3.goto(`${BASE}/examenes`);
  await espera3(async () => (await pg3.locator("[data-mis-examenes]").count()) === 1, 20_000);
  check(
    "⭐⭐ con SOLO futuras se muestra «No tienes simulacros disponibles por el momento» " +
      "y NUNCA el vacío de «aún no tienes asignados»",
    await espera3(
      async () =>
        (await pg3.locator("[data-solo-futuras]").count()) === 1 &&
        (await pg3.locator("[data-vacio]").count()) === 0,
      15_000,
    ),
  );
  check(
    "…y la futura sigue sin listarse como card",
    (await pendientes(pg3).count()) === 0 &&
      (await completados(pg3).count()) === 0 &&
      (await vencidos(pg3).count()) === 0,
  );
  // Restaurar: grupo original y grupo temporal CERRADO (un activo de más movería el
  // oráculo de «grupos activos» de otras suites).
  if (grupoOriginal) {
    await convexAdmin.mutation("alumnos:actualizar", {
      perfilId: ferAhora.id,
      nombre: ferAhora.nombre,
      apellidos: ferAhora.apellidos,
      grupoId: grupoOriginal,
    });
  }
  await convexAdmin.mutation("grupos:cambiarEstado", {
    grupoId: grupoTemp.grupoId,
    activo: false,
  });
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e?.stack ?? e}`);
} finally {
  console.log("\nRestaurando el fixture…");
  // Limpiezas INDEPENDIENTES: cada una se intenta aunque la anterior falle, y su fallo
  // SUMA — un verde con la pizarra sucia envenenaría a la siguiente suite.
  for (const [etiqueta, fn] of [
    ["limpiarGruposE2E", "seed:limpiarGruposMarcados"],
    ["limpiarContenidoDemo", "seed:limpiarContenidoDemo"],
    ["cargarDatosDePrueba", "seed:cargarDatosDePrueba"],
    ["credencialesDemo", "seedAuth:credencialesDemo"],
  ]) {
    try {
      await correrConvex(fn);
    } catch (e) {
      fallos++;
      console.error(`  ✘ restauración «${etiqueta}»: ${e.message}`);
    }
  }
  try {
    const jobs = jsonDe(await correrConvex("seed:contarJobsPendientes"));
    console.log(
      `  jobs de cierre pendientes: ${jobs.pendientes} (huérfanos ${jobs.huerfanos} · en curso vivos ${jobs.enCursoVivos})`,
    );
    // COTA CONCRETA (no delta cero: las entregas legítimas dejan jobs futuros que aún no
    // dispararon). Todo pendiente es de un intento vivo o un huérfano que hará no-op, y
    // los huérfanos no pueden exceder los intentos que ESTA corrida creó.
    check(
      "el trabajo residual del scheduler queda dentro de la cota (delta de huérfanos ≤ " +
        "intentos que crea la suite; jamás se exige delta cero: las entregas legítimas " +
        "dejan jobs futuros que aún no dispararon)",
      jobs.pendientes <= jobs.enCursoVivos + jobs.huerfanos &&
        jobs.huerfanos - jobsAlInicio <= MAX_INTENTOS_DE_LA_CORRIDA,
      `huérfanos ${jobsAlInicio} → ${jobs.huerfanos} (delta ${jobs.huerfanos - jobsAlInicio}, tope ${MAX_INTENTOS_DE_LA_CORRIDA}) · pendientes ${jobs.pendientes} · vivos ${jobs.enCursoVivos}`,
    );
  } catch (e) {
    fallos++;
    console.error(`  ✘ no se pudo contar jobs: ${e.message}`);
  }
  if (navegador) await navegador.close();
  console.log("");
  console.log(`${ok} pruebas OK, ${fallos} fallos`);
  process.exit(fallos === 0 ? 0 : 1);
}
