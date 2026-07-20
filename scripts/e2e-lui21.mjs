/**
 * E2E LUI-21 — Constructor de examen (Diseño 18) + despublicar en biblioteca.
 *
 * Corre contra el dev server local (`npm run dev`) y la BD de DEV de Convex, con la
 * pizarra limpia al inicio (`seed:limpiar → cargar → credenciales`). Repetible ×2: todo
 * lo que la suite crea (reactivos y exámenes) lo barre la pizarra de la corrida
 * siguiente, y lo que muta dentro de la corrida se restaura (Módulo Biología 1 se
 * despublica y se RE-publica aquí mismo).
 *
 * ⭐ = aserción DISCRIMINANTE (falla si la implementación toma el atajo obvio); cada una
 * se demostró en ROJO rompiendo la implementación a propósito (bitácora en el reporte).
 *
 * Lo que esta suite NO puede probar (verificado por REVISIÓN de código):
 *  · autoría de crear/actualizar/publicar/despublicar sobre exámenes AJENOS — la UI
 *    oculta las acciones y `npx convex run` no pasa `requireStaff` (falso verde);
 *  · el orden interno de guards de cada mutation (no-op idempotente ANTES del origen);
 *  · que `despublicar`/`compromisosDe` sondeen `intentos.by_examen` SIN filtrar estado;
 *  · que la validación cruda corra ANTES de la expansión y que la expansión RECHACE en
 *    vez de normalizar (la UI también agrupa bien — una mutation hueca sería invisible);
 *  · que `publicar` REPITA título/duración (la UI guarda primero, así que esos rechazos
 *    los da el GUARDADO; el «sin reactivos» sí llega a publicar y aquí se asevera);
 *  · que `reactivos.listar` estampe `bloquePublicable` con la función pura AGREGADA
 *    `publicabilidadDeBloques` (el fixture solo tiene bloques consistentes; el caso
 *    «hermana dañada» vive en `test-constructor.ts`);
 *  · `tipoDeEstructura`, las fronteras baratas y la frontera del candidato de
 *    crear-directo en el SERVIDOR (probadas en `test-constructor.ts` + revisión);
 *  · las cotas previas de `paraConstructor` (no hay examen >240 en el fixture);
 *  · la cuarta sonda de `temario.eliminar`;
 *  · la idempotencia real `{cambiado:false}` ante repetición.
 *  · El botón ATRÁS del navegador con cambios sin guardar queda FUERA DEL ALCANCE
 *    declarado del aviso (popstate de SPA); se cubren cierre/recarga y clicks internos.
 *
 * La convergencia del seed en `secciones` se comprueba con la secuencia DISCRIMINANTE
 * (§10): guardar estructura en un examen SEMBRADO → re-seed SIN limpiar → `secciones`
 * ausente → repetir estable. (Cargar ×2 sobre datos limpios pasaría aunque faltara la
 * clave.)
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx";
const ADMIN = "mayra.admin@demo.unx.mx";

// Reactivos que la suite CREA (clasificación sin conteos absolutos en otras suites:
// Comprensión lectora → Textos argumentativos → Tesis y argumentos). Prefijo E21 para
// aislarlos con `buscar`.
const NUEVOS = [
  { enunciado: "E21 ¿Qué es una premisa mayor?", dificultad: "Básico" },
  { enunciado: "E21 ¿Qué es una premisa menor?", dificultad: "Básico" },
  { enunciado: "E21 ¿Qué es un contraargumento débil?", dificultad: "Básico" },
  { enunciado: "E21 ¿Qué es una refutación directa?", dificultad: "Básico" },
  { enunciado: "E21 ¿Qué es una falacia ad hominem compleja?", dificultad: "Avanzado" },
];

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

async function correrConvex(fn, args = '{"confirmar":"SOLO_DEV"}') {
  // UN reintento ante fallos transitorios del CLI («TypeError: fetch failed» contra el
  // deployment de dev tumbó una corrida completa sin que nada estuviera mal).
  let ultimo = "";
  for (let intento = 0; intento < 2; intento++) {
    const { code, salida } = await ejecutar("npx", ["convex", "run", fn, args]);
    if (code === 0) return salida;
    ultimo = salida.trim();
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`«convex run ${fn}» falló dos veces: ${ultimo}`);
}

async function pizarraLimpia() {
  await correrConvex("seed:limpiarContenidoDemo");
  await correrConvex("seed:cargarDatosDePrueba");
  await correrConvex("seedAuth:credencialesDemo");
}

console.log("\nE2E LUI-21 · pizarra limpia + credenciales…");
try {
  await pizarraLimpia();
} catch (e) {
  console.error(`\n✘ No se pudo preparar la BD de dev — ${e.message}`);
  process.exit(1);
}

const navegador = await chromium.launch({ headless: !HEADED });

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

/** Alta de un reactivo por la UI del banco (molde de e2e-lui15 §1). */
async function crearReactivo(pg, { enunciado, dificultad }) {
  await pg.goto(`${BASE}/instructor/reactivos/nuevo`);
  await pg.getByRole("textbox", { name: "Enunciado del reactivo" }).fill(enunciado);
  await pg.getByPlaceholder("Opción A").fill("Alfa");
  await pg.getByPlaceholder("Opción B").fill("Beta");
  await pg.getByPlaceholder("Opción C").fill("Gamma");
  await pg.getByLabel("Marcar la opción B como correcta").check();
  await pg
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Porque beta es la correcta.");
  await seleccionar(pg, "Sección", "Comprensión lectora");
  await seleccionar(pg, "Área temática", "Textos argumentativos");
  await seleccionar(pg, "Subtema", "Tesis y argumentos");
  await pg.getByRole("button", { name: dificultad }).click();
  await pg.getByRole("button", { name: "Guardar reactivo" }).click();
  await pg.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
}

