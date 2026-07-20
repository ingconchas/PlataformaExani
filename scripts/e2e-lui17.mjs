/**
 * E2E de LUI-17 — Lecturas con bloque de preguntas.
 *
 * CREA y EDITA lecturas y reactivos, así que hace pizarra limpia al inicio y restaura el
 * fixture en `finally`. ⚠️ Los E2E reinicializan la MISMA BD de dev: **NUNCA correr dos a
 * la vez**.
 *
 * Todo lo que esta suite crea va bajo «Comprensión lectora / Textos argumentativos», el área
 * ACTIVA que añadió el commit 5. Ninguna otra suite cuenta ahí — misma disciplina que
 * `e2e-lui16.mjs` con «Operaciones con fracciones».
 *
 * Aserciones DISCRIMINANTES (⭐ = falla si la implementación toma el atajo obvio):
 *  · §5 abrir el drawer en P1, cerrarlo y abrirlo en P3 — falla si el drawer no se desmonta
 *    o no lleva `key` por identidad (`RichTextEditor` lee `value` solo al montar).
 *  · §6 reordenar y RECARGAR — sin el reload, un reordenamiento que solo vive en el estado
 *    del cliente pasaría.
 *  · §7 mover la lectura de subtema mueve los contadores del temario EN BLOQUE — falla si se
 *    parchea la lectura sin sus preguntas, o si se ajusta ±1 en vez de ±n.
 *  · §8 la 6ª pregunta la rechaza el SERVIDOR, probado por CONCURRENCIA: dos páginas
 *    autenticadas sobre la misma lectura con 4 preguntas; ambas tienen el botón habilitado y
 *    ambas envían, así que una crea la quinta y la otra recibe el rechazo.
 *  · §9 el lápiz de una pregunta de bloque apunta a la LECTURA (se afirma el `href`).
 *
 * Lo que esta suite NO puede probar y queda verificado por REVISIÓN de código: los guards de
 * `reactivos.actualizar`, `reactivos.cambiarEstado` y `lecturas.cambiarEstadoPregunta` ante
 * un cliente manipulado — la UI desvía antes, `npx convex run` no pasa `requireStaff` y el
 * cliente de Convex no está expuesto en `window`.
 *
 * Requisitos: npx convex dev · npm run dev · (playwright chromium instalado).
 * Uso: node scripts/e2e-lui17.mjs   ·   E2E_HEADED=1 node scripts/e2e-lui17.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx";
const ADMIN = "mayra.admin@demo.unx.mx";

const TITULO = "E2E LUI-17 lectura de prueba";
const SEMBRADA = "El calentamiento global";
// Bloque de DOS preguntas del fixture: la primera entra a los exámenes publicados y la
// segunda queda apartada, así que su candado viene SOLO de la expansión al bloque.
const BLOQUE = "El valor de la objecion en un debate";
const HERMANA_LIBRE = "¿que funcion cumple una objecion";

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

/** `convex run` que ABORTA si falla: correr sobre datos de la corrida anterior daría verdes
 *  dependientes del estado previo y arruinaría la comprobación de idempotencia. */
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

console.log("\nE2E LUI-17 · pizarra limpia + credenciales…");
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

const ctxInst = await navegador.newContext();
const page = await ctxInst.newPage();
const esperar = poller(page);
// Quitar una pregunta pide confirmación (renumera las siguientes).
page.on("dialog", (d) => d.accept());

const filaLectura = (pg, titulo) =>
  pg.locator("tbody tr").filter({ hasText: titulo }).first();
const drawer = (pg) => pg.getByRole("dialog");
const preguntas = (pg) =>
  pg.getByRole("list", { name: "Preguntas de la lectura" }).locator("> li");

/** Llena el drawer abierto SIN enviarlo. */
async function llenarDrawer(pg, { enunciado, opciones, correcta, explicacion, dificultad }) {
  const d = drawer(pg);
  await pg.getByRole("textbox", { name: "Enunciado de la pregunta" }).fill(enunciado);
  const letras = ["A", "B", "C", "D"];
  for (let i = 0; i < opciones.length; i++)
    await d.getByPlaceholder(`Opción ${letras[i]}`).fill(opciones[i]);
  await d.getByLabel(`Marcar la opción ${correcta} como correcta`).check();
  await pg.getByRole("textbox", { name: "Explicación de la pregunta" }).fill(explicacion);
  // ⚠️ Acotado al diálogo: la dificultad de la LECTURA vive en la misma página.
  await d.getByRole("button", { name: dificultad }).click();
}

