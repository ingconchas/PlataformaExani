/**
 * E2E de LUI-22 — Asignación y calendarización de examen (Entrega B, pantalla 19).
 *
 * CREA y CANCELA asignaciones (y cierra/reabre un grupo fixture), así que hace pizarra
 * limpia al inicio y restaura en `finally`. ⚠️ Misma BD de dev que las demás suites:
 * NUNCA correr dos a la vez. Repetible ×2: todo lo que muta se cancela en caliente, lo
 * barre la pizarra (`limpiarContenidoDemo` borra `asignaciones` completa) o converge —
 * el grupo «Nocturno E22» NO lo barre la pizarra (los grupos no son contenido) y por eso
 * §11 lo REABRE-en-vez-de-crear y lo CIERRA al final de su cuerpo; el cierre defensivo
 * adicional vive AL ENTRAR a §11 (no en `finally`: `grupos.cambiarEstado` exige sesión
 * de admin y `convex run` corre sin identidad).
 *
 * Fixture objetivo: «Módulo Biología 1» — el ÚNICO publicado sin asignaciones NI
 * intentos del seed, con reactivo exclusivo («…membrana celular…») hoy LIBRE. Oráculos
 * del seed: alumnos ACTIVOS por grupo — Matutino A = 4 (Santiago INACTIVO), Vespertino
 * B = 2, Sabatino C = 2, total 8; cristian instruye Matutino A y Sabatino C (NO
 * Vespertino B — ahí van diana y rubén); carlos instruye Matutino A y Sabatino C;
 * diana instruye Vespertino B y Sabatino C; la asignación sembrada de SG3 (futura,
 * `presentan: []`) la creó CRISTIAN (`creadoPor` del seed = INSTRUCTORES[0]).
 *
 * Aserciones DISCRIMINANTES (⭐ — cada una se demostró en ROJO):
 *  · §1 «8 alumnos» en «Todos los grupos» — 9 = contó a Santiago (filtro `activo`).
 *  · §2 el conteo dinámico suma `alumnosCount` de los grupos elegidos, con singular.
 *  · §3 invertida/degenerada/PASADA bloquean con el copy EXACTO del servidor
 *    (`MSG_VENTANA_*` compartidos) — la pasada caza validar solo forma y orden.
 *  · §4 la fila-alumno compromete: candado del banco + despublicar IMPEDIDO — mata una
 *    implementación con tabla aparte (compromisosDe no la vería).
 *  · §5 cancelar LIBERA: despublicar habilitado y reactivo libre otra vez.
 *  · §6 asignar RE-ejecuta validarPublicable: reactivo desactivado → rechazo del
 *    SERVIDOR con su mensaje, y NO se creó ninguna fila.
 *  · §7b el estado CRUZA la frontera con la pantalla abierta (timer del cliente) — una
 *    query que estampara el estado, o una derivación única al montar, pintaría
 *    «Programada» para siempre.
 *  · §8 el datetime-local se interpreta como reloj MX aunque el navegador esté en
 *    America/New_York — `new Date(str)` local produciría un rango corrido de día.
 *  · §9/§9b/§10 el trío creador/tercero/admin discrimina `admin ∨ creadoPor`, y la
 *    fila-alumno ajena viaja ANONIMIZADA para el instructor pero CON nombre para admin.
 *  · §11 «Todos los grupos» materializa SOLO los existentes al crearse (grupo nuevo
 *    después NO recibe), con BASELINE — jamás conteos absolutos.
 *  · §12 la lista pagina de VERDAD (primera página exacta + «Cargar más») y el orden es
 *    por `abreEn` DESC real — ventanas creadas fuera del orden de inserción cazan el
 *    `_creationTime` implícito de `by_examen`.
 *
 * Lo que la suite NO puede probar (revisión de código): rechazo API de
 * instructor→grupo ajeno / →grupo CERRADO / →«todos» / →alumno ajeno y el rechazo de
 * `cancelar` sobre asignación ajena (la UI jamás los ofrece; `convex run` no pasa
 * `requireStaff`); la guarda de intentos de `cancelar` (no hay player que fabrique un
 * intento sobre una PROGRAMADA); el orden entrada-cruda-antes-de-leer y las cotas del
 * destino (la UI manda arreglos conformes); la cota post-collect de `todosLosGrupos`
 * (fixture de 3-4 grupos); el invariante XOR en la fila (irrepresentable por el
 * validator de args); la idempotencia de `cancelar` sobre fila ya borrada; la guarda de
 * capacidad y los estados de capacidad agotada (600 filas vía UI es impracticable — los
 * bordes viven en test-asignacion); el ANCLAJE a `ahoraServidor` (§7b prueba el TIMER;
 * un `Date.now()` a secas también pasaría con el reloj de la máquina en hora); que
 * `panel.resumen` pinte «Asignación individual» (exigiría una fila-alumno aplicada
 * `esteMes` — prohibido por el oráculo de lui9).
 *
 * Requisitos: npx convex dev · npm run dev · (playwright chromium instalado).
 * Uso: node scripts/e2e-lui22.mjs   ·   E2E_HEADED=1 node scripts/e2e-lui22.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const CRISTIAN = "cristian.instructor@demo.unx.mx";
const CARLOS = "carlos.instructor@demo.unx.mx";
const DIANA = "diana.instructor@demo.unx.mx";

const EXAMEN = "Módulo Biología 1";
const SG3 = "Simulacro General 3";
const SG5 = "Simulacro General 5";
const R_MEMBRANA = "membrana celular";
const ANA = "Ana López Ramírez";
const VALERIA = "Valeria Cruz Núñez";
const GRUPO_E22 = "Nocturno E22";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const OFFSET_MX = 6 * HORA;

const MSG_INVERTIDA = "La fecha de cierre debe ser posterior a la apertura.";
const MSG_PASADA =
  "La fecha de cierre ya pasó o está demasiado cerca; elige un cierre en el futuro.";

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

async function correrConvex(fn) {
  const { code, salida } = await ejecutar("npx", [
    "convex", "run", fn, '{"confirmar":"SOLO_DEV"}',
  ]);
  if (code !== 0)
    throw new Error(`«convex run ${fn}» salió con código ${code}: ${salida.trim()}`);
}

async function pizarraLimpia() {
  await correrConvex("seed:limpiarContenidoDemo");
  await correrConvex("seed:cargarDatosDePrueba");
  await correrConvex("seedAuth:credencialesDemo");
}

/** Epoch → «YYYY-MM-DDTHH:mm» en RELOJ DE PARED MX (para llenar el datetime-local). */
function relojMx(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** Epoch al que el servidor redondea un valor de datetime-local (minuto exacto). */
function alMinuto(ts) {
  return ts - ((ts - OFFSET_MX) % MIN);
}
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
/** Réplica mínima de `rangoCortoMx` para calcular el ORÁCULO del toast en Node. */
function rangoEsperado(abreEn, cierraEn) {
  const a = new Date(abreEn - OFFSET_MX);
  const c = new Date(cierraEn - OFFSET_MX);
  const mismoAnio = a.getUTCFullYear() === c.getUTCFullYear();
  const mismoMes = mismoAnio && a.getUTCMonth() === c.getUTCMonth();
  if (mismoMes && a.getUTCDate() === c.getUTCDate())
    return `${a.getUTCDate()} de ${MESES_L[a.getUTCMonth()]}`;
  if (mismoMes)
    return `${a.getUTCDate()} al ${c.getUTCDate()} de ${MESES_L[a.getUTCMonth()]}`;
  if (mismoAnio)
    return `${a.getUTCDate()} de ${MESES_L[a.getUTCMonth()]} al ${c.getUTCDate()} de ${MESES_L[c.getUTCMonth()]}`;
  return `${a.getUTCDate()} de ${MESES_L[a.getUTCMonth()]} de ${a.getUTCFullYear()} al ${c.getUTCDate()} de ${MESES_L[c.getUTCMonth()]} de ${c.getUTCFullYear()}`;
}

console.log("\nE2E LUI-22 · pizarra limpia + credenciales…");
try {
  await pizarraLimpia();
} catch (e) {
  console.error(`\n✘ No se pudo preparar la BD de dev — ${e.message}`);
  process.exit(1);
}

const navegador = await chromium.launch({ headless: !HEADED });

// ── Helpers de página ────────────────────────────────────────────────────────
const filas = (pg) => pg.locator("tbody tr");
const filaDe = (pg, texto) => filas(pg).filter({ hasText: texto }).first();
const candadoBanco = (fila) =>
  fila.getByRole("link", { name: /abrir .* para desactivar/ });

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

/** Abre /asignar del examen desde la biblioteca (por el enlace real de la fila). */
async function abrirAsignar(pg, biblioteca, titulo) {
  await pg.goto(`${BASE}${biblioteca}`);
  const espera = poller(pg);
  await espera(async () => (await filas(pg).count()) > 0);
  await pg.getByRole("link", { name: `Asignar «${titulo}»` }).click();
  await pg.waitForURL(/\/asignar$/, { timeout: 15_000 });
  await espera(async () =>
    ((await pg.textContent("body")) ?? "").includes("¿A quién va dirigido?"),
  );
}

/** Las filas de «Asignaciones existentes» (una por Badge de estado de ventana). */
const filasExistentes = (pg) =>
  pg
    .locator("section", { hasText: "Asignaciones existentes" })
    .locator("span")
    .filter({ hasText: /^(Programada|En curso|Cerrada)$/ });

/** Selecciona un grupo en el MultiSelect (abre, elige, cierra con Escape). */
async function elegirGrupo(pg, nombre) {
  await pg.getByRole("combobox").click();
  await pg.getByRole("option", { name: new RegExp(`^${nombre}`) }).click();
  await pg.keyboard.press("Escape");
}

/** Llena la ventana. Los ids vienen del client (`asignar-apertura`/`asignar-cierre`). */
async function llenarVentana(pg, abreTs, cierraTs) {
  await pg.fill("#asignar-apertura", relojMx(abreTs));
  await pg.fill("#asignar-cierre", relojMx(cierraTs));
}

const confirmarBtn = (pg) =>
  pg.getByRole("button", { name: "Confirmar asignación" });

/** Confirma y espera el toast en la biblioteca; devuelve su texto. */
async function confirmarYLeerToast(pg, biblioteca) {
  await confirmarBtn(pg).click();
  await pg.waitForURL(new RegExp(`${biblioteca.replaceAll("/", "\\/")}$`), {
    timeout: 15_000,
  });
  const espera = poller(pg);
  await espera(async () => (await pg.getByRole("status").count()) === 1);
  return (await pg.getByRole("status").textContent()) ?? "";
}

/** Cancela la PRIMERA fila cancelable visible y espera a que el conteo baje. */
async function cancelarPrimera(pg) {
  const antes = await filasExistentes(pg).count();
  await pg
    .getByRole("button", { name: /^Cancelar la asignación de/ })
    .first()
    .click();
  await pg
    .getByRole("dialog")
    .getByRole("button", { name: "Cancelar asignación" })
    .click();
  const espera = poller(pg);
  return espera(async () => (await filasExistentes(pg).count()) === antes - 1);
}

const BIB_ADMIN = "/admin/examenes/biblioteca";
const BIB_INST = "/instructor/examenes";

try {
  const ctxAdmin = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxAdmin.newPage();
  await login(page, ADMIN, /\/admin/);
  const espera = poller(page);

  // ════ §1 · Montaje admin e hidratación ════
  console.log("\n1 · Montaje admin e hidratación");
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  check("encabezado «Asignar examen»", (await page.textContent("h1"))?.trim() === "Asignar examen");
  const cuerpo1 = (await page.textContent("body")) ?? "";
  check("card del examen: «Módulo Biología 1 — 1 reactivo»", cuerpo1.includes("Módulo Biología 1 — 1 reactivo"));
  check("badge Publicado en el card", cuerpo1.includes("Publicado"));
  check("3 destinos (admin ve «Todos los grupos»)", (await page.locator('input[type="radio"]').count()) === 3);
  check(
    "⭐ sub de «Todos los grupos» = «8 alumnos» (solo ACTIVOS)",
    cuerpo1.includes("8 alumnos"),
    "9 = contó a Santiago (inactivo); el filtro `activo` del conteo se rompió",
  );
  check("existentes vacía al arrancar", cuerpo1.includes("Este examen aún no tiene asignaciones."));

  // ════ §2 · Conteo dinámico ════
  console.log("\n2 · Conteo dinámico del destino");
  await elegirGrupo(page, "Matutino A");
  await espera(async () => ((await page.textContent("body")) ?? "").includes("recibirán este examen") || ((await page.textContent("body")) ?? "").includes("recibirá este examen"));
  check(
    "⭐ Matutino A → «4 alumnos recibirán este examen»",
    ((await page.textContent("body")) ?? "").includes("4 alumnos recibirán este examen"),
    "5 = contó a Santiago",
  );
  await elegirGrupo(page, "Vespertino B");
  await espera(async () => ((await page.textContent("body")) ?? "").includes("6 alumnos"));
  check(
    "⭐ + Vespertino B → «6 alumnos recibirán este examen» (suma)",
    ((await page.textContent("body")) ?? "").includes("6 alumnos recibirán este examen"),
  );
  // Cambio a alumnos individuales: Ana, con SINGULAR.
  await page.getByText("Alumnos individuales").click();
  await page.getByPlaceholder("Buscar alumno por nombre…").fill("Ana");
  await page.getByText(ANA).click();
  await espera(async () => ((await page.textContent("body")) ?? "").includes("1 alumno recibirá"));
  check(
    "⭐ 1 alumna → «1 alumno recibirá este examen» (singular)",
    ((await page.textContent("body")) ?? "").includes("1 alumno recibirá este examen"),
  );

  // ════ §3 · Validación de ventana EN VIVO ════
  console.log("\n3 · Validación de ventana en vivo");
  const ahora3 = Date.now();
  await llenarVentana(page, ahora3 + 2 * DIA, ahora3 + 1 * DIA);
  await espera(async () => (await page.getByText(MSG_INVERTIDA).count()) > 0);
  check(
    "⭐ invertida: copy EXACTO del servidor bajo el campo Y en Alert",
    (await page.getByText(MSG_INVERTIDA).count()) >= 2,
  );
  check("⭐ invertida: botón deshabilitado", await confirmarBtn(page).isDisabled());
  await llenarVentana(page, ahora3 + 2 * DIA, ahora3 + 2 * DIA);
  await espera(async () => (await page.getByText(MSG_INVERTIDA).count()) > 0);
  check("⭐ degenerada (cierre === apertura): sigue bloqueada", await confirmarBtn(page).isDisabled());
  await llenarVentana(page, ahora3 - 2 * DIA, ahora3 - 2 * HORA);
  await espera(async () => (await page.getByText(MSG_PASADA).count()) > 0);
  check(
    "⭐ ordenada pero PASADA: bloqueada con su copy (nacería cerrada e incancelable)",
    (await page.getByText(MSG_PASADA).count()) >= 2 && (await confirmarBtn(page).isDisabled()),
  );
  const abre4 = alMinuto(ahora3 + 2 * DIA);
  const cierra4 = alMinuto(ahora3 + 3 * DIA);
  await llenarVentana(page, abre4, cierra4);
  await espera(async () => !(await confirmarBtn(page).isDisabled()));
  check("corregida → el botón habilita", !(await confirmarBtn(page).isDisabled()));

  // ════ §4 · Asignar a UNA alumna (programada) — la fila-alumno COMPROMETE ════
  console.log("\n4 · Fila-alumno programada: toast, candado y despublicar impedido");
  const toast4 = await confirmarYLeerToast(page, BIB_ADMIN);
  check(
    "⭐ toast sobrevive a la navegación con el copy del servidor",
    toast4.includes(`Estará disponible para 1 alumno del ${rangoEsperado(abre4, cierra4)}.`),
    `toast: «${toast4}»`,
  );
  await espera(async () =>
    ((await filaDe(page, EXAMEN).textContent()) ?? "").includes("1 programada"),
  );
  check(
    "⭐ biblioteca: la celda de aplicaciones dice «1 programada»",
    ((await filaDe(page, EXAMEN).textContent()) ?? "").includes("1 programada"),
  );
  await page.getByRole("button", { name: `Devolver «${EXAMEN}» a borrador` }).click();
  const dialogo4 = page.getByRole("dialog");
  await espera(async () => (await dialogo4.count()) === 1);
  check(
    "⭐ despublicar IMPEDIDO por la fila-alumno (compromisosDe la VE)",
    await dialogo4.getByRole("button", { name: "Volver a borrador" }).isDisabled(),
    "una tabla aparte de asignaciones individuales dejaría esto habilitado",
  );
  check(
    "el diálogo EXPLICA el impedimento (asignaciones)",
    ((await dialogo4.textContent()) ?? "").includes("Ya tiene 1 asignación"),
  );
  await dialogo4.getByRole("button", { name: "Cancelar" }).click();
  await page.goto(`${BASE}/admin/reactivos`);
  await espera(async () => (await filas(page).count()) > 0);
  check(
    "⭐ banco: «membrana celular» BLOQUEADO (candado)",
    (await candadoBanco(filaDe(page, R_MEMBRANA)).count()) === 1,
  );
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const cuerpo4 = (await page.textContent("body")) ?? "";
  check("⭐ existentes muestra el NOMBRE de la alumna (no un grupo)", cuerpo4.includes(ANA));
  check("la fila nace «Programada»", (await filasExistentes(page).count()) === 1 && cuerpo4.includes("Programada"));

  // ════ §5 · Cancelación libera el compromiso ════
  console.log("\n5 · Cancelar: la fila desaparece y el candado se abre");
  check("⭐ cancelada sin recargar (reactividad)", await cancelarPrimera(page));
  await page.goto(`${BASE}${BIB_ADMIN}`);
  await espera(async () => (await filas(page).count()) > 0);
  await page.getByRole("button", { name: `Devolver «${EXAMEN}» a borrador` }).click();
  const dialogo5 = page.getByRole("dialog");
  await espera(async () => (await dialogo5.count()) === 1);
  check(
    "⭐ despublicar HABILITADO otra vez (compromiso liberado)",
    !(await dialogo5.getByRole("button", { name: "Volver a borrador" }).isDisabled()),
  );
  await dialogo5.getByRole("button", { name: "Cancelar" }).click();
  await page.goto(`${BASE}/admin/reactivos`);
  await espera(async () => (await filas(page).count()) > 0);
  check(
    "⭐ banco: «membrana celular» LIBRE otra vez",
    (await candadoBanco(filaDe(page, R_MEMBRANA)).count()) === 0,
  );

  // ════ §6 · asignar RE-ejecuta validarPublicable (la discriminante mayor) ════
  console.log("\n6 · Publicado degradado: asignar rechaza con el mensaje del servidor");
  await filaDe(page, R_MEMBRANA).getByRole("link", { name: /^Editar el reactivo/ }).click();
  await page.waitForURL(/\/editar$/);
  await page.getByRole("button", { name: "Desactivar" }).click();
  await page.waitForURL(/\/admin\/reactivos/);
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  await elegirGrupo(page, "Matutino A");
  await llenarVentana(page, Date.now() + DIA, Date.now() + 2 * DIA);
  await espera(async () => !(await confirmarBtn(page).isDisabled()));
  await confirmarBtn(page).click();
  await espera(async () => ((await page.textContent("body")) ?? "").includes("está desactivado"));
  check(
    "⭐ rechazo del SERVIDOR: el reactivo desactivado bloquea asignar",
    ((await page.textContent("body")) ?? "").includes("está desactivado"),
    "si asignar no re-ejecuta validarPublicable, esto asigna un examen roto",
  );
  check("seguimos en /asignar (no navegó)", /\/asignar$/.test(page.url()));
  check(
    "⭐ NO se creó ninguna asignación",
    (await filasExistentes(page).count()) === 0,
  );
  await page.goto(`${BASE}/admin/reactivos`);
  await espera(async () => (await filas(page).count()) > 0);
  await filaDe(page, R_MEMBRANA).getByRole("link", { name: /^Editar el reactivo/ }).click();
  await page.waitForURL(/\/editar$/);
  await page.getByRole("button", { name: "Reactivar" }).click();
  await page.waitForURL(/\/admin\/reactivos/);

  // ════ §7 · Ventana ABIERTA («En curso», sin Cancelar) ════
  console.log("\n7 · Asignación abierta: «En curso» y sin cancelación");
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  await elegirGrupo(page, "Matutino A");
  const abre7 = alMinuto(Date.now() - HORA);
  const cierra7 = alMinuto(Date.now() + 3 * DIA);
  await llenarVentana(page, abre7, cierra7);
  await espera(async () => !(await confirmarBtn(page).isDisabled()));
  const toast7 = await confirmarYLeerToast(page, BIB_ADMIN);
  check("toast de grupo: «para 4 alumnos»", toast7.includes("para 4 alumnos del"));
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const cuerpo7 = (await page.textContent("body")) ?? "";
  check("⭐ la fila abierta pinta «En curso» (etiqueta, no el estado crudo)", cuerpo7.includes("En curso"));
  check(
    "⭐ una abierta NO ofrece Cancelar",
    (await page.getByRole("button", { name: /^Cancelar la asignación de/ }).count()) === 0,
  );

  // ════ §7b · CRUCE de frontera con la pantalla abierta ════
  console.log("\n7b · Programada → «En curso» sin recargar (timer anclado)");
  // Frontera calculada JUSTO antes del submit: el próximo minuto que deje ≥25 s de
  // margen (cerca del segundo 59, la fila nacería abierta y jamás veríamos Programada).
  let abre7b = alMinuto(Date.now()) + MIN;
  if (abre7b - Date.now() < 25_000) abre7b += MIN;
  await elegirGrupo(page, "Sabatino C");
  await llenarVentana(page, abre7b, abre7b + DIA);
  await espera(async () => !(await confirmarBtn(page).isDisabled()));
  await confirmarYLeerToast(page, BIB_ADMIN);
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const filaSabatino = () =>
    page.locator("section", { hasText: "Asignaciones existentes" })
      .locator("div")
      .filter({ hasText: "Sabatino C" })
      .last();
  await espera(async () => (await filaSabatino().count()) > 0);
  check(
    "nace «Programada» (aseverada ANTES del cruce)",
    ((await filaSabatino().textContent()) ?? "").includes("Programada"),
  );
  // Timeout DERIVADO de la frontera (jamás un literal rígido).
  const margen7b = abre7b - Date.now() + 15_000;
  const cruzo = await poller(page)(
    async () => ((await filaSabatino().textContent()) ?? "").includes("En curso"),
    margen7b,
  );
  check("⭐ cruza a «En curso» SIN recargar (timer a la frontera)", cruzo);
  check(
    "⭐ su «Cancelar» DESAPARECIÓ al cruzar",
    (await filaSabatino()
      .getByRole("button", { name: /^Cancelar la asignación de/ })
      .count()) === 0,
  );

  // ════ §8 · Zona horaria: navegador en New York, negocio en MX ════
  console.log("\n8 · Zona horaria (America/New_York) + fixture de Valeria (diana)");
  const ctxNY = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
  });
  const pgNY = await ctxNY.newPage();
  await login(pgNY, ADMIN, /\/admin/);
  // 00:30 (reloj MX) de pasado mañana: el día D del rango es inequívoco.
  const madrugada = new Date(Date.now() - OFFSET_MX + 2 * DIA);
  const abre8 =
    Date.UTC(madrugada.getUTCFullYear(), madrugada.getUTCMonth(), madrugada.getUTCDate(), 0, 30) +
    OFFSET_MX;
  const cierra8 = abre8 + 2 * DIA;
  await abrirAsignar(pgNY, BIB_ADMIN, EXAMEN);
  await elegirGrupo(pgNY, "Matutino A");
  await llenarVentana(pgNY, abre8, cierra8);
  await poller(pgNY)(async () => !(await confirmarBtn(pgNY).isDisabled()));
  const toast8 = await confirmarYLeerToast(pgNY, BIB_ADMIN);
  check(
    "⭐ el rango del toast nombra el día D en reloj MX (no D−1 de NY)",
    toast8.includes(`del ${rangoEsperado(abre8, cierra8)}.`),
    `toast: «${toast8}» · esperado: «${rangoEsperado(abre8, cierra8)}»`,
  );
  await abrirAsignar(pgNY, BIB_ADMIN, EXAMEN);
  check("limpieza: la programada de NY se cancela", await cancelarPrimera(pgNY));
  await ctxNY.close();

  // Fixture del testigo de anonimización: DIANA (instructora de Vespertino B) asigna a
  // Valeria — la fila VIVE hasta §10.
  const ctxDiana = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pgDiana = await ctxDiana.newPage();
  await login(pgDiana, DIANA, /\/instructor/);
  await abrirAsignar(pgDiana, BIB_INST, EXAMEN);
  await pgDiana.getByText("Alumnos individuales").click();
  await pgDiana.getByPlaceholder("Buscar alumno por nombre…").fill("Valeria");
  await pgDiana.getByText(VALERIA).click();
  await llenarVentana(pgDiana, Date.now() + 3 * DIA, Date.now() + 4 * DIA);
  await poller(pgDiana)(async () => !(await confirmarBtn(pgDiana).isDisabled()));
  const toastDiana = await confirmarYLeerToast(pgDiana, BIB_INST);
  check("diana asigna a SU alumna Valeria (1 alumno)", toastDiana.includes("para 1 alumno del"));
  await ctxDiana.close();

  // ════ §9 · Montaje instructor (cristian) ════
  console.log("\n9 · Instructor: destino restringido, anonimización y creador");
  const ctxCris = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pgCris = await ctxCris.newPage();
  await login(pgCris, CRISTIAN, /\/instructor/);
  await abrirAsignar(pgCris, BIB_INST, EXAMEN);
  const cuerpo9 = (await pgCris.textContent("body")) ?? "";
  check(
    "⭐ SOLO 2 destinos (sin «Todos los grupos»)",
    (await pgCris.locator('input[type="radio"]').count()) === 2 && !cuerpo9.includes("Todos los grupos"),
  );
  await pgCris.getByRole("combobox").click();
  const opciones9 = pgCris.getByRole("option");
  const textos9 = await opciones9.allTextContents();
  check(
    "⭐ el multiselect lista EXACTAMENTE Matutino A y Sabatino C",
    textos9.length === 2 &&
      textos9.some((t) => t.startsWith("Matutino A")) &&
      textos9.some((t) => t.startsWith("Sabatino C")),
    `opciones: ${JSON.stringify(textos9)} — Vespertino B sería colgarse de grupos.listar (que además es requireAdmin)`,
  );
  await pgCris.keyboard.press("Escape");
  await pgCris.getByText("Alumnos individuales").click();
  await pgCris.getByPlaceholder("Buscar alumno por nombre…").fill("Valeria");
  await poller(pgCris)(async () => ((await pgCris.textContent("body")) ?? "").includes("Sin resultados."));
  check("⭐ la búsqueda NO ofrece a Valeria (grupo ajeno)", ((await pgCris.textContent("body")) ?? "").includes("Sin resultados."));
  await pgCris.getByPlaceholder("Buscar alumno por nombre…").fill("Ana");
  await poller(pgCris)(async () => ((await pgCris.textContent("body")) ?? "").includes(ANA));
  check("…y SÍ a Ana (su grupo)", ((await pgCris.textContent("body")) ?? "").includes(ANA));
  const cuerpo9b = (await pgCris.textContent("body")) ?? "";
  check(
    "⭐ la fila de Valeria (de diana) viaja ANONIMIZADA para cristian",
    cuerpo9b.includes("Alumno de otro grupo") && !cuerpo9b.includes("Valeria"),
    "exponer el nombre de una alumna ajena es la fuga que la política corta",
  );
  await abrirAsignar(pgCris, BIB_INST, SG3);
  const cuerpoSG3 = (await pgCris.textContent("body")) ?? "";
  check("SG3: la futura sembrada se pinta «Matutino A · Programada»", cuerpoSG3.includes("Matutino A") && cuerpoSG3.includes("Programada"));
  check(
    "⭐ cristian (CREADOR de la sembrada, no admin) SÍ ve «Cancelar»",
    (await pgCris.getByRole("button", { name: /^Cancelar la asignación de/ }).count()) === 1,
  );
  await ctxCris.close();

  // ════ §9b · Tercero (carlos): ni creador ni admin ════
  console.log("\n9b · Carlos (tercero) no puede solicitar la cancelación");
  const ctxCarlos = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pgCarlos = await ctxCarlos.newPage();
  await login(pgCarlos, CARLOS, /\/instructor/);
  await abrirAsignar(pgCarlos, BIB_INST, SG3);
  check(
    "⭐ la fila programada de SG3 NO ofrece «Cancelar» a carlos",
    (await pgCarlos.getByRole("button", { name: /^Cancelar la asignación de/ }).count()) === 0,
    "mata puedeSolicitarCancelar = staff y también = instructor-del-grupo-destino",
  );
  await ctxCarlos.close();

  // ════ §10 · Estados problema, doble montaje y la rama ADMIN de cancelar ════
  console.log("\n10 · Admin: problemas, hrefs de zona y cancelación admin-no-creadora");
  await page.goto(`${BASE}${BIB_ADMIN}`);
  await espera(async () => (await filas(page).count()) > 0);
  const hrefVerSG5 = await filaDe(page, SG5)
    .getByRole("link", { name: `Ver el examen «${SG5}»` })
    .getAttribute("href");
  const idSG5 = (hrefVerSG5 ?? "").replace(/\/vista$/, "").split("/").filter(Boolean).pop() ?? "";
  await page.goto(`${BASE}${BIB_ADMIN}/${idSG5}/asignar`);
  await espera(async () => ((await page.textContent("body")) ?? "").includes("Solo un examen publicado"));
  const cuerpoSG5 = (await page.textContent("body")) ?? "";
  check(
    "⭐ archivado por URL directa → aviso, SIN formulario",
    cuerpoSG5.includes("Solo un examen publicado puede asignarse") &&
      (await page.locator('input[type="radio"]').count()) === 0,
  );
  check(
    "⭐ el enlace de regreso respeta la zona admin",
    ((await page.getByRole("link", { name: "Volver a exámenes" }).getAttribute("href")) ?? "").startsWith(BIB_ADMIN),
  );
  await page.goto(`${BASE}${BIB_ADMIN}/id-basura/asignar`);
  await espera(async () => ((await page.textContent("body")) ?? "").includes("No se encontró el examen"));
  check("id basura → «No se encontró el examen»", true);
  await abrirAsignar(page, BIB_ADMIN, SG3);
  check(
    "⭐ admin ve «Cancelar» en la fila de cristian (rama admin del ∨, solo lectura)",
    (await page.getByRole("button", { name: /^Cancelar la asignación de/ }).count()) === 1,
  );
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  check(
    "⭐ admin ve la fila de Valeria CON nombre",
    ((await page.textContent("body")) ?? "").includes(VALERIA),
  );
  check(
    "⭐ Mayra (admin, NO creadora) cancela la fila de diana",
    await cancelarPrimera(page),
    "la rama admin del ∨ en la MUTATION — con Mayra creadora (v3) este testigo era falso",
  );

  // ════ §11 · Materialización CONGELADA (baseline + grupo fixture convergente) ════
  console.log("\n11 · «Todos los grupos» materializa solo los existentes al crearse");
  // Defensivo: si una corrida abortada dejó E22 ACTIVO, ciérralo antes de medir.
  await page.goto(`${BASE}/admin/grupos`);
  await espera(async () => (await filas(page).count()) > 0);
  if ((await filaDe(page, GRUPO_E22).count()) === 1) {
    const filaE22 = filaDe(page, GRUPO_E22);
    if (((await filaE22.textContent()) ?? "").includes("Activo")) {
      await filaE22.getByRole("button", { name: `Cerrar ${GRUPO_E22}` }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cerrar grupo" }).click();
      await espera(async () => ((await filaDe(page, GRUPO_E22).textContent()) ?? "").includes("Cerrado"));
    }
  }
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const baseline11 = await filasExistentes(page).count();
  await page.getByText("Todos los grupos").click();
  const abre11 = alMinuto(Date.now() + 6 * DIA);
  await llenarVentana(page, abre11, abre11 + DIA);
  await espera(async () => !(await confirmarBtn(page).isDisabled()));
  const toast11 = await confirmarYLeerToast(page, BIB_ADMIN);
  check("⭐ «Todos los grupos» = 8 alumnos (3 grupos del seed)", toast11.includes("para 8 alumnos del"));
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  await espera(async () => (await filasExistentes(page).count()) === baseline11 + 3);
  check(
    "⭐ materializó 3 filas (baseline + 3, jamás conteo absoluto)",
    (await filasExistentes(page).count()) === baseline11 + 3 &&
      ((await page.textContent("body")) ?? "").includes("Vespertino B"),
  );
  // Reabrir-en-vez-de-crear el grupo fixture, y comprobar la CONGELACIÓN.
  await page.goto(`${BASE}/admin/grupos`);
  await espera(async () => (await filas(page).count()) > 0);
  if ((await filaDe(page, GRUPO_E22).count()) === 1) {
    await filaDe(page, GRUPO_E22)
      .getByRole("button", { name: `Reabrir ${GRUPO_E22}` })
      .click();
    await espera(async () => ((await filaDe(page, GRUPO_E22).textContent()) ?? "").includes("Activo"));
  } else {
    await page.getByRole("button", { name: "Crear grupo" }).click();
    const modal11 = page.getByRole("dialog");
    await modal11.locator("#grupo-nombre").fill(GRUPO_E22);
    await modal11.locator("#grupo-ciclo").fill("2026-A");
    await modal11.locator("select").selectOption("matutino");
    await modal11.getByRole("combobox").click();
    await page.getByRole("option", { name: /Cristian/ }).click();
    await page.keyboard.press("Escape");
    await modal11.getByRole("button", { name: /Crear|Guardar/ }).click();
    await espera(async () => (await filaDe(page, GRUPO_E22).count()) === 1);
  }
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const cuerpo11 = (await page.textContent("body")) ?? "";
  check(
    "⭐ el lote SIGUE en 3 filas y NINGUNA nombra a «Nocturno E22» (congelada al crearse)",
    (await filasExistentes(page).count()) === baseline11 + 3 && !cuerpo11.includes(GRUPO_E22),
  );
  for (let i = 0; i < 3; i++) await cancelarPrimera(page);
  check("lote cancelado → baseline restaurado", (await filasExistentes(page).count()) === baseline11);
  // Cierre del fixture AL FINAL DEL CUERPO (¡§12 usa «todos» ×7 — con E22 activo serían 4 por op!).
  await page.goto(`${BASE}/admin/grupos`);
  await espera(async () => (await filas(page).count()) > 0);
  await filaDe(page, GRUPO_E22)
    .getByRole("button", { name: `Cerrar ${GRUPO_E22}` })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar grupo" }).click();
  await espera(async () => ((await filaDe(page, GRUPO_E22).textContent()) ?? "").includes("Cerrado"));
  check("«Nocturno E22» queda CERRADO (repetibilidad ×2)", true);

  // ════ §12 · Paginación REAL con orden por abreEn desc ════
  console.log("\n12 · Paginación: primera página exacta, Cargar más y orden real");
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  const baseline12 = await filasExistentes(page).count();
  // 7 lotes «Todos los grupos» (21 filas) con aperturas FUERA del orden de inserción.
  const dias12 = [5, 2, 8, 3, 7, 4, 6];
  for (const d of dias12) {
    await abrirAsignar(page, BIB_ADMIN, EXAMEN);
    await page.getByText("Todos los grupos").click();
    const abre = alMinuto(Date.now() + d * DIA);
    await llenarVentana(page, abre, abre + DIA);
    await espera(async () => !(await confirmarBtn(page).isDisabled()));
    await confirmarYLeerToast(page, BIB_ADMIN);
  }
  await abrirAsignar(page, BIB_ADMIN, EXAMEN);
  await espera(async () => (await filasExistentes(page).count()) === 20);
  check(
    "⭐ el render inicial muestra EXACTAMENTE 20 filas (una página)",
    (await filasExistentes(page).count()) === 20,
    "una implementación que ignore cursores devolvería todo",
  );
  check("…con «Cargar más» visible", (await page.getByRole("button", { name: "Cargar más" }).count()) === 1);
  await page.getByRole("button", { name: "Cargar más" }).click();
  await espera(async () => (await filasExistentes(page).count()) === baseline12 + 21);
  check(
    "⭐ «Cargar más» completa el acumulado",
    (await filasExistentes(page).count()) === baseline12 + 21,
  );
  const abre8d = alMinuto(Date.now() + 8 * DIA);
  const primeraFila = page
    .locator("section", { hasText: "Asignaciones existentes" })
    .locator("div")
    .filter({ hasText: /Programada|En curso|Cerrada/ })
    .first();
  check(
    "⭐ la primera fila es la de apertura +8d — orden por abreEn DESC, no por inserción",
    ((await primeraFila.textContent()) ?? "").includes(rangoEsperado(abre8d, abre8d + DIA)),
    "by_examen a secas ordenaría por _creationTime y la última insertada (+6d) iría primero",
  );
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e?.stack ?? e}`);
} finally {
  await navegador.close();
  console.log("\nRestaurando el fixture…");
  try {
    await pizarraLimpia();
  } catch (e) {
    console.error(`✘ No se pudo restaurar: ${e.message}`);
  }
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
