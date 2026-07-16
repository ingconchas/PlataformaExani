/**
 * E2E de LUI-18 (Entrega 1) — Gestión de temario, árbol de lectura (`/admin/temario`).
 *
 * **El oráculo NO está escrito aquí.** Lo produce el seed (`temarioEsperado`),
 * calculado contra la BD real y con su propio código de conteo. Escribir «Álgebra
 * 8» en este archivo sería falso en cuanto el fixture cambie.
 *
 * Las aserciones son DISCRIMINANTES: cada una existe porque una implementación
 * plausible pero mal hecha la rompería de forma visible.
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   1. npm install && npx playwright install chromium
 *   2. npx convex dev        (en otra terminal)
 *   3. npm run dev           (en otra terminal → http://localhost:3000)
 *   4. npx convex run seedAuth:credencialesDemo '{"confirmar":"SOLO_DEV"}'
 *      (el seed base lo corre este script para obtener el oráculo fresco)
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/e2e-lui18.mjs
 *   E2E_HEADED=1 node scripts/e2e-lui18.mjs
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

console.log("\nE2E LUI-18 · sembrando para obtener el oráculo…");
const salidaSeed = await ejecutar("npx", [
  "convex",
  "run",
  "seed:cargarDatosDePrueba",
  '{"confirmar":"SOLO_DEV"}',
]);
const json = salidaSeed.match(/\{[\s\S]*\}/);
if (!json) {
  console.error("✘ No se pudo leer la salida del seed:\n", salidaSeed.slice(0, 600));
  process.exit(1);
}
const esperado = JSON.parse(json[0]).temarioEsperado;
if (!esperado) {
  console.error("✘ El seed no devolvió `temarioEsperado`.");
  process.exit(1);
}
const nucleo = esperado.nucleo.map((s) => s.nombre);
const modulos = esperado.modulos.map((s) => s.nombre);
console.log(
  `Oráculo: ${nucleo.length} secciones de núcleo · ${modulos.length} módulos · ${esperado.totalFilas} filas\n`,
);

const buscar = (lista, nombre) => lista.find((x) => x.nombre === nombre);

/**
 * El conteo de una fila, sin ambigüedad.
 *
 * El `textContent` de un `<li>` sale pegado: «Pensamiento matemático10 reactivos».
 * Dos trampas reales que ya mordieron:
 *  · `\b` entre el nombre y el número NO existe («o» y «1» son ambos caracteres
 *    de palabra), así que `\b10 reactivos\b` nunca casa.
 *  · `includes("0 reactivos")` casa dentro de «10 reactivos» → un 10 pasaría por 0.
 * `(^|\D)` ancla al primer dígito del número: para n=0, el «0» de «10» viene
 * precedido de «1», que es dígito, así que no casa. Discrimina de verdad.
 */
const regexConteo = (n) => new RegExp(`(^|\\D)${n} ${n === 1 ? "reactivo" : "reactivos"}$`);

// ── Pruebas ─────────────────────────────────────────────────────────────────

const navegador = await chromium.launch({ headless: !HEADED });
const page = await navegador.newPage();

/** La fila de un elemento, ubicada por el `<span>` cuyo texto es EXACTAMENTE su
 *  nombre — no por el texto del `<li>`, que viene pegado al contador. */
const filaDe = (nombre) =>
  page
    .locator("li")
    .filter({ has: page.getByText(nombre, { exact: true }) })
    .first();

