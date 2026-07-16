/**
 * E2E de LUI-14 — Banco de reactivos con filtros (`/{instructor,admin}/reactivos`).
 *
 * Las aserciones son DISCRIMINANTES: cada una existe porque una implementación
 * plausible pero mal hecha la rompería de forma visible. El fixture del seed está
 * diseñado para discriminar el candado (reactivos libres vs. en uso), la propiedad
 * (autores distintos, uno INACTIVO) y la lectura.
 *
 * Casos que el seed garantiza (verificado):
 *  · «3/4 + 1/6» y «0.375» → Cristian, LIBRES (solo borrador / ningún examen) → lápiz.
 *  · «En el sistema x + y = 10» → Cristian, EN USO por asignación FUTURA → candado
 *    (prueba que «publicado con asignaciones» NO filtra por `abreEn`).
 *  · «Una recta pasa por los puntos» → Rubén (INACTIVO), en uso → ajeno, solo «Ver».
 *  · «En un texto expositivo» → Carlos, con LECTURA → chip + ajeno.
 *  · «(x + 5)(x − 5)» → Cristian, DESACTIVADO → badge.
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   1. npm install && npx playwright install chromium
 *   2. npx convex dev        (en otra terminal)
 *   3. npm run dev           (en otra terminal → http://localhost:3000)
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/e2e-lui14.mjs
 *   E2E_HEADED=1 node scripts/e2e-lui14.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx"; // autor de la mayoría
const ADMIN = "mayra.admin@demo.unx.mx";

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

// Pizarra limpia + credenciales demo: restaura el fixture DISCRIMINANTE (la pantalla
// es solo lectura, así que no hay que limpiar residuo después).
async function setup() {
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

console.log("\nE2E LUI-14 · pizarra limpia + credenciales…");
await setup();

const navegador = await chromium.launch({ headless: !HEADED });

// ── Helpers de página ────────────────────────────────────────────────────────
const filas = (pg) => pg.locator("tbody tr");
const filaDe = (pg, texto) => filas(pg).filter({ hasText: texto }).first();
const verBtn = (fila) => fila.getByRole("button", { name: /^Ver el reactivo/ });
const editarLink = (fila) => fila.getByRole("link", { name: /^Editar el reactivo/ });
const candado = (fila) =>
  fila.locator('[aria-label="Edición bloqueada: en uso en un examen activo"]');

function poller(pg) {
  return async (cond, ms = 6000) => {
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

/** Selecciona una opción por su texto, esperando primero a que exista (la cascada
 *  refresca las opciones de forma reactiva). */
async function seleccionar(pg, etiqueta, label) {
  const sel = pg.getByLabel(etiqueta);
  const esperar = poller(pg);
  await esperar(async () =>
    (await sel.locator("option").allTextContents()).some((t) => t.trim() === label),
  );
  await sel.selectOption({ label });
}

async function limpiar(pg) {
  await pg.getByRole("button", { name: "Limpiar filtros" }).first().click();
  await poller(pg)(async () => (await filas(pg).count()) === 12);
}

// ── Instructor (Cristian) ─────────────────────────────────────────────────────
const ctxInst = await navegador.newContext();
const page = await ctxInst.newPage();
const esperar = poller(page);

