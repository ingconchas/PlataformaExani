/**
 * E2E de LUI-9 — Panel principal de la administradora (`/admin`).
 *
 * **El oráculo NO está escrito aquí.** Lo produce el seed (`panelEsperado`),
 * calculado contra la BD real con su propio código de conteo. Escribir «8 alumnos»
 * en este archivo sería falso en cuanto otro script cree usuarios — que es
 * exactamente lo que pasa con `e2e-lui103.mjs`.
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   1. npm install                       (trae playwright)
 *   2. npx playwright install chromium
 *   3. npx convex dev                    (en otra terminal)
 *   4. npm run dev                       (en otra terminal → http://localhost:3000)
 *   5. Los DOS seeds (el de auth es aparte y exige el base primero):
 *        npx convex run seed:cargarDatosDePrueba  '{"confirmar":"SOLO_DEV"}'
 *        npx convex run seedAuth:credencialesDemo '{"confirmar":"SOLO_DEV"}'
 *      Sin el segundo NO hay credenciales y este script no puede iniciar sesión.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/e2e-lui9.mjs
 *   E2E_HEADED=1 node scripts/e2e-lui9.mjs
 *
 * El script corre el seed él mismo para obtener el oráculo fresco.
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const ADMIN = { correo: "mayra.admin@demo.unx.mx", password: "Demo1234" };

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

// ── El oráculo: lo produce el seed contra la BD real ────────────────────────

console.log("\nE2E LUI-9 · sembrando para obtener el oráculo…");
const salidaSeed = await ejecutar("npx", [
  "convex",
  "run",
  "seed:cargarDatosDePrueba",
  // El literal del guard solo-dev (LUI-18): sin él la mutation ni siquiera valida.
  '{"confirmar":"SOLO_DEV"}',
]);
const json = salidaSeed.match(/\{[\s\S]*\}/);
if (!json) {
  console.error("✘ No se pudo leer la salida del seed:\n", salidaSeed.slice(0, 500));
  process.exit(1);
}
const esperado = JSON.parse(json[0]).panelEsperado;
console.log(
  `Oráculo: ${esperado.gruposActivos} grupos · ${esperado.alumnosRegistrados} alumnos · ${esperado.examenesAplicadosMes} exámenes este mes\n`,
);

// ── La fecha, REIMPLEMENTADA de forma independiente ─────────────────────────
// A propósito duplicada de `convex/fechas.ts`: una reimplementación independiente
// es lo único que caza un off-by-one de zona horaria. Un regex de forma
// (/^\w+ \d+ de \w+ de \d{4}$/) solo probaría que «parece una fecha».
const OFFSET_MX_MS = 6 * 60 * 60 * 1000;
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
               "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaLargaEsperada() {
  const d = new Date(Date.now() - OFFSET_MX_MS);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

const navegador = await chromium.launch({ headless: !HEADED });
const page = await navegador.newPage();

try {
  await page.goto(`${BASE}/login`);
  await page.fill("#correo", ADMIN.correo);
  await page.fill("#password", ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
  await page.waitForTimeout(2500);

  console.log("1 · Encabezado");
  const h1 = (await page.textContent("h1"))?.trim();
  check(
    "saluda con el NOMBRE DE PILA («Hola, Mayra»)",
    h1 === "Hola, Mayra",
    `recibido: ${h1} — si dice «Mayra Torres» se usó sesion.actual en vez del perfil`,
  );
  const sub = (await page.textContent("h1 + p"))?.trim();
  check(
    "la fecha larga es la del centro de México",
    sub === fechaLargaEsperada(),
    `esperado: «${fechaLargaEsperada()}» · recibido: «${sub}»`,
  );

  console.log("\n2 · Métricas (contra el oráculo del seed)");
  const cuerpo = await page.textContent("body");
  for (const [etiqueta, valor] of [
    ["Grupos activos", esperado.gruposActivos],
    ["Alumnos registrados", esperado.alumnosRegistrados],
    ["Exámenes aplicados este mes", esperado.examenesAplicadosMes],
  ]) {
    const tarjeta = page
      .locator("div", { hasText: new RegExp(`^${valor}${etiqueta}$`) })
      .first();
    const hay = (await tarjeta.count()) > 0 || cuerpo.includes(etiqueta);
    const texto = await page
      .locator(`text=${etiqueta}`)
      .first()
      .locator("xpath=..")
      .textContent()
      .catch(() => "");
    check(
      `${etiqueta} = ${valor}`,
      hay && texto.replace(/\s/g, "").includes(String(valor)),
      `recibido: ${texto.replace(/\s+/g, " ").trim()}`,
    );
  }

  console.log("\n3 · Accesos directos");
  // ACOTADO a la región: el sidebar también renderiza enlaces, así que un conteo
  // global JAMÁS daría 5. Que la región tenga nombre accesible es parte del AC.
  const region = page.getByRole("region", { name: "Accesos directos" });
  check("la sección es un landmark con nombre accesible", (await region.count()) > 0);
  const enlaces = region.getByRole("link");
  check("hay exactamente 5 accesos directos", (await enlaces.count()) === 5,
    `recibidos: ${await enlaces.count()}`);

  const ESPERADOS = [
    ["Alumnos", "/admin/alumnos"],
    ["Grupos", "/admin/grupos"],
    ["Usuarios y permisos", "/admin/usuarios"],
    ["Temario", "/admin/temario"],
    ["Resumen de exámenes", "/admin/examenes"],
  ];
  for (const [label, href] of ESPERADOS) {
    // `getByRole("link")` y no `("button")`: los accesos directos NAVEGAN. Que el
    // rol sea `link` ES el criterio de accesibilidad, no un detalle de test.
    const l = region.getByRole("link", { name: new RegExp(`^${label}`) });
    const real = await l.first().getAttribute("href").catch(() => null);
    check(`«${label}» es un enlace a ${href}`, real === href, `href: ${real}`);
  }

  console.log("\n4 · Tabla «Últimos exámenes aplicados»");
  for (const col of ["Examen", "Grupo", "Fecha", "Puntaje promedio"]) {
    check(`columna «${col}»`, cuerpo.includes(col));
  }
  const filas = page.locator("tbody tr");
  check(
    `muestra ${esperado.ultimosExamenes.length} filas`,
    (await filas.count()) === esperado.ultimosExamenes.length,
    `recibidas: ${await filas.count()}`,
  );
  for (let i = 0; i < esperado.ultimosExamenes.length; i++) {
    const e = esperado.ultimosExamenes[i];
    const t = (await filas.nth(i).textContent()) ?? "";
    check(
      `fila ${i + 1}: ${e.examen} · ${e.grupo}`,
      t.includes(e.examen) && t.includes(e.grupo),
      `recibido: ${t.replace(/\s+/g, " ").trim()}`,
    );
  }
  // El fixture pone una asignación SIN intentos: su puntaje debe ser «—», no 0.
  check(
    "una asignación sin intentos muestra «—», no 0",
    ((await filas.first().textContent()) ?? "").includes("—"),
  );
  // El examen FUTURO no puede aparecer en «Últimos exámenes APLICADOS».
  const cuerpoTabla = (await page.locator("tbody").textContent()) ?? "";
  check(
    "el examen con ventana futura NO aparece",
    !cuerpoTabla.includes("Simulacro General 3"),
  );

  console.log("\n5 · Navegación y estado activo del sidebar");
  await region.getByRole("link", { name: /^Grupos/ }).click();
  await page.waitForURL(/\/admin\/grupos/, { timeout: 15_000 });
  check("clic en «Grupos» navega a /admin/grupos", page.url().includes("/admin/grupos"));
  await page.waitForTimeout(1200);
  const nav = page.locator("aside nav");
  const activos = await nav.locator('[aria-current="page"]').allTextContents();
  check(
    "solo «Grupos» está marcado como página actual",
    activos.length === 1 && activos[0].includes("Grupos"),
    `aria-current en: ${JSON.stringify(activos)} — si incluye «Inicio», volvió el bug del startsWith`,
  );
} catch (e) {
  fallos++;
  console.error("\n✘ Excepción no controlada:", e);
} finally {
  await navegador.close();
}

console.log(`\n──────────────\n${ok} pasaron · ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