try {
  await page.goto(`${BASE}/login`);
  await page.fill("#correo", ADMIN.correo);
  await page.fill("#password", ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
  await page.goto(`${BASE}/admin/temario`);
  await page.waitForTimeout(2500);

  console.log("1 · La pantalla ya no es un placeholder");
  const cuerpo = (await page.textContent("body")) ?? "";
  check("no queda rastro del ScreenPlaceholder", !cuerpo.includes("Pantalla por construir"));
  check(
    "el encabezado es el del diseño",
    (await page.textContent("h1"))?.trim() === "Temario",
  );
  check(
    "la nota al pie del mock está verbatim",
    cuerpo.includes(
      "Un elemento con reactivos asociados solo se puede desactivar, no eliminar",
    ),
  );

  console.log("\n2 · Las dos listas y el separador MÓDULOS");
  // Dos `<ul>` con nombre accesible, no una lista con una fila-separador falsa.
  const listaNucleo = page.getByRole("list", { name: "Secciones de núcleo" });
  check("«Secciones de núcleo» es una lista con nombre", (await listaNucleo.count()) === 1);
  const listaModulos = page.getByRole("list", { name: /módulos/i });
  check("«Módulos» es una lista con nombre", (await listaModulos.count()) === 1);

  console.log("\n3 · Orden de las secciones (por `orden`, NO alfabético)");
  // El fixture pone Pensamiento matemático antes que Comprensión lectora: si
  // alguien ordena por `nombre`, este check truena.
  const seccionesEnPantalla = await listaNucleo
    .locator('> li[aria-level="1"]')
    .allTextContents();
  const soloNombres = seccionesEnPantalla.map((t) => t.trim());
  for (const [i, nombre] of nucleo.entries()) {
    check(
      `núcleo #${i + 1} es «${nombre}»`,
      (soloNombres[i] ?? "").includes(nombre),
      `recibido: ${soloNombres[i]}`,
    );
  }
  const alfabetico = [...nucleo].sort((a, b) => a.localeCompare(b, "es"));
  check(
    "el orden del fixture NO es el alfabético (la prueba discrimina)",
    JSON.stringify(nucleo) !== JSON.stringify(alfabetico),
    "si fueran iguales, este archivo no probaría nada sobre `orden`",
  );

  console.log("\n4 · TODOS los módulos van después del separador");
  const textoNucleo = (await listaNucleo.textContent()) ?? "";
  for (const nombre of modulos) {
    check(`«${nombre}» NO está en la lista de núcleo`, !textoNucleo.includes(nombre));
  }
  const textoModulos = (await listaModulos.textContent()) ?? "";
  for (const nombre of modulos) {
    check(`«${nombre}» está bajo MÓDULOS`, textoModulos.includes(nombre));
  }

  console.log("\n5 · Contadores contra el oráculo");
  for (const s of [...esperado.nucleo, ...esperado.modulos]) {
    const t = ((await filaDe(s.nombre).textContent()) ?? "").trim();
    check(
      `«${s.nombre}» → ${s.reactivos}`,
      regexConteo(s.reactivos).test(t),
      `recibido: ${t.replace(/\s+/g, " ")}`,
    );
  }

  console.log("\n6 · La regla del mock: el inactivo SUMA hacia arriba");
  // Álgebra = Ecuaciones lineales + Sistemas + Productos notables(INACTIVO).
  // Si el contador excluyera descendientes inactivos, o filtrara por
  // `reactivo.activo`, este número bajaría.
  const algebra = buscar(esperado.areas, "Álgebra");
  const productos = buscar(esperado.subtemas, "Productos notables");
  check(
    "«Productos notables» está inactivo y TIENE reactivos (si no, el fixture no discrimina)",
    productos && productos.activo === false && productos.reactivos > 0,
    `recibido: ${JSON.stringify(productos)}`,
  );
  const sumaHijos = esperado.subtemas
    .filter((s) =>
      ["Ecuaciones lineales", "Sistemas de ecuaciones", "Productos notables"].includes(
        s.nombre,
      ),
    )
    .reduce((a, s) => a + s.reactivos, 0);
  check(
    `Álgebra (${algebra?.reactivos}) = suma de sus subtemas (${sumaHijos}), inactivo incluido`,
    algebra?.reactivos === sumaHijos,
  );

  console.log("\n7 · `activo` vs `disponible`: NO hubo cascada de escritura");
  // «Textos expositivos» está inactiva; «Idea principal» cuelga de ella y debe
  // seguir `activo: true` en la BD. Si alguien cascadeó el estado a los hijos,
  // reactivar el área sería irreversible — y esto lo caza.
  const textos = buscar(esperado.areas, "Textos expositivos");
  const idea = buscar(esperado.subtemas, "Idea principal");
  check("«Textos expositivos» está INACTIVA", textos?.activo === false);
  check(
    "«Idea principal» sigue ACTIVO pese a su padre inactivo",
    idea?.activo === true,
    "si salió false, se cascadeó `activo` a la BD y el reactivar ya no es reversible",
  );

  console.log("\n8 · El badge «Inactivo» distingue retirado de heredado");
  // «Comprensión lectora» ya viene expandida (las secciones arrancan abiertas),
  // así que su área es visible sin tocar nada. Solo hay que abrir el ÁREA para
  // llegar al subtema.
  const filaTextos = filaDe("Textos expositivos");
  check(
    "el área retirada lleva badge «Inactivo»",
    ((await filaTextos.textContent()) ?? "").includes("Inactivo"),
  );
  await filaTextos.getByRole("button").click();
  await page.waitForTimeout(400);
  const filaIdea = filaDe("Idea principal");
  check(
    "el descendiente NO lleva badge (no está retirado él, lo está su padre)",
    !((await filaIdea.textContent()) ?? "").includes("Inactivo"),
  );

  console.log("\n9 · Chevron solo si tiene hijos");
  // «Matemáticas financieras» es un módulo PLANO: un chevron ahí sería una
  // promesa vacía.
  check(
    "el módulo plano NO tiene chevron",
    (await filaDe("Matemáticas financieras").getByRole("button").count()) === 0,
  );
  check(
    "una sección con áreas SÍ tiene chevron",
    (await filaDe("Pensamiento matemático").getByRole("button").count()) === 1,
  );

  console.log("\n10 · Colapsar y expandir");
  const pm = filaDe("Pensamiento matemático");
  check("las secciones arrancan expandidas", await pm.getByRole("button").getAttribute("aria-expanded") === "true");
  check("«Álgebra» es visible", (await filaDe("Álgebra").count()) > 0);
  await pm.getByRole("button").click();
  await page.waitForTimeout(400);
  check("al colapsar, «Álgebra» desaparece", (await filaDe("Álgebra").count()) === 0);
  await pm.getByRole("button").click();
  await page.waitForTimeout(400);
  check("al expandir, «Álgebra» vuelve", (await filaDe("Álgebra").count()) > 0);
  check(
    "las áreas arrancan colapsadas (sus subtemas no se ven)",
    (await filaDe("Ecuaciones lineales").count()) === 0,
  );
} catch (e) {
  fallos++;
  console.error("\n✘ Excepción no controlada:", e);
} finally {
  await navegador.close();
}

console.log(`\n──────────────\n${ok} pasaron · ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