try {
  await login(page, INSTRUCTOR, /\/instructor/);
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await filas(page).count()) > 0);

  console.log("1 · La pantalla ya no es un placeholder");
  const cuerpo = (await page.textContent("body")) ?? "";
  check("no queda el ScreenPlaceholder", !cuerpo.includes("Pantalla por construir"));
  check(
    "encabezado «Banco de reactivos»",
    (await page.textContent("h1"))?.trim() === "Banco de reactivos",
  );
  check("conteo total = 12 reactivos", cuerpo.includes("12 reactivos"));
  check("las 12 filas se listan (2 páginas)", (await filas(page).count()) === 8, "página 1 = 8");

  console.log("\n2 · Filtro por AUTOR incluye a un autor INACTIVO (sale de las filas)");
  const opcionesAutor = (
    await page.getByLabel("Filtrar por autor").locator("option").allTextContents()
  ).map((t) => t.trim());
  check(
    "«Rubén Cano» (instructor desactivado) es opción de autor",
    opcionesAutor.includes("Rubén Cano"),
    `opciones: ${opcionesAutor.join(", ")}`,
  );
  await seleccionar(page, "Filtrar por autor", "Rubén Cano");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaRuben = filaDe(page, "Una recta pasa por los puntos");
  check("el reactivo de Rubén aparece", (await filaRuben.count()) === 1);
  check("ajeno → tiene «Ver»", (await verBtn(filaRuben).count()) === 1);
  check("ajeno → NO tiene lápiz", (await editarLink(filaRuben).count()) === 0);
  check("ajeno → NO muestra candado (no es editable por él)", (await candado(filaRuben).count()) === 0);
  await limpiar(page);

  console.log("\n3 · Filtro por DIFICULTAD con nomenclatura canónica");
  await seleccionar(page, "Filtrar por dificultad", "Avanzado");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaDificil = filaDe(page, "= x + 5");
  check("Avanzado deja solo el reactivo difícil", (await filaDificil.count()) === 1);
  check(
    "el medidor rotula «Avanzado» (no DIFÍCIL)",
    ((await filaDificil.textContent()) ?? "").includes("Avanzado"),
  );
  await limpiar(page);

  console.log("\n4 · Cascada Sección → Área → Subtema (+ reactivos propios LIBRES → lápiz)");
  await seleccionar(page, "Filtrar por sección", "Pensamiento matemático");
  // Al elegir sección, Área se habilita y ofrece las áreas de esa sección.
  const opcArea = (
    await page.getByLabel("Filtrar por área temática").locator("option").allTextContents()
  ).map((t) => t.trim());
  check("Área ofrece «Aritmética» tras elegir sección", opcArea.includes("Aritmética"));
  check("Área NO ofrece «Célula» (de otra sección)", !opcArea.includes("Célula"));
  await seleccionar(page, "Filtrar por área temática", "Aritmética");
  await seleccionar(page, "Filtrar por subtema", "Operaciones con fracciones");
  await esperar(async () => (await filas(page).count()) === 2);
  const filaLibre1 = filaDe(page, "3/4 + 1/6");
  const filaLibre2 = filaDe(page, "equivalente a 0.375");
  check("propio + libre (3/4+1/6) → lápiz", (await editarLink(filaLibre1).count()) === 1);
  check("propio + libre (0.375) → lápiz", (await editarLink(filaLibre2).count()) === 1);
  check("libre → sin candado", (await candado(filaLibre1).count()) === 0);
  // Cambiar la sección resetea Área y Subtema.
  await seleccionar(page, "Filtrar por sección", "Biología");
  check(
    "cambiar Sección resetea el Área",
    (await page.getByLabel("Filtrar por área temática").inputValue()) === "",
  );
  await limpiar(page);

  console.log("\n5 · Candado: propio + EN USO por asignación FUTURA (sin filtro de abreEn)");
  await seleccionar(page, "Filtrar por sección", "Pensamiento matemático");
  await seleccionar(page, "Filtrar por área temática", "Álgebra");
  await seleccionar(page, "Filtrar por subtema", "Sistemas de ecuaciones");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaFutura = filaDe(page, "En el sistema x + y = 10");
  check("propio + en uso → muestra candado", (await candado(filaFutura).count()) === 1);
  check("propio + en uso → NO muestra lápiz", (await editarLink(filaFutura).count()) === 0);
  check("aun bloqueado, tiene «Ver»", (await verBtn(filaFutura).count()) === 1);
  await limpiar(page);

  console.log("\n6 · Estado: filtro «Desactivados» + badge");
  await seleccionar(page, "Filtrar por estado", "Desactivados");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaInactiva = filaDe(page, "(x + 5)(x");
  check("Desactivados deja solo el reactivo inactivo", (await filaInactiva.count()) === 1);
  check(
    "el reactivo inactivo muestra el badge «Desactivado»",
    ((await filaInactiva.textContent()) ?? "").includes("Desactivado"),
  );
  await limpiar(page);

  console.log("\n7 · Chip «▤ Lectura» en un reactivo de bloque");
  await seleccionar(page, "Filtrar por autor", "Carlos Lora");
  await esperar(async () => (await filas(page).count()) === 1);
  const filaLectura = filaDe(page, "En un texto expositivo");
  check(
    "muestra «Lectura: El calentamiento global»",
    ((await filaLectura.textContent()) ?? "").includes("Lectura: El calentamiento global"),
  );
  check("reactivo ajeno de Carlos → solo «Ver»", (await editarLink(filaLectura).count()) === 0);
  await limpiar(page);

  console.log("\n8 · Búsqueda por enunciado, insensible a acentos");
  const buscador = page.getByPlaceholder("Buscar en el enunciado…");
  await buscador.fill("parrafo"); // el enunciado dice «párrafo» (con acento)
  await esperar(async () => (await filas(page).count()) === 1);
  check(
    "«parrafo» (sin acento) encuentra el de «párrafo»",
    (await filaDe(page, "En un texto expositivo").count()) === 1,
  );
  await buscador.fill("");
  await esperar(async () => (await filas(page).count()) === 8);

  console.log("\n9 · Chips de filtros activos + «Limpiar»");
  await seleccionar(page, "Filtrar por dificultad", "Avanzado");
  await esperar(async () => (await filas(page).count()) === 1);
  const chip = page.getByRole("button", { name: /^Quitar filtro:/ });
  check("aparece un chip del filtro activo", (await chip.count()) >= 1);
  check(
    "el chip nombra «Dificultad: Avanzado»",
    ((await chip.first().textContent()) ?? "").includes("Avanzado"),
  );
  await limpiar(page);
  check("tras limpiar, no quedan chips", (await page.getByRole("button", { name: /^Quitar filtro:/ }).count()) === 0);

  console.log("\n10 · Quitar el chip de Sección resetea sus dependientes");
  await seleccionar(page, "Filtrar por sección", "Pensamiento matemático");
  await seleccionar(page, "Filtrar por área temática", "Álgebra");
  await page.getByRole("button", { name: "Quitar filtro: Sección: Pensamiento matemático" }).click();
  check(
    "quitar el chip de Sección limpia el Área",
    (await page.getByLabel("Filtrar por área temática").inputValue()) === "",
  );
  await esperar(async () => (await filas(page).count()) === 8);

  console.log("\n11 · Vista de solo lectura (preview) por «Ver»");
  await verBtn(filaDe(page, "membrana celular")).click();
  const dialogo = page.getByRole("dialog");
  check("se abre el modal de preview", await esperar(async () => (await dialogo.count()) === 1));
  check(
    "el preview muestra las opciones y la respuesta correcta",
    await esperar(async () =>
      ((await dialogo.textContent()) ?? "").includes("Regular el paso de sustancias"),
    ),
  );
  await page.keyboard.press("Escape");
  check("el preview cierra con Escape", await esperar(async () => (await dialogo.count()) === 0));

  console.log("\n12 · Vacío por filtros con CTA de limpiar");
  await seleccionar(page, "Filtrar por sección", "Biología"); // solo tiene 1 reactivo, fácil
  await seleccionar(page, "Filtrar por dificultad", "Avanzado"); // ninguno → vacío
  check(
    "muestra el vacío por combinación",
    await esperar(async () =>
      ((await page.textContent("body")) ?? "").includes("No hay reactivos con esta combinación"),
    ),
  );
  check(
    "el vacío ofrece «Limpiar filtros»",
    (await page.getByRole("button", { name: "Limpiar filtros" }).count()) >= 1,
  );

  // ── Admin (Mayra): edita TODOS los libres; el candado también le aplica ──────
  console.log("\n13 · Admin: edita reactivos ajenos (libres) y respeta el candado");
  const ctxAdmin = await navegador.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  const esperarAdmin = poller(pageAdmin);
  await login(pageAdmin, ADMIN, /\/admin/);
  check(
    "el menú de admin tiene «Banco de reactivos»",
    (await pageAdmin.getByRole("link", { name: "Banco de reactivos" }).count()) >= 1,
  );
  await pageAdmin.goto(`${BASE}/admin/reactivos`);
  await esperarAdmin(async () => (await filas(pageAdmin).count()) > 0);

  // Un reactivo LIBRE ajeno (de Cristian): el admin SÍ lo edita.
  await seleccionar(pageAdmin, "Filtrar por autor", "Cristian Martínez");
  await seleccionar(pageAdmin, "Filtrar por sección", "Pensamiento matemático");
  await seleccionar(pageAdmin, "Filtrar por área temática", "Aritmética");
  await esperarAdmin(async () => (await filas(pageAdmin).count()) === 2);
  check(
    "admin: reactivo libre ajeno → lápiz",
    (await editarLink(filaDe(pageAdmin, "3/4 + 1/6")).count()) === 1,
  );
  // Un reactivo EN USO: ni siquiera el admin lo edita (candado).
  await seleccionar(pageAdmin, "Filtrar por área temática", "Álgebra");
  await seleccionar(pageAdmin, "Filtrar por subtema", "Sistemas de ecuaciones");
  await esperarAdmin(async () => (await filas(pageAdmin).count()) === 1);
  const filaAdminFutura = filaDe(pageAdmin, "En el sistema x + y = 10");
  check("admin: reactivo en uso → candado", (await candado(filaAdminFutura).count()) === 1);
  check("admin: reactivo en uso → sin lápiz", (await editarLink(filaAdminFutura).count()) === 0);
  await ctxAdmin.close();
} catch (e) {
  console.error("\n✘ Excepción:", e?.message ?? e);
  fallos++;
} finally {
  await navegador.close();
}

console.log(`\n${fallos === 0 ? "✅" : "❌"} LUI-14: ${ok} ok · ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