/** La tarjeta de una sección del constructor, acotada por su aria-label. */
const tarjeta = (pg, nombre) => pg.locator(`section[aria-label="Sección ${nombre}"]`);
/** Aísla una fila de la BIBLIOTECA con el buscador de título: con 14+ exámenes y
 *  PAGE_SIZE=8, una fila publicada puede vivir en la página 2 y un locator sin filtro
 *  esperaría para siempre (lección de e2e-lui15 §1). */
async function buscarExamen(pg, titulo) {
  const box = pg.getByPlaceholder("Buscar por título…");
  await box.fill("");
  await box.fill(titulo);
  await poller(pg)(async () =>
    (await pg.locator("tbody tr").filter({ hasText: titulo }).count()) >= 1,
  );
  return pg.locator("tbody tr").filter({ hasText: titulo }).first();
}
/** El chip de tipo de la fila de la biblioteca con ese título. */
async function chipDe(pg, titulo) {
  const fila = await buscarExamen(pg, titulo);
  return (await fila.textContent()) ?? "";
}
/** Número del pill de una pestaña («Borradores 4» → 4). */
async function conteoDeTab(pg, tab) {
  const texto = await pg
    .getByRole("tab", { name: new RegExp(`^${tab}`) })
    .innerText();
  const m = texto.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : NaN;
}
/** Los enunciados visibles de las filas sueltas de una tarjeta, en orden. */
async function ordenDe(card) {
  return (
    await card
      .locator("div.flex.items-center.gap-3.border-t span.flex-1")
      .allTextContents()
  ).map((t) => t.trim());
}

const ctxInst = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctxInst.newPage();
const esperar = poller(page);

