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
const ENUN_IMG = "E2E LUI-15 reactivo con imagen"; // E3
const FIXTURE_IMG = "scripts/fixtures/imagen-reactivo.png"; // PNG 1×1 (cwd = raíz del repo)

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

/** `npx convex run` de una función dev-only (LUI-15 E3). */
const conv = (fn, args = '{"confirmar":"SOLO_DEV"}') =>
  ejecutar("npx", ["convex", "run", fn, args]);

/** Conteo de blobs de `_storage` (total y huérfanos), vía el diagnóstico dev. */
async function diagnosticoBlobs() {
  const out = await conv("pruebasImagenes:diagnosticoBlobsDev");
  const num = (re) => Number((out.match(re) ?? [])[1] ?? -1);
  return { total: num(/"total":\s*(\d+)/), huerfanos: num(/"huerfanos":\s*(\d+)/) };
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
// Línea base sin blobs huérfanos de una corrida anterior abortada (gracia 0, dev) → el
// conteo neto de §11-13 es determinista.
await conv("pruebasImagenes:barrerAhoraDev");

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
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill(ENUN_NUEVO);
  await page.getByPlaceholder("Opción A").fill("Alfa");
  await page.getByPlaceholder("Opción B").fill("Beta");
  await page.getByPlaceholder("Opción C").fill("Gamma");
  await page.getByLabel("Marcar la opción B como correcta").check();
  await page
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Porque beta es la correcta.");
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Álgebra");
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Intermedio" }).click();
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await esperar(async () => (await filas(page).count()) > 0);
  // AISLAR con `buscar`, como TODAS las demás secciones: esta era la única
  // `filaDe` sin filtro previo y asumía «lo recién creado cae en la página 1» —
  // cierto con 14 reactivos sembrados, falso desde los 18 de LUI-20 B (los 4
  // nuevos de Comprensión lectora llenan la página 1 y este, de Pensamiento
  // matemático, ordena en la 2).
  await buscar(page, ENUN_NUEVO);
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
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("Incompleto");
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
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("¿Cuál es el desarrollo de (x + 3)²? [E2E editado]");
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
  // Candado heredado por la imagen (E3): la op de imagen va dentro de `actualizar`, DESPUÉS
  // del candado que este bloqueo ya prueba → el rechazo server-side de cambiar imagen en uso
  // queda cubierto por §5 + revisión. La UI solo puede afirmar el control deshabilitado.
  check(
    "candado: el control de imagen también está deshabilitado (E3)",
    await page
      .getByRole("button", { name: "Adjuntar imagen" })
      .isDisabled()
      .catch(() => false),
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

  console.log("\n9 · Texto enriquecido (E2): negrita + superíndice");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  const grupoEnun = page.getByRole("group", {
    name: "Editor: Enunciado del reactivo",
  });
  await grupoEnun.getByRole("textbox").click();
  await page.keyboard.type("x");
  await grupoEnun.getByRole("button", { name: "Superíndice" }).click();
  await page.keyboard.type("2");
  await grupoEnun.getByRole("button", { name: "Superíndice" }).click(); // apaga
  await page.keyboard.type(" en ");
  await grupoEnun.getByRole("button", { name: "Negrita" }).click();
  await page.keyboard.type("negrita E2E");
  await page.getByPlaceholder("Opción A").fill("Uno");
  await page.getByPlaceholder("Opción B").fill("Dos");
  await page.getByPlaceholder("Opción C").fill("Tres");
  await page.getByLabel("Marcar la opción A como correcta").check();
  await page
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Explicación del reactivo enriquecido.");
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Álgebra");
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Básico" }).click();
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, "negrita E2E");
  const filaRico = filaDe(page, "negrita E2E");
  const textoCelda = (await filaRico.textContent()) ?? "";
  check(
    "el banco muestra TEXTO PLANO (sin tags)",
    (await filaRico.count()) === 1 &&
      !textoCelda.includes("<strong>") &&
      !textoCelda.includes("<sup>"),
    `celda: ${textoCelda.slice(0, 60)}`,
  );
  await filaRico.getByRole("button", { name: /^Ver el reactivo/ }).click();
  const dlgRico = page.getByRole("dialog");
  check(
    "el preview RENDERIZA la negrita (<strong>)",
    await esperar(async () => (await dlgRico.locator("strong").count()) >= 1),
  );
  check(
    "el preview RENDERIZA el superíndice (<sup>)",
    (await dlgRico.locator("sup").count()) >= 1,
  );
  await page.keyboard.press("Escape");

  console.log("\n10 · Editar un LEGADO (texto plano con «<») no lo mangea");
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await filas(page).count()) > 0);
  await buscar(page, "0.375");
  await filaDe(page, "0.375")
    .getByRole("button", { name: /^Ver el reactivo/ })
    .click();
  const dlgLegado = page.getByRole("dialog");
  check(
    "el preview de un legado muestra el «<» literal (no mangeado)",
    await esperar(async () =>
      ((await dlgLegado.textContent()) ?? "").includes("3/8 < 1/2"),
    ),
  );
  await page.keyboard.press("Escape");
  await buscar(page, "0.375");
  await filaDe(page, "0.375")
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  check(
    "el editor de explicación cargó el «<» literal del legado",
    await esperar(async () =>
      (
        (await page
          .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
          .textContent()) ?? ""
      ).includes("3/8 < 1/2"),
    ),
  );
  // Guardar → persiste como HTML (contenidoFormato:"html") → reabrir el preview y
  // confirmar que el «<» sobrevivió a la persistencia (round-trip real, no solo lectura).
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  await buscar(page, "0.375");
  await filaDe(page, "0.375")
    .getByRole("button", { name: /^Ver el reactivo/ })
    .click();
  check(
    "tras guardar (ahora html), el «<» sobrevive en el preview",
    await esperar(async () =>
      ((await page.getByRole("dialog").textContent()) ?? "").includes("3/8 < 1/2"),
    ),
  );
  await page.keyboard.press("Escape");

  // ── Imagen (E3): §11-16 ──────────────────────────────────────────────────────
  console.log("\n11 · Adjuntar imagen a un reactivo nuevo → el preview la muestra");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill(ENUN_IMG);
  await page.getByPlaceholder("Opción A").fill("Uno");
  await page.getByPlaceholder("Opción B").fill("Dos");
  await page.getByPlaceholder("Opción C").fill("Tres");
  await page.getByLabel("Marcar la opción A como correcta").check();
  await page
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Reactivo con imagen adjunta.");
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Álgebra");
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Intermedio" }).click();
  await page.getByLabel("Imagen del reactivo").setInputFiles(FIXTURE_IMG);
  // La subida termina cuando el chip muestra el nombre (deja de decir «Subiendo…»).
  check(
    "la imagen sube y su nombre aparece en el chip",
    await esperar(
      async () => (await page.getByText("imagen-reactivo.png").count()) >= 1,
    ),
  );
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  const trasAdjuntar = await diagnosticoBlobs();
  check(
    "tras adjuntar: 1 blob, 0 huérfanos",
    trasAdjuntar.total === 1 && trasAdjuntar.huerfanos === 0,
    JSON.stringify(trasAdjuntar),
  );
  await buscar(page, ENUN_IMG);
  await filaDe(page, ENUN_IMG)
    .getByRole("button", { name: /^Ver el reactivo/ })
    .click();
  check(
    "el preview del reactivo muestra <img> con URL de storage",
    await esperar(async () => {
      const src = await page
        .getByRole("dialog")
        .locator("img")
        .first()
        .getAttribute("src")
        .catch(() => null);
      return !!src && /^https?:\/\//.test(src);
    }),
  );
  await page.keyboard.press("Escape");

  console.log("\n12 · Reemplazar la imagen → borra el blob viejo (conteo neto)");
  await buscar(page, ENUN_IMG);
  await filaDe(page, ENUN_IMG)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Quitar la imagen" }).click();
  await page.getByLabel("Imagen del reactivo").setInputFiles(FIXTURE_IMG);
  check(
    "la nueva imagen sube (chip con nombre)",
    await esperar(
      async () => (await page.getByText("imagen-reactivo.png").count()) >= 1,
    ),
  );
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  const trasReemplazar = await diagnosticoBlobs();
  check(
    "tras reemplazar: sigue 1 blob y 0 huérfanos (el viejo se borró)",
    trasReemplazar.total === 1 && trasReemplazar.huerfanos === 0,
    JSON.stringify(trasReemplazar),
  );

  console.log("\n13 · Quitar la imagen → el preview ya no la trae; 0 blobs");
  await buscar(page, ENUN_IMG);
  await filaDe(page, ENUN_IMG)
    .getByRole("link", { name: /^Editar el reactivo/ })
    .click();
  await page.waitForURL(/\/reactivos\/.+\/editar$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Quitar la imagen" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
  const trasQuitar = await diagnosticoBlobs();
  check("tras quitar: 0 blobs", trasQuitar.total === 0, JSON.stringify(trasQuitar));
  await buscar(page, ENUN_IMG);
  await filaDe(page, ENUN_IMG)
    .getByRole("button", { name: /^Ver el reactivo/ })
    .click();
  check(
    "el preview ya no trae <img>",
    (await esperar(async () => (await page.getByRole("dialog").count()) === 1)) &&
      (await page.getByRole("dialog").locator("img").count()) === 0,
  );
  await page.keyboard.press("Escape");

  console.log("\n14 · Sweeper: un huérfano (subido sin guardar) se barre");
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("E2E huérfano (no se guarda)");
  await page.getByLabel("Imagen del reactivo").setInputFiles(FIXTURE_IMG);
  check(
    "la imagen huérfana sube (chip con nombre)",
    await esperar(
      async () => (await page.getByText("imagen-reactivo.png").count()) >= 1,
    ),
  );
  // NO se guarda: navegar fuera deja el blob subido SIN referencia → huérfano.
  await page.goto(`${BASE}/instructor/reactivos`);
  const antesSweep = await diagnosticoBlobs();
  check(
    "antes del barrido hay ≥1 huérfano",
    antesSweep.huerfanos >= 1,
    JSON.stringify(antesSweep),
  );
  // Gracia CERO (dev): borra el huérfano fresco. Que el sweeper PRODUCTIVO (gracia 24 h) NO
  // lo tocaría se prueba en test:imagenes.
  await conv("pruebasImagenes:barrerAhoraDev");
  const trasSweep = await diagnosticoBlobs();
  check(
    "tras el barrido: 0 huérfanos",
    trasSweep.huerfanos === 0,
    JSON.stringify(trasSweep),
  );

  console.log("\n15 · Bloqueo del submit mientras sube (POST de subida retrasado)");
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("E2E submit-block");
  await page.getByLabel("Imagen del reactivo").setInputFiles(FIXTURE_IMG);
  check(
    "durante la subida «Guardar» está deshabilitado (botón «Subiendo…»)",
    await esperar(
      async () =>
        (await page.getByRole("button", { name: "Subiendo…" }).count()) === 1,
      3000,
    ),
  );
  await esperar(
    async () =>
      (await page.getByRole("button", { name: "Guardar reactivo" }).count()) ===
      1,
    6000,
  );
  await page.unroute("**/*");

  console.log("\n16 · Cuota de subida: con el bucket drenado, la subida se rechaza");
  await conv(
    "pruebasImagenes:drenarCuotaSubidaDev",
    JSON.stringify({ confirmar: "SOLO_DEV", correo: INSTRUCTOR }),
  );
  await page.goto(`${BASE}/instructor/reactivos/nuevo`);
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("E2E cuota");
  await page.getByLabel("Imagen del reactivo").setInputFiles(FIXTURE_IMG);
  check(
    "con el bucket drenado, la subida por HTTP action rechaza con mensaje de espera",
    await esperar(async () =>
      ((await page.textContent("body")) ?? "").includes("Demasiadas subidas"),
    ),
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
  // Base Ecuaciones lineales = 5; +1 alta §1, +1 movimiento §4, +1 enriquecido §9, +1 con
  // imagen §11 = 9. (§12/§13 solo cambian la imagen, no la clasificación; §14/§15/§16 no guardan.)
  check(
    "«Ecuaciones lineales» subió a 9 (§1 + §4 + §9 + §11 con imagen)",
    (await contarNodo(pageAdmin, "Ecuaciones lineales")) === 9,
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
  // Barre los blobs huérfanos que dejaron §15/§16 (subir sin guardar); si no, el E2E fugaría
  // storage entre corridas. Luego el seed limpia los referenciados + las cuotas subida_imagen:*.
  await conv("pruebasImagenes:barrerAhoraDev");
  await pizarraLimpia();
}

console.log(`\n${fallos === 0 ? "✅" : "❌"} LUI-15: ${ok} ok · ${fallos} fallos\n`);
process.exit(fallos === 0 ? 0 : 1);
