/**
 * E2E de LUI-16 — presentaciones «relación de columnas» y «ordenamiento».
 *
 * CREA y EDITA reactivos, así que hace pizarra limpia al inicio y restaura el fixture en
 * `finally`. ⚠️ Los E2E reinicializan la MISMA BD de dev: **NUNCA correr dos a la vez**.
 *
 * Archivo aparte (no una sección más de `e2e-lui15.mjs`) a propósito: ese archivo ya tiene
 * 16 secciones y su §7 verifica CONTEOS ABSOLUTOS del temario derivados a mano. Todo lo que
 * este E2E crea va bajo «Aritmética / Operaciones con fracciones», que ninguna otra suite
 * cuenta.
 *
 * Aserciones DISCRIMINANTES, marcadas con ⭐:
 *  · §6 quitar el renglón de EN MEDIO — falla si los renglones usan `key={índice}`
 *    (`RichTextEditor` no es controlado: el editor conservaría el contenido del renglón
 *    borrado y lo escribiría encima del siguiente).
 *  · §9 editar sin tocar el material — falla si `actualizar` usa un `material` opcional
 *    plano (el patch borraría el campo).
 *  · §11 responsive GEOMÉTRICO por consumidor — afirmar sobre clases CSS pasaría aunque el
 *    container query no aplicara.
 *
 * Lo que este E2E NO cubre, a propósito (ver `scripts/test-material.ts`): combinaciones
 * ilegales, cotas de tamaño y el default «argumento ausente ⇒ mantener». El formulario nunca
 * las envía y `npx convex run` no pasa `requireStaff`, así que se prueban en el módulo puro.
 *
 * Requisitos: npx convex dev · npm run dev · (playwright chromium instalado).
 * Uso: node scripts/e2e-lui16.mjs   ·   E2E_HEADED=1 node scripts/e2e-lui16.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx";

const ENUN_DIRECTA = "E2E LUI-16 pregunta directa sin material";
const ENUN_COLUMNAS = "E2E LUI-16 relacion de columnas";
const ENUN_ORDEN = "E2E LUI-16 ordenamiento de pasos";
const EN_USO = "2x + 6 = 14"; // reactivo del fixture en un examen publicado con asignación
const LEGADO = "0.375"; // «¿Qué fracción es equivalente a 0.375?» — libre, sin material

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

/** `npx convex run` que ABORTA si el subproceso falla. Ignorar el código de salida haría
 *  que la suite corriera sobre datos de la corrida anterior: eso debilita justo la
 *  afirmación de idempotencia (correrla dos veces) y produce verdes dependientes del
 *  estado previo. */
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

console.log("\nE2E LUI-16 · pizarra limpia + credenciales…");
try {
  await pizarraLimpia();
} catch (e) {
  // Sin fixture no hay prueba: mejor morir aquí que dar un verde sobre datos viejos.
  console.error(`\n✘ No se pudo preparar la BD de dev — ${e.message}`);
  process.exit(1);
}

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

async function buscar(pg, texto) {
  const box = pg.getByPlaceholder("Buscar en el enunciado…");
  await box.fill("");
  await box.fill(texto);
  await poller(pg)(async () => (await filas(pg).count()) >= 1);
}

/** El recuadro de material. `exact` es OBLIGATORIO: Playwright busca por SUBCADENA del
 *  nombre accesible, y los editores del formulario se llaman «Editor: Columna 1, renglón 1». */
const recuadro = (pg) =>
  pg.getByRole("group", { name: "Material del reactivo", exact: true });
const listaMaterial = (pg, titulo) =>
  pg.getByRole("group", { name: titulo, exact: true });
const editorRenglon = (pg, nombre) => pg.getByRole("textbox", { name: nombre });

/** Rellena la clasificación y la dificultad comunes a todas las altas. */
async function completarClasificacion(pg) {
  await seleccionar(pg, "Sección", "Pensamiento matemático");
  await seleccionar(pg, "Área temática", "Aritmética");
  await seleccionar(pg, "Subtema", "Operaciones con fracciones");
  await pg.getByRole("button", { name: "Intermedio" }).click();
}

async function completarOpciones(pg, textos, correcta = "A") {
  const letras = ["A", "B", "C", "D"];
  for (let i = 0; i < textos.length; i++)
    await pg.getByPlaceholder(`Opción ${letras[i]}`).fill(textos[i]);
  await pg.getByLabel(`Marcar la opción ${correcta} como correcta`).check();
  await pg
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Explicación E2E de la respuesta correcta.");
}

