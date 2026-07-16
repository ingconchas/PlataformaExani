/**
 * E2E de LUI-15 (Entrega 1) — Crear/editar reactivo (opción múltiple).
 *
 * Aserciones DISCRIMINANTES. CREA y EDITA reactivos, así que hace pizarra limpia al
 * inicio y restaura el fixture en `finally`.
 *
 * Casos clave (el fixture del seed los hace testeables):
 *  · Alta bajo un subtema disponible → +1 al contador del temario.
 *  · Editar «(x+3)²» (subtema RETIRADO «Productos notables») MANTENIÉNDOLO → GUARDA
 *    (camino exigirDisponible:false). Moverlo a un subtema DISPONIBLE → mueve contadores.
 *  · Candado: un reactivo en uso abre el form en modo bloqueado (sin Guardar) pero SÍ
 *    permite Desactivar.
 *
 * Requisitos: npx convex dev · npm run dev · (playwright chromium instalado).
 * Uso: node scripts/e2e-lui15.mjs   ·   E2E_HEADED=1 node scripts/e2e-lui15.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx"; // autor de casi todos
const ADMIN = "mayra.admin@demo.unx.mx";

const ENUN_NUEVO = "E2E LUI-15 reactivo nuevo alfa";
const RETIRADO = "(x + 3)"; // substring de «¿Cuál es el desarrollo de (x + 3)²?»
const EN_USO = "2x + 6 = 14"; // substring de un reactivo en uso, de Cristian

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
    p.on("close", () => resolve(salida));
    p.on("error", () => resolve(""));
  });
}

async function pizarraLimpia() {
  await ejecutar("npx", [
    "convex", "run", "seed:limpiarContenidoDemo", '{"confirmar":"SOLO_DEV"}',
  ]);
  await ejecutar("npx", [
    "convex", "run", "seed:cargarDatosDePrueba", '{"confirmar":"SOLO_DEV"}',
  ]);
  await ejecutar("npx", [
    "convex", "run", "seedAuth:credencialesDemo", '{"confirmar":"SOLO_DEV"}',
  ]);
}

console.log("\nE2E LUI-15 · pizarra limpia + credenciales…");
await pizarraLimpia();

const navegador = await chromium.launch({ headless: !HEADED });

const filas = (pg) => pg.locator("tbody tr");
const filaDe = (pg, texto) => filas(pg).filter({ hasText: texto }).first();

function poller(pg) {
  return async (cond, ms = 8000) => {
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

async function seleccionar(pg, etiqueta, label) {
  const sel = pg.getByLabel(etiqueta);
  await poller(pg)(async () =>
    (await sel.locator("option").allTextContents()).some((t) => t.trim() === label),
  );
  await sel.selectOption({ label });
}

/** Filtra el banco por texto del enunciado para AISLAR un reactivo en la página 1
 *  (con >8 reactivos la paginación lo empujaría a la página 2). */
async function buscar(pg, texto) {
  const box = pg.getByPlaceholder("Buscar en el enunciado…");
  await box.fill("");
  await box.fill(texto);
  await poller(pg)(async () => (await filas(pg).count()) >= 1);
}

/** Conteo de un nodo en `/admin/temario` (asume el ancestro expandido). */
async function contarNodo(pg, nombre) {
  const fila = pg
    .locator("li")
    .filter({ has: pg.getByText(nombre, { exact: true }) })
    .first();
  const t = (await fila.textContent()) ?? "";
  const m = t.match(/(\d+) reactivos?/);
  return m ? Number(m[1]) : null;
}

// ── Instructor (Cristian) ─────────────────────────────────────────────────────
const ctxInst = await navegador.newContext();
const page = await ctxInst.newPage();
const esperar = poller(page);

