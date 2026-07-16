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

// Pizarra limpia: el CRUD de la Entrega 2 muta el temario, y el upsert del seed
// CONVERGE pero no RETIRA nodos extra. Sin este barrido, el residuo de una corrida
// anterior contaminaría el oráculo de solo-lectura de abajo.
async function pizarraLimpia() {
  await ejecutar("npx", [
    "convex",
    "run",
    "seed:limpiarContenidoDemo",
    '{"confirmar":"SOLO_DEV"}',
  ]);
  return ejecutar("npx", [
    "convex",
    "run",
    "seed:cargarDatosDePrueba",
    '{"confirmar":"SOLO_DEV"}',
  ]);
}

console.log("\nE2E LUI-18 · pizarra limpia + oráculo…");
const salidaSeed = await pizarraLimpia();
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

/** Espera a que una condición del DOM se cumpla (las mutaciones refrescan la
 *  query de forma reactiva, no síncrona: un `waitForTimeout` fijo es frágil). */
async function esperar(cond, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return true;
    if (Date.now() - t0 > ms) return false;
    await page.waitForTimeout(150);
  }
}

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
  // Desde la Entrega 2 cada fila tiene 5 botones de acción además del chevron, así
  // que `getByRole("button")` es ambiguo: el chevron se apunta por su nombre.
  const chevron = (fila) =>
    fila.getByRole("button", { name: /^(Expandir|Contraer) / });
  const filaTextos = filaDe("Textos expositivos");
  check(
    "el área retirada lleva badge «Inactivo»",
    ((await filaTextos.textContent()) ?? "").includes("Inactivo"),
  );
  await chevron(filaTextos).click();
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
    (await chevron(filaDe("Matemáticas financieras")).count()) === 0,
  );
  check(
    "una sección con áreas SÍ tiene chevron",
    (await chevron(filaDe("Pensamiento matemático")).count()) === 1,
  );

  console.log("\n10 · Colapsar y expandir");
  const pm = filaDe("Pensamiento matemático");
  check("las secciones arrancan expandidas", await chevron(pm).getAttribute("aria-expanded") === "true");
  check("«Álgebra» es visible", (await filaDe("Álgebra").count()) > 0);
  await chevron(pm).click();
  await page.waitForTimeout(400);
  check("al colapsar, «Álgebra» desaparece", (await filaDe("Álgebra").count()) === 0);
  await chevron(pm).click();
  await page.waitForTimeout(400);
  check("al expandir, «Álgebra» vuelve", (await filaDe("Álgebra").count()) > 0);
  check(
    "las áreas arrancan colapsadas (sus subtemas no se ven)",
    (await filaDe("Ecuaciones lineales").count()) === 0,
  );

  // ── CRUD (Entrega 2) ──────────────────────────────────────────────────────

  const abrirAgregar = async () => {
    await page.getByRole("button", { name: "Agregar sección o módulo" }).click();
    await page.waitForTimeout(300);
  };
  const crear = async ({ tipo, seccion, area, nombre }) => {
    await abrirAgregar();
    await page.getByLabel("Tipo").selectOption({ label: tipo });
    await page.waitForTimeout(200);
    if (seccion)
      await page.getByLabel("Sección", { exact: true }).selectOption({ label: seccion });
    if (area) {
      await page.waitForTimeout(200);
      await page.getByLabel("Área temática").selectOption({ label: area });
    }
    await page.locator("#temario-nombre").fill(nombre);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.waitForTimeout(800);
  };

  console.log("\n11 · Crear los 4 tipos desde el modal");
  await crear({ tipo: "Sección de núcleo", nombre: "E2E Sección" });
  check(
    "crea una sección de núcleo",
    await esperar(async () => (await filaDe("E2E Sección").count()) > 0),
  );
  await crear({ tipo: "Módulo", nombre: "E2E Módulo" });
  const listaModCrud = page.getByRole("list", { name: /módulos/i });
  check(
    "el módulo nuevo aparece BAJO el separador MÓDULOS",
    await esperar(async () =>
      ((await listaModCrud.textContent()) ?? "").includes("E2E Módulo"),
    ),
  );
  await crear({ tipo: "Área temática", seccion: "E2E Sección", nombre: "E2E Área" });
  check(
    "crea un área bajo su sección",
    await esperar(async () => (await filaDe("E2E Área").count()) > 0),
  );
  await crear({
    tipo: "Subtema",
    seccion: "E2E Sección",
    area: "E2E Área",
    nombre: "E2E Subtema",
  });
  check(
    "crea un subtema y AUTO-EXPANDE su área (queda visible)",
    await esperar(async () => (await filaDe("E2E Subtema").count()) > 0),
  );

  console.log("\n12 · Unicidad por alcance (no global)");
  await crear({ tipo: "Área temática", seccion: "E2E Sección", nombre: "Aritmética" });
  check(
    "«Aritmética» se puede crear bajo E2E Sección aunque exista bajo Pensamiento matemático",
    (await page.locator("li").filter({ hasText: "Aritmética" }).count()) >= 2,
  );
  // Duplicado dentro de la MISMA sección → falla y el modal sigue abierto.
  await abrirAgregar();
  await page.getByLabel("Tipo").selectOption({ label: "Área temática" });
  await page.waitForTimeout(200);
  await page.getByLabel("Sección", { exact: true }).selectOption({ label: "E2E Sección" });
  await page.locator("#temario-nombre").fill("E2E Área");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.waitForTimeout(500);
  check(
    "un área duplicada en la MISMA sección se rechaza con mensaje",
    ((await page.locator("body").textContent()) ?? "").includes("Ya existe un área"),
  );
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForTimeout(300);

  console.log("\n13 · Renombrar");
  await filaDe("E2E Subtema").getByRole("button", { name: /^Renombrar/ }).click();
  await page.waitForTimeout(300);
  await page.locator("#temario-renombrar-nombre").fill("E2E Subtema R");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  check(
    "renombrar refleja el nombre nuevo",
    await esperar(async () => (await filaDe("E2E Subtema R").count()) > 0),
  );
  check("el nombre viejo ya no está", (await filaDe("E2E Subtema").count()) === 0);

  console.log("\n14 · Reordenar (renumerado que persiste)");
  const ordenNucleo = async () =>
    (await page.getByRole("list", { name: "Secciones de núcleo" })
      .locator('> li[aria-level="1"]').allTextContents()).map((t) => t.trim());
  const antes = await ordenNucleo();
  // «E2E Sección» es la última del núcleo; subirla intercambia con la penúltima.
  await filaDe("E2E Sección").getByRole("button", { name: /^Subir/ }).click();
  await page.waitForTimeout(700);
  const despues = await ordenNucleo();
  check(
    "subir cambió el orden del núcleo",
    JSON.stringify(antes) !== JSON.stringify(despues),
    `antes: ${antes} · después: ${despues}`,
  );
  await page.reload();
  await page.waitForTimeout(2500);
  const trasRecarga = await ordenNucleo();
  check(
    "el nuevo orden PERSISTE tras recargar (renumerado, no swap efímero)",
    JSON.stringify(trasRecarga) === JSON.stringify(despues),
    `recarga: ${trasRecarga}`,
  );
  const primeraNucleo = filaDe(trasRecarga[0]);
  check(
    "la flecha «subir» de la primera sección está deshabilitada",
    await primeraNucleo.getByRole("button", { name: /^Subir/ }).isDisabled(),
  );
  const ultimaNucleo = filaDe(trasRecarga[trasRecarga.length - 1]);
  check(
    "la flecha «bajar» de la última del núcleo está deshabilitada (no cruza a MÓDULOS)",
    await ultimaNucleo.getByRole("button", { name: /^Bajar/ }).isDisabled(),
  );

  console.log("\n15 · Desactivar (con confirmación) / Reactivar (inmediato)");
  await filaDe("E2E Módulo").getByRole("button", { name: /^Desactivar/ }).click();
  await page.waitForTimeout(300);
  check(
    "desactivar pide confirmación",
    (await page.getByRole("button", { name: "Desactivar", exact: true }).count()) > 0,
  );
  await page.getByRole("button", { name: "Desactivar", exact: true }).click();
  check(
    "el módulo queda marcado Inactivo",
    await esperar(async () =>
      ((await filaDe("E2E Módulo").textContent()) ?? "").includes("Inactivo"),
    ),
  );
  await filaDe("E2E Módulo").getByRole("button", { name: /^Reactivar/ }).click();
  check(
    "reactivar es inmediato (sin modal) y quita el badge",
    await esperar(
      async () =>
        !((await filaDe("E2E Módulo").textContent()) ?? "").includes("Inactivo"),
    ),
  );

  console.log("\n16 · Eliminar (hoja, gate de reactivos, cascada)");
  check(
    "una fila con reactivos NO muestra el botón Eliminar",
    (await filaDe("Pensamiento matemático").getByRole("button", { name: /^Eliminar/ }).count()) === 0,
  );
  // El `page.reload()` de la §14 reseteó la expansión a los defaults (áreas
  // colapsadas), así que «E2E Subtema R» está oculto bajo «E2E Área». Se expande.
  await chevron(filaDe("E2E Área")).click();
  await page.waitForTimeout(400);
  await filaDe("E2E Subtema R").getByRole("button", { name: /^Eliminar/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  check(
    "un subtema con 0 reactivos se elimina",
    await esperar(async () => (await filaDe("E2E Subtema R").count()) === 0),
  );
  // Cascada: «E2E Sección» tiene dos áreas vacías (E2E Área, Aritmética) → 0 reactivos.
  await filaDe("E2E Sección").getByRole("button", { name: /^Eliminar/ }).click();
  await page.waitForTimeout(300);
  check(
    "el confirm de cascada nombra las áreas que se irán",
    ((await page.locator("body").textContent()) ?? "").includes("Se eliminarán también"),
  );
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  check(
    "la cascada elimina la sección y su estructura vacía",
    await esperar(async () => (await filaDe("E2E Sección").count()) === 0),
  );
  check("y sus áreas hijas también (E2E Área)", (await filaDe("E2E Área").count()) === 0);
} catch (e) {
  fallos++;
  console.error("\n✘ Excepción no controlada:", e);
} finally {
  await navegador.close();
  // Restaura el fixture para no filtrar residuo del CRUD a otras suites.
  console.log("\nRestaurando fixture…");
  await pizarraLimpia();
}

console.log(`\n──────────────\n${ok} pasaron · ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