/**
 * Abre el modal de preview del banco para un reactivo y espera a que su CONTENIDO esté
 * cargado. Esperar solo a que exista el `dialog` no basta: `obtener` es un `useQuery` y el
 * modal se pinta vacío mientras resuelve — una aserción NEGATIVA («no hay recuadro»)
 * pasaría en falso sobre el estado de carga.
 */
async function abrirPreview(pg, texto) {
  await pg.goto(`${BASE}/instructor/reactivos`);
  await poller(pg)(async () => (await filas(pg).count()) > 0);
  await buscar(pg, texto);
  await filaDe(pg, texto).getByRole("button", { name: /^Ver el reactivo/ }).click();
  const dialogo = pg.getByRole("dialog");
  const contiene = async (marcador) =>
    ((await dialogo.textContent().catch(() => "")) ?? "").includes(marcador);
  // Marcador inequívoco de contenido CARGADO: la explicación solo la pinta el modal cuando
  // `obtener` ya resolvió. Los reactivos del seed traen otra explicación, así que sirve
  // también el propio enunciado.
  const cargado = await poller(pg)(
    async () =>
      (await contiene("Explicación E2E de la respuesta correcta.")) ||
      (await contiene(texto.slice(0, 24))),
  );
  // ⚠️ Si NO cargó hay que MORIR, no seguir: una aserción negativa posterior («no pinta
  // recuadro de material») pasaría en verde contra el estado de carga.
  if (!cargado)
    throw new Error(
      `El modal de «${texto}» no cargó su contenido: las aserciones negativas serían falsos verdes.`,
    );
}

const ctxInst = await navegador.newContext();
const page = await ctxInst.newPage();
const esperar = poller(page);
// Quitar un renglón pide confirmación (las opciones referencian POSICIONES). Se acepta
// siempre; §6 verifica además que el diálogo aparece.
let dialogos = 0;
page.on("dialog", (d) => {
  dialogos++;
  d.accept();
});