try {
  await login(page, INSTRUCTOR, /\/instructor/);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n1 · Reactivos de apoyo vía UI (5 en «Tesis y argumentos»)");
  // La sección Comprensión lectora queda con >8 ofertas elegibles → el modal tiene 2ª
  // página REAL (sin esto, «selección persistente entre páginas» no sería ejecutable).
  // ───────────────────────────────────────────────────────────────────────────
  for (const r of NUEVOS) await crearReactivo(page, r);
  check("los 5 reactivos E21 se crearon", true);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n2 · Plantilla de núcleo y balance inicial");
  // ───────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/instructor/examenes/nuevo`);
  await page.getByRole("button", { name: /Simulacro de núcleo/ }).click();
  const nombres = await page
    .locator("section[aria-label^='Sección']")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    "la plantilla precarga las 3 secciones núcleo EN el orden del temario",
    JSON.stringify(nombres) ===
      JSON.stringify([
        "Sección Pensamiento matemático",
        "Sección Comprensión lectora",
        "Sección Redacción indirecta",
      ]),
    JSON.stringify(nombres),
  );
  const balance0 = (await page.getByLabel("Balance del examen").textContent()) ?? "";
  check("meta 30 por sección → total «de 90 reactivos»", balance0.includes("de 90 reactivos"));
  check(
    "cada tarjeta arranca «0 de 30 reactivos»",
    ((await tarjeta(page, "Comprensión lectora").textContent()) ?? "").includes(
      "0 de 30 reactivos",
    ),
  );
  await page.getByLabel("Nombre del examen").fill("E21 Núcleo");

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n3 · Modal de agregar: lectura en UNA fila y selección persistente");
  // ───────────────────────────────────────────────────────────────────────────
  await tarjeta(page, "Comprensión lectora")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  const dialogo = page.getByRole("dialog");
  await dialogo.waitFor();
  // Aislar con el buscador (con >8 ofertas, la paginación puede empujarla a la pág. 2).
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("objecion");
  await esperar(async () => (await dialogo.locator("tbody tr").count()) === 1);
  check(
    "⭐ la lectura del seed es UNA fila «▤ Lectura · 2 preguntas · se agrega completa»",
    (await dialogo.getByText(/▤ Lectura · 2 preguntas · se agrega completa/).count()) === 1,
    "el bloque no debe listarse por hermana",
  );
  // Negativo tras contenido cargado: la lectura de UNA sola pregunta (< MIN_PREGUNTAS)
  // NO se ofrece — el modal solo lista bloques PUBLICABLES.
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("calentamiento");
  await page.waitForTimeout(300);
  check(
    "⭐ una lectura NO publicable (1 pregunta) no aparece en la oferta",
    (await dialogo.locator("tbody tr").count()) === 0 ||
      (await dialogo.getByText("No hay reactivos que ofrecer").count()) === 1,
  );
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("");
  await page.waitForTimeout(200);
  // Persistencia: 2 marcados con el filtro Básico + cambiar filtro + página 2 + 1 más.
  await dialogo.getByLabel("Filtrar por dificultad").selectOption({ label: "Básico" });
  const cajasBasico = dialogo.locator("tbody input[type=checkbox]");
  await cajasBasico.nth(0).check();
  await cajasBasico.nth(1).check();
  await dialogo
    .getByLabel("Filtrar por dificultad")
    .selectOption({ label: "Dificultad: todas" });
  const paginas = dialogo.getByRole("button", { name: "2", exact: true });
  check("⭐ con >8 ofertas el modal tiene página 2 real", (await paginas.count()) === 1);
  await paginas.click();
  await dialogo.locator("tbody input[type=checkbox]:not(:checked)").first().check();
  check(
    "⭐ la selección PERSISTE entre filtros y páginas: «3 seleccionados»",
    ((await dialogo.getByText(/seleccionados?$/).textContent()) ?? "").trim() ===
      "3 seleccionados",
  );
  // Para el resto del flujo: dejar SOLO la lectura marcada (más determinista).
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await tarjeta(page, "Comprensión lectora")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  await dialogo.waitFor();

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n4 · El bloque entra COMPLETO y dos sueltos con él");
  // ───────────────────────────────────────────────────────────────────────────
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("objecion");
  await esperar(async () => (await dialogo.locator("tbody tr").count()) === 1);
  await dialogo.locator("tbody input[type=checkbox]").first().check();
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("premisa");
  await esperar(async () => (await dialogo.locator("tbody tr").count()) === 2);
  for (const tr of await dialogo.locator("tbody tr").all())
    await tr.locator("input[type=checkbox]").check();
  await dialogo.getByRole("button", { name: "Agregar al examen" }).click();
  check(
    "⭐ marcando SOLO la fila de la lectura entran sus 2 hermanas contiguas",
    (await page.getByText(/▤ Lectura: .+ — 2 preguntas/).count()) === 1,
  );
  const cardCL = tarjeta(page, "Comprensión lectora");
  check(
    "el contador de la sección subió a 4 (2 del bloque + 2 sueltos)",
    ((await cardCL.textContent()) ?? "").includes("4 de 30 reactivos"),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n5 · Balance por dificultad, EN VIVO (sin guardar)");
  // ───────────────────────────────────────────────────────────────────────────
  const sumaAvanzados = (texto) =>
    [...texto.matchAll(/● Avanzado (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  const leyendaAntes = (await page.getByLabel("Balance del examen").textContent()) ?? "";
  const avanzadosAntes = sumaAvanzados(leyendaAntes);
  await cardCL.getByRole("button", { name: "Agregar reactivos" }).click();
  await dialogo.waitFor();
  await dialogo.getByPlaceholder("Buscar en el enunciado…").fill("ad hominem compleja");
  await esperar(async () => (await dialogo.locator("tbody tr").count()) === 1);
  await dialogo.locator("tbody input[type=checkbox]").first().check();
  await dialogo.getByRole("button", { name: "Agregar al examen" }).click();
  const leyendaDespues = (await page.getByLabel("Balance del examen").textContent()) ?? "";
  const avanzadosDespues = sumaAvanzados(leyendaDespues);
  check(
    "agregar un Avanzado sube «Avanzado» en 1 SIN guardar",
    avanzadosAntes >= 0 && avanzadosDespues === avanzadosAntes + 1,
    `antes=${avanzadosAntes} después=${avanzadosDespues}`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n6 · Orden conservado tras mover, guardar y RECARGAR");
  // ───────────────────────────────────────────────────────────────────────────
  // La sección CL tiene: [bloque, s1, s2, s3]. Bajar el bloque (unidad) y subir s3.
  await cardCL.getByRole("button", { name: /^Bajar la lectura/ }).click();
  const ordenEsperado = await ordenDe(cardCL);
  const bloquePos = (await cardCL.textContent())?.indexOf("▤ Lectura");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.waitForURL(/\/instructor\/examenes\/[a-z0-9]+\/editar$/, { timeout: 10_000 });
  const urlEditar = page.url();
  check("⭐ el primer guardado desde /nuevo hace replace a /[id]/editar", true, urlEditar);
  await page.reload();
  await page.getByText(/▤ Lectura: .+ — 2 preguntas/).waitFor({ timeout: 10_000 });
  const ordenTrasRecarga = await ordenDe(tarjeta(page, "Comprensión lectora"));
  check(
    "⭐ el orden EXACTO sobrevive guardar + recargar (bloque movido como unidad)",
    JSON.stringify(ordenTrasRecarga) === JSON.stringify(ordenEsperado),
    `esperado=${JSON.stringify(ordenEsperado)} recibido=${JSON.stringify(ordenTrasRecarga)}`,
  );
  const bloquePosRecarga = (
    await tarjeta(page, "Comprensión lectora").textContent()
  )?.indexOf("▤ Lectura");
  check(
    "la posición del bloque también sobrevive",
    bloquePos !== undefined &&
      bloquePosRecarga !== undefined &&
      (bloquePos === -1) === (bloquePosRecarga === -1),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n7 · Quitar el bloque pide confirmación y quita AMBAS hermanas");
  // ───────────────────────────────────────────────────────────────────────────
  const conteoAntes = ((await tarjeta(page, "Comprensión lectora").textContent()) ?? "")
    .match(/(\d+) de 30/)?.[1];
  await tarjeta(page, "Comprensión lectora")
    .getByRole("button", { name: /^Quitar la lectura/ })
    .click();
  await page.getByRole("dialog").getByText("quitar una quita el bloque completo").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Quitar la lectura" }).click();
  check(
    "⭐ tras confirmar, el bloque desaparece COMPLETO (−2, no −1)",
    (await page.getByText(/▤ Lectura: .+ — 2 preguntas/).count()) === 0 &&
      ((await tarjeta(page, "Comprensión lectora").textContent()) ?? "").includes(
        `${Number(conteoAntes) - 2} de 30`,
      ),
  );
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n8 · Fronteras con mensaje del SERVIDOR (guardado y publicar)");
  // ───────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/instructor/examenes/nuevo`);
  const selModulo = page.getByLabel("Sección de módulo");
  await selModulo.selectOption({ label: "Biología" });
  await page.getByRole("button", { name: "Empezar" }).click();
  // (a) título vacío → lo rechaza el GUARDADO (Publicar guarda primero; no hay espejo
  // en cliente a propósito: el mensaje que se asevera ES del servidor).
  await page.getByRole("button", { name: "Publicar" }).click();
  await page
    .getByText("El examen necesita un nombre.", { exact: true })
    .waitFor({ timeout: 8000 });
  check("⭐ título vacío → mensaje del SERVIDOR del guardado", true);
  // (b) duración 0.
  await page.getByLabel("Nombre del examen").fill("E21 Vacío");
  await page.getByLabel("Horas").fill("0");
  await page.getByLabel("Minutos").fill("0");
  await page.getByRole("button", { name: "Publicar" }).click();
  await page
    .getByText(/tiempo límite debe ser un entero entre 1 y 600/)
    .first()
    .waitFor({ timeout: 8000 });
  check("⭐ duración 0 → mensaje del SERVIDOR del guardado", true);
  // (c) sin reactivos: el guardado ACEPTA el borrador vacío y es PUBLICAR quien rechaza.
  await page.getByLabel("Horas").fill("1");
  await page.getByRole("button", { name: "Publicar" }).click();
  await page
    .getByText(/no tiene reactivos; necesita al menos una sección con reactivos/)
    .first()
    .waitFor({ timeout: 10_000 });
  check("⭐ borrador VACÍO se guarda y es «publicar» quien lo rechaza (frontera propia)", true);
  // El replace a /[id]/editar se DIFIERE cuando publicar falla (el error debe quedar
  // visible en este montaje); el siguiente «Guardar borrador» lo salda.
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await page.waitForURL(/\/editar$/, { timeout: 8000 });
  check("el borrador vacío quedó guardado y el guardado saldó la URL (/[id]/editar)", true);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n9 · Tipo AUTOCALCULADO: módulo ⇄ general según la estructura");
  // ───────────────────────────────────────────────────────────────────────────
  const urlModulo = page.url();
  await page.goto(`${BASE}/instructor/examenes`);
  check(
    "⭐ examen de UNA sección módulo → chip «Módulo: Biología»",
    (await chipDe(page, "E21 Vacío")).includes("Módulo: Biología"),
  );
  await page.goto(urlModulo);
  await page.getByLabel("Agregar sección").selectOption({ label: "Pensamiento matemático" });
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));
  await page.goto(`${BASE}/instructor/examenes`);
  check(
    "⭐ módulo + núcleo → el chip cambia a «Simulacro general» (recalculado al guardar)",
    (await chipDe(page, "E21 Vacío")).includes("Simulacro general"),
  );
  await page.goto(urlModulo);
  await tarjeta(page, "Pensamiento matemático")
    .getByRole("button", { name: "Quitar la sección Pensamiento matemático" })
    .click();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));
  await page.goto(`${BASE}/instructor/examenes`);
  check(
    "⭐ y de vuelta a UNA sección módulo → «Módulo: Biología» otra vez",
    (await chipDe(page, "E21 Vacío")).includes("Módulo: Biología"),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n10 · Convergencia del seed (secuencia DISCRIMINANTE) y módulo VACÍO");
  // ───────────────────────────────────────────────────────────────────────────
  // (a) Guardar estructura en un examen SEMBRADO: «Módulo Matemáticas financieras».
  const filaMF = await buscarExamen(page, "Módulo Matemáticas financieras");
  await filaMF.getByRole("link", { name: /Continuar editando/ }).click();
  await page.waitForURL(/\/editar$/);
  await tarjeta(page, "Matemáticas financieras").waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    "el borrador módulo VACÍO deriva su sección del TIPO (fallback de hidratación)",
    (await tarjeta(page, "Matemáticas financieras").count()) === 1,
  );
  // El aviso de sección PLANA, versión INSTRUCTOR (sin enlace) y SIN el CTA de crear.
  await tarjeta(page, "Matemáticas financieras")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  await dialogo.waitFor();
  check(
    "sección plana: aviso de instructor «solicita a administración» SIN enlace",
    (await dialogo.getByText(/solicita a administración que los agregue/).count()) === 1 &&
      (await dialogo.getByRole("link", { name: "Gestión de temario" }).count()) === 0,
  );
  check(
    "⭐ sección plana: el CTA «Crear reactivo nuevo» se OCULTA (el form sería imposible)",
    (await dialogo.getByText(/Crear reactivo nuevo/).count()) === 0,
  );
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));
  await page.goto(`${BASE}/instructor/examenes`);
  check(
    "⭐ guardar SIN cambios de contenido conserva el tipo: sigue «Módulo: Matemáticas financieras»",
    (await chipDe(page, "Módulo Matemáticas financieras")).includes(
      "Módulo: Matemáticas financieras",
    ),
    "sin el fallback, el vacío se volvería «Simulacro general»",
  );
  // (b) Convergencia del seed, con un observable que DISCRIMINA: se guarda una sección
  // EXTRA vacía («Redacción indirecta») que la DERIVACIÓN jamás produciría en este
  // examen. Tras `seed:cargarDatosDePrueba` SIN limpiar, la clave siempre-presente
  // (`secciones: undefined`) debe BORRAR esa estructura: reabrir muestra SOLO la tarjeta
  // derivada del tipo. Si la clave faltara en el upsert, la tarjeta extra seguiría ahí.
  const filaMF2 = await buscarExamen(page, "Módulo Matemáticas financieras");
  await filaMF2.getByRole("link", { name: /Continuar editando/ }).click();
  await page.waitForURL(/\/editar$/);
  await tarjeta(page, "Matemáticas financieras").waitFor({ timeout: 10_000 });
  await page.getByLabel("Agregar sección").selectOption({ label: "Redacción indirecta" });
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));
  await correrConvex("seed:cargarDatosDePrueba");
  await page.goto(`${BASE}/instructor/examenes`);
  const filaMF3 = await buscarExamen(page, "Módulo Matemáticas financieras");
  await filaMF3.getByRole("link", { name: /Continuar editando/ }).click();
  await page.waitForURL(/\/editar$/);
  await tarjeta(page, "Matemáticas financieras").waitFor({ timeout: 10_000 });
  check(
    "⭐ re-seed SIN limpiar BORRA la estructura guardada (la sección extra desapareció)",
    (await tarjeta(page, "Matemáticas financieras").count()) === 1 &&
      (await tarjeta(page, "Redacción indirecta").count()) === 0,
    "si el upsert no escribiera `secciones: undefined`, la tarjeta extra seguiría",
  );
  // Estabilidad: repetir el seed no cambia nada.
  await correrConvex("seed:cargarDatosDePrueba");
  await page.reload();
  await tarjeta(page, "Matemáticas financieras").waitFor({ timeout: 10_000 });
  check(
    "…y repetir el seed es estable (sigue solo la derivada)",
    (await tarjeta(page, "Redacción indirecta").count()) === 0,
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n11 · Publicar incompleto: la confirmación ENUMERA faltantes por sección");
  // ───────────────────────────────────────────────────────────────────────────
  await page.goto(urlEditar);
  await page.getByText(/de 30 reactivos/).first().waitFor();
  await page.getByRole("button", { name: "Publicar" }).click();
  const modalInc = page.getByRole("dialog");
  await modalInc.getByText("Publicar con secciones incompletas").waitFor({ timeout: 8000 });
  const cuerpoInc = (await modalInc.textContent()) ?? "";
  check(
    "⭐ enumera «Faltan N en {sección}» POR SECCIÓN (no un aviso genérico)",
    /Faltan \d+ en Comprensión lectora/.test(cuerpoInc) &&
      /Faltan 30 en Pensamiento matemático/.test(cuerpoInc),
    cuerpoInc.slice(0, 200),
  );
  await modalInc.getByRole("button", { name: "Publicar de todos modos" }).click();
  await page.waitForURL(/\/instructor\/examenes$/, { timeout: 12_000 });
  check(
    "confirmado → publicado y de vuelta en la biblioteca",
    (await chipDe(page, "E21 Núcleo")).includes("publicado"),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n12 · Despublicar (patrón archivar): habilitado, impedidos y precedencia");
  // ───────────────────────────────────────────────────────────────────────────
  // (a) Módulo Biología 1: publicado SIN asignaciones NI intentos → habilitado. Los
  // conteos de pestaña son PRE-pestaña con la búsqueda APLICADA: con el filtro puesto,
  // Borradores pasa de 0 a 1 al despublicar — mismo +1, sin recargar.
  const filaBio1 = await buscarExamen(page, "Módulo Biología 1");
  const borradoresAntes = await conteoDeTab(page, "Borradores");
  await filaBio1
    .getByRole("button", { name: /Devolver «Módulo Biología 1» a borrador/ })
    .click();
  const modalDesp = page.getByRole("dialog");
  await modalDesp.waitFor();
  check(
    "sin compromisos → la confirmación está HABILITADA",
    !(await modalDesp
      .getByRole("button", { name: "Volver a borrador" })
      .isDisabled()),
  );
  await modalDesp.getByRole("button", { name: "Volver a borrador" }).click();
  await esperar(async () => (await conteoDeTab(page, "Borradores")) === borradoresAntes + 1);
  check("⭐ despublicado: la pestaña Borradores subió +1 SIN recargar", true);
  // (b) SG3: asignación programada → deshabilitado con motivo de ASIGNACIONES.
  async function motivoDe(titulo) {
    const fila = await buscarExamen(page, titulo);
    await fila
      .getByRole("button", { name: new RegExp(`Devolver «${titulo}» a borrador`) })
      .click();
    const m = page.getByRole("dialog");
    await m.waitFor();
    const deshabilitado = await m
      .getByRole("button", { name: "Volver a borrador" })
      .isDisabled();
    const texto = (await m.textContent()) ?? "";
    await m.getByRole("button", { name: "Cancelar" }).click();
    return { deshabilitado, texto };
  }
  const sg3 = await motivoDe("Simulacro General 3");
  check(
    "SG3 (asignación programada) → deshabilitado con motivo de ASIGNACIONES",
    sg3.deshabilitado && /asignaci/.test(sg3.texto) && !/intentos registrados/.test(sg3.texto),
  );
  // (c) ⭐ Práctica libre: CERO asignaciones, SOLO intentos directos — discrimina la
  // segunda rama de la guarda (quien sondee solo asignaciones la dejaría habilitada).
  const pl = await motivoDe("Práctica libre");
  check(
    "⭐ Práctica libre (solo intentos DIRECTOS) → deshabilitado con motivo de INTENTOS",
    pl.deshabilitado && /intentos registrados/.test(pl.texto),
    pl.texto.slice(0, 160),
  );
  // (d) SG2: AMBOS impedimentos → gana el de asignaciones (precedencia fija).
  const sg2 = await motivoDe("Simulacro General 2");
  check(
    "SG2 (ambos impedimentos) → muestra el de ASIGNACIONES (precedencia)",
    sg2.deshabilitado && /asignaci/.test(sg2.texto) && !/intentos registrados/.test(sg2.texto),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n13 · Un LEGADO despublicado se reabre, deriva su estructura y se re-publica");
  // ───────────────────────────────────────────────────────────────────────────
  const filaBio = await buscarExamen(page, "Módulo Biología 1");
  await filaBio.getByRole("link", { name: /Continuar editando/ }).click();
  await page.waitForURL(/\/editar$/);
  await tarjeta(page, "Biología").waitFor({ timeout: 10_000 }).catch(() => {});
  check(
    "el legado (sin `secciones`) deriva su estructura: la sección Biología con su reactivo",
    (await tarjeta(page, "Biología").count()) === 1 &&
      ((await tarjeta(page, "Biología").textContent()) ?? "").includes("1 reactivo"),
  );
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.waitForURL(/\/instructor\/examenes$/, { timeout: 12_000 });
  check(
    "re-publicado (restaura el fixture para la repetibilidad ×2)",
    (await chipDe(page, "Módulo Biología 1")).includes("publicado"),
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n14 · «Comprensión de lectura (borrador)»: legado CON bloque persiste");
  // ───────────────────────────────────────────────────────────────────────────
  await (await buscarExamen(page, "Comprensión de lectura (borrador)"))
    .getByRole("link", { name: /Continuar editando/ })
    .click();
  await page.waitForURL(/\/editar$/);
  await page.getByText(/▤ Lectura: .+ — 2 preguntas/).waitFor({ timeout: 8000 });
  check("deriva su sección y muestra el bloque de 2 hermanas como unidad", true);
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await esperar(async () => !(await page.getByRole("button", { name: "Guardando…" }).count()));
  await page.reload();
  await page.getByText(/▤ Lectura: .+ — 2 preguntas/).waitFor({ timeout: 8000 });
  check("guardar + recargar: la estructura derivada quedó persistida y el bloque intacto", true);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n15 · Crear-directo: al final de la RACHA de su sección, no del examen");
  // ───────────────────────────────────────────────────────────────────────────
  // E21 Núcleo (publicado en §11) → volver a borrador para editarlo.
  await page.goto(`${BASE}/instructor/examenes`);
  await (await buscarExamen(page, "E21 Núcleo"))
    .getByRole("button", { name: /Devolver «E21 Núcleo» a borrador/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Volver a borrador" }).click();
  await esperar(
    async () => (await chipDe(page, "E21 Núcleo")).includes("borrador"),
  );
  await (await buscarExamen(page, "E21 Núcleo"))
    .getByRole("link", { name: /Continuar editando/ })
    .click();
  await page.waitForURL(/\/editar$/);
  const urlNucleo = page.url();
  // CL tiene reactivos; PM está VACÍA y va ANTES: el nuevo debe caer al final de la
  // racha de PM (= antes de los de CL), no al final del examen.
  await tarjeta(page, "Pensamiento matemático")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  await dialogo.waitFor();
  await dialogo.getByText("+ Crear reactivo nuevo — se agregará directo a este examen").click();
  await page.waitForURL(/\/instructor\/reactivos\/nuevo\?examen=.+&seccion=.+/, {
    timeout: 12_000,
  });
  check("⭐ el CTA guarda el borrador y navega al form con los ids en la URL", true, page.url());
  await page.getByText(/Se agregará al examen «E21 Núcleo»/).waitFor({ timeout: 8000 });
  check("el banner sale de `paraConstructor` (título real), no de la URL", true);
  const opcionesSeccion = await page.getByLabel("Sección").locator("option").allTextContents();
  check(
    "⭐ el selector queda RESTRINGIDO a la sección destino",
    opcionesSeccion.filter((t) => t.trim() === "Pensamiento matemático").length === 1 &&
      !opcionesSeccion.some((t) => t.includes("Comprensión")),
    JSON.stringify(opcionesSeccion),
  );
  await page
    .getByRole("textbox", { name: "Enunciado del reactivo" })
    .fill("E21 Directo: ¿cuánto es 2+2 en la recta numérica?");
  await page.getByPlaceholder("Opción A").fill("3");
  await page.getByPlaceholder("Opción B").fill("4");
  await page.getByPlaceholder("Opción C").fill("5");
  await page.getByLabel("Marcar la opción B como correcta").check();
  await page
    .getByRole("textbox", { name: "Explicación de la respuesta correcta" })
    .fill("Cuatro.");
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Álgebra");
  await seleccionar(page, "Subtema", "Ecuaciones lineales");
  await page.getByRole("button", { name: "Básico" }).click();
  await page.getByRole("button", { name: "Guardar reactivo" }).click();
  await page.waitForURL(urlNucleo, { timeout: 12_000 });
  check("⭐ al guardar REGRESA al constructor (`/[id]/editar`)", true, page.url());
  await page.getByText("E21 Directo").waitFor({ timeout: 8000 });
  const cardPM = tarjeta(page, "Pensamiento matemático");
  check(
    "⭐ el reactivo cayó en la RACHA de Pensamiento matemático (no al final del examen)",
    ((await cardPM.textContent()) ?? "").includes("E21 Directo") &&
      ((await cardPM.textContent()) ?? "").includes("1 de 30 reactivos"),
  );
  const numeroPrimeraCL = (
    (await ordenDe(tarjeta(page, "Comprensión lectora"))).length > 0
      ? await tarjeta(page, "Comprensión lectora")
          .locator("div.flex.items-center.gap-3.border-t span.w-6")
          .first()
          .textContent()
      : null
  )?.trim();
  check(
    "la numeración global continúa DESPUÉS de la racha de PM",
    numeroPrimeraCL === "2",
    `primera fila de CL numerada «${numeroPrimeraCL}»`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n16 · Banner de solo lectura REACTIVO (dos pestañas, sin recargar)");
  // ───────────────────────────────────────────────────────────────────────────
  const pgB = await ctxInst.newPage();
  await pgB.goto(urlNucleo);
  await pgB.getByText("E21 Directo").waitFor({ timeout: 10_000 });
  // B publica (con confirmación de incompletos) mientras A sigue abierta.
  await pgB.getByRole("button", { name: "Publicar" }).click();
  await pgB.getByRole("dialog").getByRole("button", { name: "Publicar de todos modos" }).click();
  await pgB.waitForURL(/\/instructor\/examenes$/, { timeout: 12_000 });
  await page
    .getByText(/ya no es un borrador/)
    .waitFor({ timeout: 10_000 });
  check("⭐ la pestaña A muestra el banner SIN recargar (suscripción reactiva)", true);
  check(
    "…y Guardar quedó deshabilitado",
    await page.getByRole("button", { name: "Guardar borrador" }).isDisabled(),
  );
  await pgB.close();

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n17 · Aviso al salir con cambios (click interno y cierre)");
  // ───────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/instructor/examenes`);
  await (await buscarExamen(page, "E21 Vacío"))
    .getByRole("link", { name: /Continuar editando/ })
    .click();
  await page.waitForURL(/\/editar$/);
  await page.getByLabel("Nombre del examen").fill("E21 Vacío tocado");
  let dialogoVisto = null;
  page.once("dialog", (d) => {
    dialogoVisto = d.message();
    void d.dismiss();
  });
  // Acotado al BREADCRUMB: «Exámenes» también vive en el sidebar (getByRole casa por
  // subcadena/duplicado — la lección de e2e-lui20 §8).
  await page
    .getByLabel("Ruta de navegación")
    .getByRole("link", { name: "Exámenes" })
    .click();
  await page.waitForTimeout(400);
  check(
    "⭐ click en un enlace interno con cambios → confirmación (y al cancelar se queda)",
    dialogoVisto !== null && /cambios sin guardar/i.test(dialogoVisto ?? "") &&
      /\/editar$/.test(page.url()),
    `dialog=${dialogoVisto} url=${page.url()}`,
  );
  let beforeUnloadVisto = false;
  page.once("dialog", (d) => {
    beforeUnloadVisto = d.type() === "beforeunload";
    void d.accept();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 600));
  check("cerrar la pestaña con cambios dispara `beforeunload`", beforeUnloadVisto);

  // ───────────────────────────────────────────────────────────────────────────
  console.log("\n18 · Simetría ADMIN: rutas exactas de la zona y aviso plano CON enlace");
  // ───────────────────────────────────────────────────────────────────────────
  const ctxAdmin = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pgA = await ctxAdmin.newPage();
  // Acepta cualquier confirm() (p. ej. «descartar cambios» al Cancelar): sin handler,
  // Playwright los DESCARTA y la navegación de regreso nunca ocurre.
  pgA.on("dialog", (d) => void d.accept());
  await login(pgA, ADMIN, /\/admin/);
  await pgA.goto(`${BASE}/admin/examenes/biblioteca/nuevo`);
  await pgA.getByLabel("Sección de módulo").selectOption({ label: "Biología" });
  await pgA.getByRole("button", { name: "Empezar" }).click();
  await pgA.getByLabel("Nombre del examen").fill("E21 Admin");
  await pgA.getByRole("button", { name: "Guardar borrador" }).click();
  await pgA.waitForURL(/\/admin\/examenes\/biblioteca\/[a-z0-9]+\/editar$/, {
    timeout: 12_000,
  });
  check("⭐ el guardado admin cae EXACTO en /admin/examenes/biblioteca/[id]/editar", true, pgA.url());
  const urlAdmin = pgA.url();
  // Sección plana en ADMIN: el aviso SÍ enlaza a /admin/temario.
  await pgA.getByLabel("Agregar sección").selectOption({ label: "Matemáticas financieras" });
  await pgA.getByRole("button", { name: "Agregar", exact: true }).click();
  await pgA
    .locator("section[aria-label='Sección Matemáticas financieras']")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  const diaA = pgA.getByRole("dialog");
  await diaA.waitFor();
  check(
    "⭐ el aviso de sección plana en admin ENLAZA a /admin/temario",
    (await diaA
      .getByRole("link", { name: "Gestión de temario" })
      .getAttribute("href")) === "/admin/temario",
  );
  await diaA.getByRole("button", { name: "Cancelar" }).click();
  // Crear-directo en admin: la URL del form y el REGRESO por Cancelar (constante de
  // zona, jamás un query param).
  await pgA
    .locator("section[aria-label='Sección Biología']")
    .getByRole("button", { name: "Agregar reactivos" })
    .click();
  await diaA.waitFor();
  await diaA.getByText("+ Crear reactivo nuevo — se agregará directo a este examen").click();
  await pgA.waitForURL(/\/admin\/reactivos\/nuevo\?examen=.+&seccion=.+/, { timeout: 12_000 });
  await pgA.getByText(/Se agregará al examen «E21 Admin»/).waitFor({ timeout: 8000 });
  await pgA.getByRole("button", { name: "Cancelar" }).click();
  await pgA.waitForURL(urlAdmin, { timeout: 12_000 });
  check(
    "⭐ Cancelar desde el form REGRESA exacto a /admin/examenes/biblioteca/[id]/editar",
    pgA.url() === urlAdmin,
    pgA.url(),
  );
  const actuales = await pgA.locator("[aria-current='page']").count();
  check("un solo `aria-current` en la navegación admin", actuales === 1, `hay ${actuales}`);
  await ctxAdmin.close();
} catch (e) {
  fallos++;
  console.error(`\n✘ EXCEPCIÓN no controlada: ${e?.stack ?? e}`);
} finally {
  await navegador.close();
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