try {
  await login(page, INSTRUCTOR, /\/instructor/);

  console.log("1 · Alta de un reactivo (opción múltiple, presentación directa)");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.fill("#enunciado", ENUN_NUEVO);
  await page.getByPlaceholder("Opción A").fill("Alfa");
  await page.getByPlaceholder("Opción B").fill("Beta");
  await page.getByPlaceholder("Opción C").fill("Gamma");
  await page.getByLabel("Marcar la opción B como correcta").check();
  await page.fill("#explicacion", "Porque beta es la correcta.");
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Álgebra");
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Intermedio" }).click();
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await esperar(async () => (await filas(page).count()) > 0);
  const filaNueva = filaDe(page, ENUN_NUEVO);
  check("el reactivo nuevo aparece en el banco", (await filaNueva.count()) === 1);
  check(
    "muestra su dificultad canónica (Intermedio)",
    ((await filaNueva.textContent()) ?? "").includes("Intermedio"),
  );
  check(
    "muestra a Cristian como autor",
    ((await filaNueva.textContent()) ?? "").includes("Cristian"),
  );

  console.log("\n2 · Validación: no guarda incompleto");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.fill("#enunciado", "Incompleto");
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  check(
    "un reactivo sin opciones/correcta/explicación muestra error",
    await esperar(async () =>
      ((await page.textContent("body")) ?? "").includes("Cada opción debe tener texto"),
    ),
  );
  check("no navega (sigue en /nuevo)", page.url().endsWith("/reactivos/nuevo"));

  console.log("\n3 · Editar MANTENIENDO una clasificación RETIRADA (cierra el mayor)");
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, RETIRADO); // «(x+3)²» cae en la página 2 sin filtrar
  await filaDe(page, RETIRADO)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  // El subtema retirado se muestra tolerado y preseleccionado.
  check(
    "el subtema retirado se ofrece preseleccionado con «(retirado)»",
    await esperar(async () =>
      ((await page.getByLabel("Subtema").textContent()) ?? "").includes("(retirado)"),
    ),
  );
  await page.fill("#enunciado", "¿Cuál es el desarrollo de (x + 3)²? [E2E editado]");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, "[E2E editado]"); // sigue en Productos notables → página 2 sin filtrar
  check(
    "mantener la clasificación retirada GUARDA (el enunciado cambió)",
    (await filaDe(page, "[E2E editado]").count()) === 1,
  );

  console.log("\n4 · Mover a un subtema DISPONIBLE (ajusta contadores)");
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, RETIRADO);
  await filaDe(page, RETIRADO)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  check("guardó el movimiento de clasificación", true);

  console.log("\n5 · Candado: en uso → form bloqueado, pero Desactivar sí");
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, EN_USO);
  await filaDe(page, EN_USO)
    .getByRole("link", { name: /abrir .* para desactivar/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  check(
    "el form avisa que está en uso",
    await esperar(async () =>
      ((await page.textContent("body")) ?? "").includes("está en uso en un examen"),
    ),
  );
  check(
    "no ofrece Guardar (contenido bloqueado)",
    (await page.getByRole("button", { name: /^Guardar/ }).count()) === 0,
  );
  check(
    "sí ofrece Desactivar",
    (await page.getByRole("button", { name: "Desactivar" }).count()) === 1,
  );
  await page.getByRole("button", { name: "Desactivar" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await seleccionar(page, "Filtrar por estado", "Desactivados");
  check(
    "el reactivo quedó desactivado (aparece en el filtro)",
    await esperar(async () => (await filaDe(page, EN_USO).count()) === 1),
  );

  console.log("\n6 · Propiedad: un reactivo ajeno no ofrece editar");
  await page.getByRole("button", { name: "Limpiar filtros" }).first().click();
  await seleccionar(page, "Filtrar por autor", "Rubén Cano");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaAjeno = filas(page).first();
  check(
    "reactivo ajeno: sin enlace de editar",
    (await filaAjeno.getByRole("link", { name: /^Editar el reactivo/ }).count()) === 0,
  );
  check(
    "reactivo ajeno: sin candado (no es editable por él)",
    (await filaAjeno.getByRole("link", { name: /para desactivar/ }).count()) === 0,
  );

  // ── Admin (Mayra): contadores + edita ajenos ────────────────────────────────
  console.log("\n7 · Contadores del temario (admin)");
  const ctxAdmin = await navegador.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  const esperarAdmin = poller(pageAdmin);
  await login(pageAdmin, ADMIN, /\/admin/);
  await pageAdmin.goto(`${BASE}/admin/temario`);
  await esperarAdmin(async () => (await pageAdmin.locator("li").count()) > 0);
  await pageAdmin.getByRole("button", { name: "Expandir Álgebra" }).click();
  await esperarAdmin(async () => (await contarNodo(pageAdmin, "Ecuaciones lineales")) !== null);
  // Base Ecuaciones lineales = 5; +1 por el alta (§1) +1 por el movimiento (§4) = 7.
  check(
    "«Ecuaciones lineales» subió a 7 (alta +1, movimiento +1)",
    (await contarNodo(pageAdmin, "Ecuaciones lineales")) === 7,
    `recibido: ${await contarNodo(pageAdmin, "Ecuaciones lineales")}`,
  );
  // Base Productos notables = 2; −1 por el movimiento hacia afuera (§4) = 1.
  check(
    "«Productos notables» bajó a 1 (movimiento −1)",
    (await contarNodo(pageAdmin, "Productos notables")) === 1,
    `recibido: ${await contarNodo(pageAdmin, "Productos notables")}`,
  );

  console.log("\n8 · Admin edita reactivos ajenos");
  await pageAdmin.goto(`${BASE}/admin/reactivos`);
  await esperarAdmin(async () => (await filas(pageAdmin).count()) > 0);
  await pageAdmin.getByPlaceholder("Buscar en el enunciado…").fill(ENUN_NUEVO);
  await esperarAdmin(async () => (await filaDe(pageAdmin, ENUN_NUEVO).count()) === 1);
  await filaDe(pageAdmin, ENUN_NUEVO)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await pageAdmin.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  check(
    "el admin abre un reactivo ajeno en modo editable (ofrece Guardar)",
    await esperarAdmin(async () =>
      (await pageAdmin.getByRole("button", { name: "Guardar cambios" }).count()) === 1,
    ),
  );
  await ctxAdmin.close();
} catch (e) {
  console.error("\n✘ Excepción:", e?.message ?? e);
  fallos++;
} finally {
  await navegador.close();
  // Restaura el fixture (el E2E creó/movió/desactivó reactivos).
  await pizarraLimpia();
}

console.log(`\n${fallos === 0 ? "✅" : "❌"} LUI-15: ${ok} ok · ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