try {
  await login(page, INSTRUCTOR, /\/instructor/);

  console.log("1 · Regresión: la presentación DIRECTA sigue intacta (ausente = directa)");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill(ENUN_DIRECTA);
  check(
    "la pestaña «Pregunta directa» arranca activa",
    (await page.getByRole("tab", { name: "Pregunta directa" }).getAttribute("aria-selected")) ===
      "true",
  );
  check(
    "sin material, la vista previa NO pinta recuadro",
    (await recuadro(page).count()) === 0,
  );
  await completarOpciones(page, ["Alfa", "Beta", "Gamma"], "B");
  await completarClasificacion(page);
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await abrirPreview(page, ENUN_DIRECTA);
  check(
    "el modal de un reactivo directo NO pinta recuadro de material",
    (await recuadro(page).count()) === 0,
  );
  check(
    "el banco NO le pone insignia de presentación",
    !((await filaDe(page, ENUN_DIRECTA).textContent()) ?? "").includes("Columnas"),
  );
  await page.keyboard.press("Escape");

  console.log("\n2 · Alta de RELACIÓN DE COLUMNAS (con renglón agregado)");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill(ENUN_COLUMNAS);
  await page.getByRole("tab", { name: "Relación de columnas" }).click();
  check(
    "aparecen las dos listas de captura",
    (await editorRenglon(page, "Columna 1, renglón 1").count()) === 1 &&
      (await editorRenglon(page, "Columna 2, renglón 1").count()) === 1,
  );
  await editorRenglon(page, "Columna 1, renglón 1").fill("Fracción propia");
  await editorRenglon(page, "Columna 1, renglón 2").fill("Fracción impropia");
  await editorRenglon(page, "Columna 1, renglón 3").fill("Número mixto");
  await editorRenglon(page, "Columna 2, renglón 1").fill("7/3");
  await editorRenglon(page, "Columna 2, renglón 2").fill("2 1/3");
  await editorRenglon(page, "Columna 2, renglón 3").fill("3/7");
  // Un cuarto renglón SOLO en la columna 2: las columnas pueden tener distinto largo
  // (distractores), y así se ejercita «Agregar renglón».
  await page.getByRole("button", { name: "Agregar renglón a Columna 2" }).click();
  await editorRenglon(page, "Columna 2, renglón 4").fill("5/5");
  check(
    "«Agregar renglón» añade un 4º renglón a la columna 2",
    (await editorRenglon(page, "Columna 2, renglón 4").count()) === 1,
  );

  console.log("\n3 · ⭐ Vista previa VIVA (el componente sanea HTML crudo de TipTap)");
  check("la vista previa ya pinta el recuadro antes de guardar", (await recuadro(page).count()) === 1);
  const previaTexto = (await recuadro(page).textContent()) ?? "";
  check("muestra el título «Columna 1»", previaTexto.includes("Columna 1"));
  check("muestra el título «Columna 2»", previaTexto.includes("Columna 2"));
  check("muestra un renglón de la columna 1", previaTexto.includes("Fracción impropia"));
  check("muestra el distractor de la columna 2", previaTexto.includes("5/5"));
  check("etiqueta la columna 1 con números", previaTexto.includes("1."));
  check("etiqueta la columna 2 con letras", previaTexto.includes("a."));

  await completarOpciones(page, ["1c, 2a, 3b", "1a, 2b, 3c", "1b, 2c, 3a"], "A");
  await completarClasificacion(page);
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });

  console.log("\n4 · El MISMO recuadro en el modal del banco");
  await abrirPreview(page, ENUN_COLUMNAS);
  check("el modal pinta el recuadro de material", (await recuadro(page).count()) === 1);
  const modalTexto = (await recuadro(page).textContent()) ?? "";
  check("conserva los renglones", modalTexto.includes("Número mixto") && modalTexto.includes("2 1/3"));
  check(
    "el orden de las listas es Columna 1 y luego Columna 2",
    modalTexto.indexOf("Columna 1") < modalTexto.indexOf("Columna 2"),
  );
  check(
    "las opciones de respuesta (combinaciones) siguen siendo texto normal",
    ((await page.getByRole("dialog").textContent()) ?? "").includes("1c, 2a, 3b"),
  );
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, ENUN_COLUMNAS);
  check(
    "el banco muestra la insignia «Columnas»",
    ((await filaDe(page, ENUN_COLUMNAS).textContent()) ?? "").includes("Columnas"),
  );

  console.log("\n5 · Rehidratación al editar");
  await filaDe(page, ENUN_COLUMNAS)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await esperar(async () => (await editorRenglon(page, "Columna 1, renglón 1").count()) === 1);
  check(
    "la pestaña activa es «Relación de columnas»",
    (await page.getByRole("tab", { name: "Relación de columnas" }).getAttribute("aria-selected")) ===
      "true",
  );
  check(
    "el renglón 2 de la columna 1 trae su texto",
    ((await editorRenglon(page, "Columna 1, renglón 2").textContent()) ?? "").includes(
      "Fracción impropia",
    ),
  );
  check(
    "la columna 2 conserva sus 4 renglones",
    (await editorRenglon(page, "Columna 2, renglón 4").count()) === 1,
  );

  console.log("\n6 · ⭐ Quitar el renglón de EN MEDIO (falla con key={índice})");
  const dialogosAntes = dialogos;
  await page.getByRole("button", { name: "Quitar el renglón 2 de Columna 1" }).click();
  await esperar(async () => (await editorRenglon(page, "Columna 1, renglón 3").count()) === 0);
  check("pide confirmación antes de quitar", dialogos > dialogosAntes);
  check(
    "la columna 1 queda con 2 renglones",
    (await editorRenglon(page, "Columna 1, renglón 2").count()) === 1 &&
      (await editorRenglon(page, "Columna 1, renglón 3").count()) === 0,
  );
  const renglon2 = (await editorRenglon(page, "Columna 1, renglón 2").textContent()) ?? "";
  check(
    "⭐ el renglón 2 ahora contiene «Número mixto» (el 3º), NO el borrado",
    renglon2.includes("Número mixto") && !renglon2.includes("Fracción impropia"),
    `contenía: «${renglon2.trim()}»`,
  );
  check(
    "el renglón 1 no se movió",
    ((await editorRenglon(page, "Columna 1, renglón 1").textContent()) ?? "").includes(
      "Fracción propia",
    ),
  );
  // Y se PERSISTE lo que se ve.
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await abrirPreview(page, ENUN_COLUMNAS);
  const trasBorrar = (await recuadro(page).textContent()) ?? "";
  check(
    "⭐ tras guardar, el material persistido es [Fracción propia, Número mixto]",
    trasBorrar.includes("Fracción propia") &&
      trasBorrar.includes("Número mixto") &&
      !trasBorrar.includes("Fracción impropia"),
  );
  await page.keyboard.press("Escape");

  console.log("\n7 · ⭐ Editar SIN tocar el material lo deja intacto (regresión de compatibilidad)");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, ENUN_COLUMNAS);
  await filaDe(page, ENUN_COLUMNAS)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await esperar(async () => (await editorRenglon(page, "Columna 1, renglón 1").count()) === 1);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill(`${ENUN_COLUMNAS} (editado)`);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await abrirPreview(page, `${ENUN_COLUMNAS} (editado)`);
  const trasEditar = (await recuadro(page).textContent()) ?? "";
  check(
    "⭐ el material sobrevive a una edición que solo cambió el enunciado",
    trasEditar.includes("Fracción propia") && trasEditar.includes("Número mixto"),
  );
  await page.keyboard.press("Escape");

  console.log("\n8 · Volver a «Pregunta directa» quita el material");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, `${ENUN_COLUMNAS} (editado)`);
  await filaDe(page, `${ENUN_COLUMNAS} (editado)`)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await esperar(async () => (await editorRenglon(page, "Columna 1, renglón 1").count()) === 1);
  await page.getByRole("tab", { name: "Pregunta directa" }).click();
  check(
    "las listas de captura desaparecen",
    (await editorRenglon(page, "Columna 1, renglón 1").count()) === 0,
  );
  check("y la vista previa deja de pintar el recuadro", (await recuadro(page).count()) === 0);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await abrirPreview(page, `${ENUN_COLUMNAS} (editado)`);
  check(
    "el modal ya no pinta recuadro",
    (await recuadro(page).count()) === 0,
  );
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, `${ENUN_COLUMNAS} (editado)`);
  await filaDe(page, `${ENUN_COLUMNAS} (editado)`)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await esperar(async () =>
    (await page.getByRole("tab", { name: "Pregunta directa" }).count()) === 1,
  );
  check(
    "al reabrir, la presentación es «Pregunta directa» (el material no resucita)",
    (await page.getByRole("tab", { name: "Pregunta directa" }).getAttribute("aria-selected")) ===
      "true",
  );

  console.log("\n9 · Alta de ORDENAMIENTO");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.getByRole("textbox", { name: "Enunciado del reactivo" }).fill(ENUN_ORDEN);
  await page.getByRole("tab", { name: "Ordenamiento" }).click();
  check(
    "aparece UNA sola lista",
    (await editorRenglon(page, "Elementos a ordenar, renglón 1").count()) === 1 &&
      (await editorRenglon(page, "Columna 1, renglón 1").count()) === 0,
  );
  await editorRenglon(page, "Elementos a ordenar, renglón 1").fill("Identificar la incógnita");
  await editorRenglon(page, "Elementos a ordenar, renglón 2").fill("Restar 5 en ambos lados");
  await editorRenglon(page, "Elementos a ordenar, renglón 3").fill("Dividir entre 3");
  const previaOrden = (await recuadro(page).textContent()) ?? "";
  check("la vista previa pinta «Elementos a ordenar»", previaOrden.includes("Elementos a ordenar"));
  check("y NO pinta columnas", !previaOrden.includes("Columna 2"));
  await completarOpciones(page, ["3, 2, 1", "1, 2, 3", "2, 1, 3"], "B");
  await completarClasificacion(page);
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await buscar(page, ENUN_ORDEN);
  check(
    "el banco muestra la insignia «Ordenamiento»",
    ((await filaDe(page, ENUN_ORDEN).textContent()) ?? "").includes("Ordenamiento"),
  );

  console.log("\n10 · Validación del cliente: renglón vacío");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.getByRole("textbox", { name: "Enunciado del reactivo" }).fill("E2E LUI-16 incompleto");
  await page.getByRole("tab", { name: "Ordenamiento" }).click();
  await editorRenglon(page, "Elementos a ordenar, renglón 1").fill("Solo el primero");
  await completarOpciones(page, ["a", "b", "c"], "A");
  await completarClasificacion(page);
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  check(
    "un renglón vacío bloquea el guardado con mensaje claro",
    await esperar(async () =>
      ((await page.textContent("body")) ?? "").includes("Hay un renglón vacío"),
    ),
  );
  check("no navega", page.url().endsWith("/reactivos/nuevo"));

  console.log("\n11 · Candado: un reactivo EN USO no deja tocar la presentación");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, EN_USO);
  await filaDe(page, EN_USO)
    .getByRole("link", { name: /en un examen activo|^Editar el reactivo/ })
    .first()
    .click();
  await esperar(async () => (await page.getByRole("tab", { name: "Ordenamiento" }).count()) === 1);
  check(
    "las pestañas de presentación están deshabilitadas",
    await page.getByRole("tab", { name: "Relación de columnas" }).isDisabled(),
  );
  check(
    "no ofrece «Guardar cambios»",
    (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0,
  );

  console.log("\n12 · Legado: un reactivo del seed sin material se edita y guarda igual");
  await page.goto(`${BASE}/instructor/reactivos`);
  await buscar(page, LEGADO);
  await filaDe(page, LEGADO)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await esperar(async () =>
    (await page.getByRole("tab", { name: "Pregunta directa" }).count()) === 1,
  );
  check(
    "un reactivo legado abre como «Pregunta directa»",
    (await page.getByRole("tab", { name: "Pregunta directa" }).getAttribute("aria-selected")) ===
      "true",
  );
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  check("guarda sin exigir material", page.url().endsWith("/instructor/reactivos"));

  console.log("\n13 · ⭐ Responsive GEOMÉTRICO (declarando qué consumidor se mide)");
  // `@md` de Tailwind v4 arranca en 28rem/448px DE CONTENEDOR. La tarjeta de vista previa
  // del formulario mide ~350px, así que debe seguir APILADA incluso con viewport de 1280:
  // medirla esperando dos columnas sería un falso rojo. El consumidor correcto para «dos
  // columnas» es el modal (640px).
  const cajas = async () => {
    const c1 = await listaMaterial(page, "Columna 1").boundingBox();
    const c2 = await listaMaterial(page, "Columna 2").boundingBox();
    return { c1, c2 };
  };
  const apiladas = ({ c1, c2 }) => c2.y >= c1.y + c1.height - 1 && Math.abs(c2.x - c1.x) < 2;
  const ladoALado = ({ c1, c2 }) =>
    Math.abs(c2.y - c1.y) < 4 && c2.x > c1.x + c1.width - 4;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.getByRole("textbox", { name: "Enunciado del reactivo" }).fill("E2E LUI-16 responsive");
  await page.getByRole("tab", { name: "Relación de columnas" }).click();
  await editorRenglon(page, "Columna 1, renglón 1").fill("uno");
  await editorRenglon(page, "Columna 1, renglón 2").fill("dos");
  await editorRenglon(page, "Columna 2, renglón 1").fill("aaa");
  await editorRenglon(page, "Columna 2, renglón 2").fill("bbb");
  await esperar(async () => (await recuadro(page).count()) === 1);
  await page.waitForTimeout(200); // que el layout se asiente antes de medir
  const enTarjeta = await cajas();
  check(
    "tarjeta del formulario @1280 → APILADA (contenedor ~350px < 448px)",
    apiladas(enTarjeta),
    `c1=${JSON.stringify(enTarjeta.c1)} c2=${JSON.stringify(enTarjeta.c2)}`,
  );

  // El reactivo de columnas volvió a «directa» en §8 → se guarda uno nuevo para medirlo en
  // el modal. ⚠️ Hay que llenar los TRES renglones por columna (el default es 3): dejar uno
  // vacío dispara la validación del cliente y el formulario no navega.
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page.getByRole("textbox", { name: "Enunciado del reactivo" }).fill("E2E LUI-16 medible");
  await page.getByRole("tab", { name: "Relación de columnas" }).click();
  await editorRenglon(page, "Columna 1, renglón 1").fill("uno");
  await editorRenglon(page, "Columna 1, renglón 2").fill("dos");
  await editorRenglon(page, "Columna 1, renglón 3").fill("tres");
  await editorRenglon(page, "Columna 2, renglón 1").fill("aaa");
  await editorRenglon(page, "Columna 2, renglón 2").fill("bbb");
  await editorRenglon(page, "Columna 2, renglón 3").fill("ccc");
  await completarOpciones(page, ["1a, 2b, 3c", "1b, 2a, 3c", "1c, 2a, 3b"], "A");
  await completarClasificacion(page);
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });

  await abrirPreview(page, "E2E LUI-16 medible");
  const enModalAncho = await cajas();
  check(
    "modal @1280 → DOS COLUMNAS (contenedor ~590px > 448px)",
    ladoALado(enModalAncho),
    `c1=${JSON.stringify(enModalAncho.c1)} c2=${JSON.stringify(enModalAncho.c2)}`,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const enModalMovil = await cajas();
  check(
    "modal @390 → APILADA (Columna 1 arriba de Columna 2)",
    apiladas(enModalMovil),
    `c1=${JSON.stringify(enModalMovil.c1)} c2=${JSON.stringify(enModalMovil.c2)}`,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
} catch (e) {
  fallos++;
  console.error("  ✘ excepción:", e?.message ?? e);
} finally {
  await navegador.close();
  console.log("\nRestaurando el fixture…");
  // Aquí NO se relanza (taparía el resultado de la suite), pero un fallo de restauración
  // deja la BD de dev sucia para la siguiente corrida → se cuenta como fallo.
  try {
    await pizarraLimpia();
  } catch (e) {
    fallos++;
    console.error(`  ✘ no se pudo restaurar el fixture — ${e.message}`);
  }
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