/** Envía el drawer abierto. */
async function enviarDrawer(pg) {
  await drawer(pg)
    .getByRole("button", { name: /Agregar a la lectura|Guardar pregunta/ })
    .click();
}

async function agregarPregunta(pg, n, dificultad = "Intermedio") {
  await pg.getByRole("button", { name: "Agregar pregunta" }).click();
  await poller(pg)(async () => (await drawer(pg).count()) === 1);
  await llenarDrawer(pg, {
    enunciado: `Pregunta E2E numero ${n}`,
    opciones: [`Opcion A${n}`, `Opcion B${n}`, `Opcion C${n}`],
    correcta: "A",
    explicacion: `Explicacion E2E ${n}`,
    dificultad,
  });
  await enviarDrawer(pg);
  await poller(pg)(async () => (await drawer(pg).count()) === 0);
}

/** Conteo de un nodo del temario (pantalla de admin). */
async function contarNodo(pg, nombre) {
  const fila = pg
    .locator("li")
    .filter({ has: pg.getByText(nombre, { exact: true }) })
    .first();
  const t = (await fila.textContent()) ?? "";
  const m = t.match(/(\d+) reactivos?/);
  return m ? Number(m[1]) : null;
}

try {
  await login(page, INSTRUCTOR, /\/instructor/);

  console.log("1 · La pantalla de lecturas ya no es un placeholder");
  await page.goto(`${BASE}/instructor/lecturas`);
  await esperar(async () => (await page.locator("tbody tr").count()) > 0);
  const cuerpo = (await page.textContent("body")) ?? "";
  check("no queda el ScreenPlaceholder", !cuerpo.includes("Pantalla por construir"));
  check("encabezado «Lecturas»", (await page.textContent("h1"))?.trim() === "Lecturas");
  check(
    "la lectura del fixture aparece",
    (await filaLectura(page, SEMBRADA).count()) === 1,
  );
  check(
    "⭐ con 1 pregunta se marca «Incompleta» (publicar exige 2)",
    ((await filaLectura(page, SEMBRADA).textContent()) ?? "").includes("Incompleta"),
  );
  check(
    "y muestra a Carlos como autor (la autoría es la de la lectura)",
    ((await filaLectura(page, SEMBRADA).textContent()) ?? "").includes("Carlos"),
  );

  console.log("\n2 · Alta: el bloque es LOCAL hasta guardar");
  await page.goto(`${BASE}/instructor/lecturas/nueva`);
  await page.getByLabel("Título de la lectura").fill(TITULO);
  await page
    .getByRole("textbox", { name: "Texto base de la lectura" })
    .fill("Texto base de prueba para el bloque de comprension lectora.");
  await seleccionar(page, "Sección", "Comprensión lectora");
  await seleccionar(page, "Área temática", "Textos argumentativos");
  await seleccionar(page, "Subtema", "Tesis y argumentos");
  await page.getByRole("button", { name: "Intermedio" }).first().click();
  check(
    "el estado vacío invita a agregar preguntas",
    ((await page.textContent("body")) ?? "").includes("todavía no tiene preguntas"),
  );
  await agregarPregunta(page, 1);
  await agregarPregunta(page, 2);
  check("las 2 preguntas se ven en el bloque", (await preguntas(page).count()) === 2);

  console.log("\n3 · ⭐ El alta local NO autosalva");
  // Ojo: esto demuestra que nada se persistió antes de «Guardar lectura». La ATOMICIDAD de
  // la mutation la da la transacción de Convex y se verifica por revisión.
  await page.goto(`${BASE}/instructor/lecturas`);
  await esperar(async () => (await page.locator("tbody tr").count()) > 0);
  check(
    "⭐ tras abandonar el alta no quedó ninguna lectura a medias",
    (await filaLectura(page, TITULO).count()) === 0,
  );

  console.log("\n4 · Alta completa (mutation atómica)");
  await page.goto(`${BASE}/instructor/lecturas/nueva`);
  await page.getByLabel("Título de la lectura").fill(TITULO);
  await page
    .getByRole("textbox", { name: "Texto base de la lectura" })
    .fill("Texto base de prueba para el bloque de comprension lectora.");
  await seleccionar(page, "Sección", "Comprensión lectora");
  await seleccionar(page, "Área temática", "Textos argumentativos");
  await seleccionar(page, "Subtema", "Tesis y argumentos");
  await page.getByRole("button", { name: "Intermedio" }).first().click();
  await agregarPregunta(page, 1);
  await agregarPregunta(page, 2);
  await agregarPregunta(page, 3);
  await page.getByRole("button", { name: "Guardar lectura" }).click();
  await page.waitForURL(/\/instructor\/lecturas$/, { timeout: 15_000 });
  await esperar(async () => (await filaLectura(page, TITULO).count()) === 1);
  const fila = (await filaLectura(page, TITULO).textContent()) ?? "";
  check("la lectura nueva aparece en el listado", fila.length > 0);
  check("con sus 3 preguntas", fila.includes("3"));
  check("y SIN la insignia «Incompleta»", !fila.includes("Incompleta"));

  console.log("\n5 · ⭐ El drawer no arrastra la pregunta anterior");
  await filaLectura(page, TITULO)
    .getByRole("link", { name: /^Editar la lectura/ })
    .click();
  await esperar(async () => (await preguntas(page).count()) === 3);
  await page.getByRole("button", { name: "Editar la pregunta 1" }).click();
  await esperar(async () => (await drawer(page).count()) === 1);
  const texto1 = (await page.getByRole("textbox", { name: "Enunciado de la pregunta" }).textContent()) ?? "";
  check("abre la pregunta 1 con SU enunciado", texto1.includes("numero 1"), texto1.trim());
  await drawer(page).getByRole("button", { name: "Cancelar" }).click();
  await esperar(async () => (await drawer(page).count()) === 0);
  await page.getByRole("button", { name: "Editar la pregunta 3" }).click();
  await esperar(async () => (await drawer(page).count()) === 1);
  const texto3 = (await page.getByRole("textbox", { name: "Enunciado de la pregunta" }).textContent()) ?? "";
  check(
    "⭐ al abrir la pregunta 3 muestra la 3, NO la 1",
    texto3.includes("numero 3") && !texto3.includes("numero 1"),
    texto3.trim(),
  );
  await drawer(page).getByRole("button", { name: "Cancelar" }).click();
  await esperar(async () => (await drawer(page).count()) === 0);

  console.log("\n6 · ⭐ Reordenar PERSISTE (se verifica tras recargar)");
  await page.getByRole("button", { name: "Subir la pregunta 3" }).click();
  await esperar(async () =>
    ((await preguntas(page).nth(1).textContent()) ?? "").includes("numero 3"),
  );
  await page.reload();
  await esperar(async () => (await preguntas(page).count()) === 3);
  const orden = [];
  for (let i = 0; i < 3; i++)
    orden.push(((await preguntas(page).nth(i).textContent()) ?? "").match(/numero (\d)/)?.[1]);
  check(
    "⭐ tras RECARGAR el orden es 1, 3, 2",
    JSON.stringify(orden) === '["1","3","2"]',
    JSON.stringify(orden),
  );

  console.log("\n7 · Quitar una pregunta renumera");
  await page.getByRole("button", { name: "Quitar la pregunta 2" }).click();
  await esperar(async () => (await preguntas(page).count()) === 2);
  check("el bloque queda con 2 preguntas", (await preguntas(page).count()) === 2);
  check(
    "y la que era 3ª ahora es la 2ª",
    ((await preguntas(page).nth(1).textContent()) ?? "").includes("numero 2"),
  );

  console.log("\n8 · ⭐ La 6ª pregunta la rechaza el SERVIDOR (concurrencia)");
  await agregarPregunta(page, 4);
  await agregarPregunta(page, 5);
  await esperar(async () => (await preguntas(page).count()) === 4);
  const url = page.url();
  const page2 = await ctxInst.newPage();
  page2.on("dialog", (d) => d.accept());
  await page2.goto(url);
  await poller(page2)(async () => (await preguntas(page2).count()) === 4);

  // ⚠️ Convex es REACTIVO: si se dejara a la segunda página mirando la lista, vería la
  // quinta pregunta al instante y su propio botón se deshabilitaría, así que el guard del
  // SERVIDOR nunca se ejercería y la prueba sería de UI. Por eso la segunda página abre y
  // LLENA su drawer ANTES —el caso real: alguien lo tenía abierto mientras un compañero
  // agregaba una pregunta— y lo envía DESPUÉS.
  await page2.getByRole("button", { name: "Agregar pregunta" }).click();
  await poller(page2)(async () => (await drawer(page2).count()) === 1);
  await llenarDrawer(page2, {
    enunciado: "Pregunta E2E numero 7",
    opciones: ["Opcion A7", "Opcion B7", "Opcion C7"],
    correcta: "A",
    explicacion: "Explicacion E2E 7",
    dificultad: "Intermedio",
  });

  // La primera página crea la QUINTA (legal).
  await agregarPregunta(page, 6);
  await esperar(async () => (await preguntas(page).count()) === 5);

  // Y ahora la segunda envía la SEXTA desde su drawer ya abierto: solo el servidor puede
  // rechazarla, porque el cliente creía que quedaba sitio.
  await enviarDrawer(page2);
  // ⚠️ El mensaje se busca DENTRO del diálogo: en `body` pasaría aunque el error se
  // pintara detrás del overlay, donde el usuario no puede verlo.
  const rechazo = await poller(page2)(async () =>
    ((await drawer(page2).textContent().catch(() => "")) ?? "").includes("como máximo"),
  );
  check("⭐ el servidor rechaza la 6ª pregunta", rechazo);
  check(
    "⭐ y el rechazo se ve DENTRO del drawer, no detrás del overlay",
    ((await drawer(page2).textContent().catch(() => "")) ?? "").includes("como máximo"),
  );
  await page2.close();
  await page.reload();
  await esperar(async () => (await preguntas(page).count()) === 5);
  check("el bloque quedó en 5, no en 6", (await preguntas(page).count()) === 5);

  console.log("\n9 · ⭐ Puerta única: el banco lleva a la lectura");
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await page.locator("tbody tr").count()) > 0);
  await page.getByPlaceholder("Buscar en el enunciado…").fill("Pregunta E2E numero 1");
  await esperar(async () => (await page.locator("tbody tr").count()) === 1);
  const filaBanco = page.locator("tbody tr").first();
  const chip = filaBanco.getByRole("link", { name: /Lectura:/ });
  check("⭐ el chip «Lectura» es un ENLACE", (await chip.count()) === 1);
  const hrefChip = (await chip.getAttribute("href")) ?? "";
  check(
    "⭐ y apunta a una ruta que EXISTE (/lecturas/{id}/editar)",
    /^\/instructor\/lecturas\/[^/]+\/editar$/.test(hrefChip),
    hrefChip,
  );
  const lapiz = filaBanco.getByRole("link", { name: /^Editar en la lectura/ });
  check("⭐ el lápiz dice «Editar en la lectura»", (await lapiz.count()) === 1);
  const href = (await lapiz.getAttribute("href")) ?? "";
  check(
    "⭐ y apunta a /lecturas/{id}/editar, no al formulario de reactivo",
    /\/instructor\/lecturas\/[^/]+\/editar$/.test(href),
    href,
  );
  check(
    "esa fila ya NO casa con el locator «Editar el reactivo»",
    (await filaBanco.getByRole("link", { name: /^Editar el reactivo/ }).count()) === 0,
  );
  await chip.click();
  // ⚠️ No basta con que la URL contenga «/lecturas/»: hay que exigir CONTENIDO POSITIVO de
  // la página destino. Sin esto, un enlace a una ruta inexistente pasaría la prueba.
  const cargo = await esperar(async () =>
    (await page.getByLabel("Título de la lectura").count()) === 1,
  );
  check("⭐ el chip navega y la lectura CARGA de verdad", cargo, page.url());

  console.log("\n10 · ⭐ Mover la lectura de subtema mueve el BLOQUE (contadores)");
  const ctxAdmin = await navegador.newContext();
  const admin = await ctxAdmin.newPage();
  await login(admin, ADMIN, /\/admin/);
  await admin.goto(`${BASE}/admin/temario`);
  await esperar(async () => (await admin.locator("li").count()) > 0);
  const antesOrigen = await contarNodo(admin, "Textos argumentativos");
  const antesDestino = await contarNodo(admin, "Aritmética");
  await page.goto(`${BASE}/instructor/lecturas`);
  await esperar(async () => (await filaLectura(page, TITULO).count()) === 1);
  await filaLectura(page, TITULO)
    .getByRole("link", { name: /^Editar la lectura/ })
    .click();
  await esperar(async () => (await preguntas(page).count()) === 5);
  await seleccionar(page, "Sección", "Pensamiento matemático");
  await seleccionar(page, "Área temática", "Aritmética");
  await seleccionar(page, "Subtema", "Operaciones con fracciones");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(/\/instructor\/lecturas$/, { timeout: 15_000 });
  await admin.reload();
  await poller(admin)(async () => (await admin.locator("li").count()) > 0);
  const despuesOrigen = await contarNodo(admin, "Textos argumentativos");
  const despuesDestino = await contarNodo(admin, "Aritmética");
  check(
    "⭐ el origen baja 5 de golpe (±n, no ±1)",
    antesOrigen !== null && despuesOrigen === antesOrigen - 5,
    `${antesOrigen} → ${despuesOrigen}`,
  );
  check(
    "⭐ y el destino sube 5",
    antesDestino !== null && despuesDestino === antesDestino + 5,
    `${antesDestino} → ${despuesDestino}`,
  );
  await ctxAdmin.close();

  console.log("\n11 · Desactivar una pregunta del bloque");
  await filaLectura(page, TITULO)
    .getByRole("link", { name: /^Editar la lectura/ })
    .click();
  await esperar(async () => (await preguntas(page).count()) === 5);
  await preguntas(page).first().getByRole("button", { name: "Desactivar" }).click();
  await esperar(async () =>
    ((await preguntas(page).first().textContent()) ?? "").includes("Desactivada"),
  );
  check(
    "la pregunta queda desactivada desde la LECTURA",
    ((await preguntas(page).first().textContent()) ?? "").includes("Desactivada"),
  );
  await page.goto(`${BASE}/instructor/lecturas`);
  await esperar(async () => (await filaLectura(page, TITULO).count()) === 1);
  check(
    "y el bloque pasa a «Incompleta» (una pregunta inactiva no publica)",
    ((await filaLectura(page, TITULO).textContent()) ?? "").includes("Incompleta"),
  );

  console.log("\n12 · ⭐ CANDADO DE BLOQUE: una pregunta comprometida congela a sus hermanas");
  // La lectura del fixture tiene 2 preguntas y SOLO la primera está en un examen publicado
  // con asignación. Si el candado no se expandiera, la hermana se vería editable.
  await page.goto(`${BASE}/instructor/lecturas`);
  await esperar(async () => (await filaLectura(page, BLOQUE).count()) === 1);
  check(
    "la lectura del bloque se marca «En uso»",
    ((await filaLectura(page, BLOQUE).textContent()) ?? "").includes("En uso"),
  );
  await filaLectura(page, BLOQUE)
    .getByRole("link", { name: /^Editar la lectura/ })
    .click();
  await esperar(async () => (await preguntas(page).count()) === 2);
  check(
    "el formulario avisa de que el bloque está congelado",
    ((await page.textContent("body")) ?? "").includes("bloque completo está congelado"),
  );
  check(
    "⭐ no ofrece «Agregar pregunta»",
    (await page.getByRole("button", { name: "Agregar pregunta" }).count()) === 0,
  );
  check(
    "⭐ ni flechas de reordenamiento",
    (await page.getByRole("button", { name: /^Subir la pregunta/ }).count()) === 0,
  );
  check(
    "⭐ ni «Guardar cambios»",
    (await page.getByRole("button", { name: "Guardar cambios" }).count()) === 0,
  );
  check(
    "pero SÍ deja desactivar (única operación permitida bajo candado)",
    (await page.getByRole("button", { name: "Desactivar" }).count()) > 0,
  );
  // Y en el banco, la HERMANA —que no está en ningún examen QUE CONGELE (desde
  // LUI-20 B vive en un borrador, y un borrador no congela)— debe mostrar candado.
  await page.goto(`${BASE}/instructor/reactivos`);
  await esperar(async () => (await page.locator("tbody tr").count()) > 0);
  await page.getByPlaceholder("Buscar en el enunciado…").fill(HERMANA_LIBRE);
  await esperar(async () => (await page.locator("tbody tr").count()) === 1);
  const filaHermana = page.locator("tbody tr").first();
  check(
    "⭐ la HERMANA (en ningún examen que congele) muestra CANDADO, no lápiz",
    (await filaHermana.getByRole("link", { name: /^En uso en un examen/ }).count()) === 1,
  );
  check(
    "⭐ y no ofrece «Editar en la lectura»",
    (await filaHermana.getByRole("link", { name: /^Editar en la lectura/ }).count()) === 0,
  );

  console.log("\n13 · Lectura ajena: solo lectura");
  await filaLectura(page, SEMBRADA)
    .getByRole("link", { name: /^Editar la lectura/ })
    .count()
    .then((n) =>
      check("una lectura de otro autor no ofrece el lápiz de edición", n === 0),
    );
} catch (e) {
  fallos++;
  console.error("  ✘ excepción:", e?.message ?? e);
} finally {
  await navegador.close();
  console.log("\nRestaurando el fixture…");
  try {
    await pizarraLimpia();
  } catch (e) {
    fallos++;
    console.error(`  ✘ no se pudo restaurar el fixture — ${e.message}`);
  }
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
