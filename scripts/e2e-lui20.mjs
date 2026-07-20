/**
 * E2E de LUI-20 — Biblioteca institucional de exámenes (Entrega B).
 *
 * ARCHIVA y DESARCHIVA exámenes, así que hace pizarra limpia al inicio y restaura el
 * fixture en `finally`. ⚠️ Los E2E reinicializan la MISMA BD de dev: **NUNCA correr dos a
 * la vez**. Repetibilidad: la suite corre DOS veces seguidas con el mismo resultado (el
 * seed converge y el flujo desarchiva lo que archivó).
 *
 * LA TABLA DE VERDAD DEL CANDADO (regla: CONGELA[estado] ∧ (≥1 asignación ∨ ≥1 intento)),
 * una fila PURA por fixture — cada una caza una regresión distinta:
 *   · SG0        asignación SÍ · intento NO  → congela  (caza borrar la rama de asignaciones)
 *   · Práctica   asignación NO · intento SÍ  → congela  (caza borrar la rama de intentos —
 *     libre                                              el mayor de la revisión de A)
 *   · SG5        asignación NO · intento NO  → libre    (caza congelar todo lo archivado)
 *
 * Aserciones DISCRIMINANTES (⭐ = falla si la implementación toma el atajo obvio):
 *  · §2 el pill de «Todos» (14) SUPERA las filas visibles (8) — caza contadores derivados
 *    de `rows.length`; la suma de pills === «Todos» — caza `archivado` como flag booleano.
 *  · §3 el chip de «Práctica libre» (tipo general EXPLÍCITO) es idéntico al de un legado
 *    con tipo AUSENTE — caza `esModulo = Boolean(tipo)`; el chip de «Módulo Matemáticas
 *    financieras» (borrador + sección PLANA) caza acoplar el chip a `estado` o resolver el
 *    nombre caminando áreas. Colores por `getComputedStyle`, no por clases.
 *  · §4 SG3 ofrece «Asignar» y SG2 «Ver resultados» — JUNTAS cazan
 *    `tieneResultados = asignacionesCount > 0`; «Práctica libre» (resultados con CERO
 *    asignaciones) lo mata más fuerte todavía.
 *  · §6 el CUARTETO del diálogo: SG3 deshabilitado por «sin concluir» · Práctica libre por
 *    «intento en curso» (su ÚNICO impedimento — discrimina la ampliación del guard) · SG2
 *    (que tiene AMBOS impedimentos) muestra el de ASIGNACIONES — el único fixture que
 *    prueba la precedencia · SG4 habilitado y archiva.
 *  · §6 tras archivar SG4, su reactivo EXCLUSIVO sigue con candado (transición, no dato) y
 *    los pills se actualizan SIN recargar — caza contadores congelados en el montaje.
 *  · §7 la vista previa cuenta EXACTAMENTE `reactivosCount` preguntas con un locator
 *    ACOTADO (`ol[aria-label]`>li — un `li` global contaría opciones y material); el bloque
 *    de 2 hermanas pinta UN pasaje (caza pintarlo por pregunta); el fantasma renderiza «ya
 *    no está disponible» sin crashear; el material queda ENTRE enunciado y opciones por
 *    GEOMETRÍA (boundingBox, no clases).
 *  · §8 el `href` de «Asignar» del montaje admin empieza por /admin/examenes/biblioteca —
 *    caza el `/instructor` hardcodeado; el borrador de Carlos SÍ es editable para la admin;
 *    exactamente UN `aria-current` en el sidebar admin — caza el doble resaltado.
 *
 * Lo que esta suite NO puede probar y queda verificado por REVISIÓN de código:
 *  1. El guard de AUTORÍA ante un examen ajeno (la UI oculta el botón; la autoría no cambia
 *     con la página abierta; `npx convex run` no pasa `requireStaff`).
 *  2. Que el guard de asignaciones/intentos viva en el SERVIDOR: el diálogo deshabilitado
 *     prueba la EXPLICACIÓN y la PREVENCIÓN en UI — la mutation nunca llega a invocarse.
 *  3. Que la autorización preceda a la salida idempotente (orden interno de la mutation).
 *  4. La idempotencia real de archivar/desarchivar (repetir la MISMA operación): cada
 *     corrida parte de pizarra limpia y la UI no ofrece archivar un archivado.
 *  5. La caducidad de `archivableAhora` al cruzar `cierraEn` con la suscripción abierta.
 *  6. El copy del estado vacío de una PESTAÑA sin filtros («No hay borradores»): el fixture
 *     no tiene pestañas vacías sin filtros que ejercitarlo.
 *  7. El clamp `safePage` (page > pageCount SIN ningún setPage — pageCount encogiéndose
 *     REACTIVAMENTE porque otro usuario archivó): inalcanzable desde una sola sesión.
 *
 * Requisitos: npx convex dev · npm run dev · (playwright chromium instalado).
 * Uso: node scripts/e2e-lui20.mjs   ·   E2E_HEADED=1 node scripts/e2e-lui20.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const INSTRUCTOR = "cristian.instructor@demo.unx.mx";
const ADMIN = "mayra.admin@demo.unx.mx";

// Fixture (convex/seed.ts) — los 4 exclusivos de la tabla de verdad:
const R_SOLO_ARCHIVADO = "evidencia al sostener una tesis"; // SG0
const R_INTENTO_DIRECTO = "una opinión de un argumento"; // Práctica libre
const R_ARCHIVADO_LIBRE = "entre tesis y conclusión"; // SG5
const R_SOLO_SG4 = "falacia de generalización"; // SG4

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

console.log("\nE2E LUI-20 · pizarra limpia + credenciales…");
try {
  await pizarraLimpia();
} catch (e) {
  console.error(`\n✘ No se pudo preparar la BD de dev — ${e.message}`);
  process.exit(1);
}

const navegador = await chromium.launch({ headless: !HEADED });

// ── Helpers de página (mismos locators que e2e-lui14 para el banco) ─────────
const filas = (pg) => pg.locator("tbody tr");
const filaDe = (pg, texto) => filas(pg).filter({ hasText: texto }).first();
const candado = (fila) =>
  fila.getByRole("link", { name: /abrir .* para desactivar/ });
const editarLink = (fila) => fila.getByRole("link", { name: /^Editar el reactivo/ });

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

/** Número del pill de una pestaña («Borradores 4» → 4). */
async function conteoDeTab(pg, tab) {
  const texto = await pg
    .getByRole("tab", { name: new RegExp(`^${tab}`) })
    .innerText();
  const m = texto.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : NaN;
}

try {
  const ctxInst = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctxInst.newPage();
  await login(page, INSTRUCTOR, /\/instructor/);
  const espera = poller(page);

  // ════ §1 · La pantalla ya no es placeholder ════
  console.log("\n1 · La pantalla real (instructor)");
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) > 0);
  check("encabezado «Exámenes»", (await page.textContent("h1"))?.trim() === "Exámenes");
  check("la fila del fixture aparece", (await filaDe(page, "Simulacro General 1").count()) === 1);
  // Negativa DESPUÉS de esperar contenido: sobre el estado de carga pasaría en falso.
  const cuerpo = (await page.textContent("body")) ?? "";
  check("no queda el ScreenPlaceholder", !cuerpo.includes("Pantalla por construir"));

  // ════ §2 · Pestañas y contadores ════
  console.log("\n2 · Pestañas con contador");
  const nTodos = await conteoDeTab(page, "Todos");
  const nBorr = await conteoDeTab(page, "Borradores");
  const nPub = await conteoDeTab(page, "Publicados");
  const nArch = await conteoDeTab(page, "Archivados");
  check(
    "⭐ el pill de «Todos» SUPERA las filas renderizadas",
    nTodos > (await filas(page).count()),
    `pill=${nTodos}, filas=${await filas(page).count()}`,
  );
  check(
    "⭐ suma de pills de estado === pill de «Todos»",
    nBorr + nPub + nArch === nTodos,
    `${nBorr}+${nPub}+${nArch} ≠ ${nTodos}`,
  );
  check("el fixture completo está (14)", nTodos === 14, `recibido ${nTodos}`);

  await page.getByRole("tab", { name: /^Archivados/ }).click();
  // El resultado del poll ES la aserción (un `check(..., true)` tras ignorarlo
  // sería un verde vacío — hallazgo de auditoría).
  const sg0Visible = await espera(
    async () => (await filaDe(page, "Simulacro General 0").count()) === 1,
  );
  check("⭐ «Archivados» muestra SG0", sg0Visible);
  check("⭐ «Archivados» muestra SG5", (await filaDe(page, "Simulacro General 5").count()) === 1);
  check(
    "⭐ SG3 (publicado) NO se fuga a «Archivados»",
    (await filaDe(page, "Simulacro General 3").count()) === 0,
  );

  // Reset de página al cambiar de pestaña.
  await page.getByRole("tab", { name: /^Todos/ }).click();
  await espera(async () => (await filas(page).count()) === 8);
  await page.getByRole("button", { name: "2", exact: true }).click();
  await espera(async () => (await filas(page).count()) === 6); // 14 − 8
  await page.getByRole("tab", { name: /^Publicados/ }).click();
  await espera(async () => (await filas(page).count()) === 8);
  check("⭐ cambiar de pestaña vuelve a la página 1", (await filas(page).count()) === 8);
  await page.getByRole("tab", { name: /^Todos/ }).click();
  await espera(async () => (await filas(page).count()) === 8);

  // ════ §3 · Chip de tipo ════
  console.log("\n3 · Chip de tipo");
  const chipDe = (titulo) => filaDe(page, titulo).locator("td").nth(1).locator("span").first();
  await espera(async () => (await filaDe(page, "Módulo Biología 1").count()) === 1);
  check(
    "⭐ chip «Módulo: Biología»",
    ((await chipDe("Módulo Biología 1").innerText()) ?? "").trim() === "Módulo: Biología",
  );
  const bgModulo = await chipDe("Módulo Biología 1").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const bgGeneral = await chipDe("Simulacro General 1").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  check("⭐ el chip de módulo se PINTA distinto (computed style)", bgModulo !== bgGeneral);
  // Módulo sobre BORRADOR y sección PLANA (sin áreas): borradores tab. Se
  // asevera texto Y COLOR — solo el texto dejaría verde un chip que acopla el
  // morado a `estado === "publicado"` (hallazgo de auditoría).
  await page.getByRole("tab", { name: /^Borradores/ }).click();
  await espera(async () => (await filaDe(page, "Módulo Matemáticas financieras").count()) === 1);
  check(
    "⭐ chip de módulo sobre BORRADOR y sección PLANA (texto)",
    ((await chipDe("Módulo Matemáticas financieras").innerText()) ?? "").trim() ===
      "Módulo: Matemáticas financieras",
  );
  check(
    "⭐ …y se PINTA morado también en borrador (computed style)",
    (await chipDe("Módulo Matemáticas financieras").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )) === bgModulo,
  );
  await page.getByRole("tab", { name: /^Todos/ }).click();
  await espera(async () => (await filas(page).count()) === 8);
  // El general EXPLÍCITO es indistinguible del legado con tipo AUSENTE.
  await page.getByPlaceholder("Buscar por título…").fill("Práctica libre");
  await espera(async () => (await filas(page).count()) === 1);
  const chipPractica = chipDe("Práctica libre");
  check(
    "⭐ «Práctica libre» (tipo general EXPLÍCITO) dice «Simulacro general»",
    ((await chipPractica.innerText()) ?? "").trim() === "Simulacro general",
  );
  check(
    "⭐ …y se pinta IGUAL que un legado con tipo ausente",
    (await chipPractica.evaluate((el) => getComputedStyle(el).backgroundColor)) === bgGeneral,
  );
  check(
    "⭐ «Práctica libre»: «Ver resultados» con CERO asignaciones («—»)",
    (await filaDe(page, "Práctica libre").getByRole("link", { name: /^Ver resultados/ }).count()) === 1 &&
      ((await filaDe(page, "Práctica libre").innerText()) ?? "").includes("—"),
  );
  await page.getByPlaceholder("Buscar por título…").fill("");
  await espera(async () => (await filas(page).count()) === 8);

  // ════ §4 · Acciones por estado y autoría ════
  console.log("\n4 · Acciones por estado y autoría");
  await page.getByRole("tab", { name: /^Publicados/ }).click();
  await espera(async () => (await filaDe(page, "Simulacro General 3").count()) === 1);
  const filaSG3 = filaDe(page, "Simulacro General 3");
  const filaSG2 = filaDe(page, "Simulacro General 2");
  check("⭐ SG3 (asignación futura, sin intentos) ofrece «Asignar»",
    (await filaSG3.getByRole("link", { name: /^Asignar/ }).count()) === 1);
  check("⭐ SG3 NO ofrece «Ver resultados»",
    (await filaSG3.getByRole("link", { name: /^Ver resultados/ }).count()) === 0);
  check("⭐ SG2 (con intentos) ofrece «Ver resultados»",
    (await filaSG2.getByRole("link", { name: /^Ver resultados/ }).count()) === 1);
  check("⭐ SG2 NO ofrece «Asignar»",
    (await filaSG2.getByRole("link", { name: /^Asignar/ }).count()) === 0);
  check("chips de ventana deterministas: SG3 «programada»",
    ((await filaSG3.innerText()) ?? "").includes("1 programada"));
  check("chips de ventana deterministas: SG2 «abiertas»",
    ((await filaSG2.innerText()) ?? "").includes("3 abiertas"));

  await page.getByRole("tab", { name: /^Borradores/ }).click();
  await espera(async () => (await filaDe(page, "Simulacro Final").count()) === 1);
  const filaPropio = filaDe(page, "Simulacro Final");
  const filaAjeno = filaDe(page, "Diagnóstico Redacción");
  const hrefEditar = await filaPropio
    .getByRole("link", { name: /^Continuar editando/ })
    .getAttribute("href");
  check(
    "⭐ borrador PROPIO → «Continuar editando» hacia …/editar",
    /^\/instructor\/examenes\/[^/]+\/editar$/.test(hrefEditar ?? ""),
    `href=${hrefEditar}`,
  );
  check("⭐ borrador AJENO (Carlos) → «Solo su autor lo edita»",
    ((await filaAjeno.innerText()) ?? "").includes("Solo su autor lo edita"));
  check("⭐ borrador AJENO → sin «Continuar editando»",
    (await filaAjeno.getByRole("link", { name: /^Continuar editando/ }).count()) === 0);
  check("todas las filas visibles ofrecen «Ver»",
    (await page.getByRole("link", { name: /^Ver el examen/ }).count()) ===
      (await filas(page).count()));
  // La casa del instructor para «Continuar editando» EXISTE (simetría de zonas).
  await filaPropio.getByRole("link", { name: /^Continuar editando/ }).click();
  await page.waitForURL(/\/instructor\/examenes\/[^/]+\/editar/, { timeout: 15_000 });
  check(
    "⭐ «Continuar editando» NO da 404 en la zona instructor",
    ((await page.textContent("body")) ?? "").includes("Constructor de examen"),
  );
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);

  // ════ §5 · La tabla de verdad del candado (banco de reactivos) ════
  console.log("\n5 · Tabla de verdad del candado");
  await page.goto(`${BASE}/instructor/reactivos`);
  await espera(async () => (await filas(page).count()) > 0);
  const buscarBanco = async (texto) => {
    await page.getByPlaceholder("Buscar en el enunciado…").fill(texto);
    await espera(async () => (await filas(page).count()) === 1);
    return filaDe(page, texto);
  };
  let fila = await buscarBanco(R_SOLO_ARCHIVADO);
  check("⭐ SG0 (asignación SÍ · intento NO) → su reactivo CON candado",
    (await candado(fila).count()) === 1);
  fila = await buscarBanco(R_INTENTO_DIRECTO);
  check("⭐ Práctica libre (asignación NO · intento SÍ) → su reactivo CON candado",
    (await candado(fila).count()) === 1);
  fila = await buscarBanco(R_ARCHIVADO_LIBRE);
  check("⭐ SG5 (asignación NO · intento NO) → su reactivo SIN candado (lápiz)",
    (await candado(fila).count()) === 0 && (await editarLink(fila).count()) === 1);
  fila = await buscarBanco(R_SOLO_SG4);
  check("SG4 publicado con asignaciones cerradas → su reactivo CON candado (antes de archivar)",
    (await candado(fila).count()) === 1);

  // ════ §6 · El cuarteto del diálogo de archivar + la transición ════
  console.log("\n6 · Archivar y desarchivar");
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  const dialogo = page.getByRole("dialog");
  const confirmarBtn = () => dialogo.getByRole("button", { name: /^Archivar$|^Archivando/ });

  // SG3: impedimento por asignación SIN CONCLUIR (copy genérico, no «programada»).
  await page.getByRole("tab", { name: /^Publicados/ }).click();
  await espera(async () => (await filaDe(page, "Simulacro General 3").count()) === 1);
  await filaDe(page, "Simulacro General 3")
    .getByRole("button", { name: /^Archivar «Simulacro General 3»/ })
    .click();
  await espera(async () => (await dialogo.count()) === 1);
  check("⭐ SG3: el diálogo EXPLICA «sin concluir» DENTRO del dialog",
    ((await dialogo.innerText()) ?? "").includes("sin concluir"));
  check("⭐ SG3: la confirmación está DESHABILITADA",
    (await confirmarBtn().isDisabled()) === true);
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await espera(async () => (await dialogo.count()) === 0);
  check("cancelar no cambió nada: SG3 sigue en «Publicados»",
    (await filaDe(page, "Simulacro General 3").count()) === 1);

  // SG2 tiene AMBOS impedimentos (asignaciones abiertas + en_curso de Emiliano):
  // el ÚNICO fixture que discrimina la precedencia «asignaciones primero».
  await filaDe(page, "Simulacro General 2")
    .getByRole("button", { name: /^Archivar «Simulacro General 2»/ })
    .click();
  await espera(async () => (await dialogo.count()) === 1);
  const textoSG2 = (await dialogo.innerText()) ?? "";
  check("⭐ SG2 (ambos impedimentos): muestra el de ASIGNACIONES…",
    textoSG2.includes("sin concluir"));
  check("⭐ …y NO el de intento en curso (precedencia)",
    !textoSG2.includes("intento en curso"));
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await espera(async () => (await dialogo.count()) === 0);

  // Práctica libre: CERO asignaciones — el intento en curso es su ÚNICO
  // impedimento. Discrimina la ampliación del guard.
  await filaDe(page, "Práctica libre")
    .getByRole("button", { name: /^Archivar «Práctica libre»/ })
    .click();
  await espera(async () => (await dialogo.count()) === 1);
  check("⭐ Práctica libre: impedimento «intento en curso» (única razón)",
    ((await dialogo.innerText()) ?? "").includes("intento en curso"));
  check("⭐ Práctica libre: confirmación deshabilitada",
    (await confirmarBtn().isDisabled()) === true);
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await espera(async () => (await dialogo.count()) === 0);

  // SG4: habilitado → archiva. Los pills deben moverse SIN recargar.
  const pubAntes = await conteoDeTab(page, "Publicados");
  const archAntes = await conteoDeTab(page, "Archivados");
  await filaDe(page, "Simulacro General 4")
    .getByRole("button", { name: /^Archivar «Simulacro General 4»/ })
    .click();
  await espera(async () => (await dialogo.count()) === 1);
  check("⭐ SG4 (solo cerradas, sin en_curso): confirmación HABILITADA",
    (await confirmarBtn().isDisabled()) === false);
  await confirmarBtn().click();
  await espera(async () => (await dialogo.count()) === 0);
  const sg4Salio = await espera(
    async () => (await filaDe(page, "Simulacro General 4").count()) === 0,
  );
  check("SG4 salió de «Publicados»", sg4Salio);
  check(
    "⭐ los pills se actualizan SIN recargar",
    (await espera(
      async () =>
        (await conteoDeTab(page, "Publicados")) === pubAntes - 1 &&
        (await conteoDeTab(page, "Archivados")) === archAntes + 1,
    )) === true,
    `esperado ${pubAntes - 1}/${archAntes + 1}`,
  );
  await page.getByRole("tab", { name: /^Archivados/ }).click();
  await espera(async () => (await filaDe(page, "Simulacro General 4").count()) === 1);
  check("⭐ SG4 archivado CON resultados → ofrece «Ver resultados»",
    (await filaDe(page, "Simulacro General 4").getByRole("link", { name: /^Ver resultados/ }).count()) === 1);

  // ⭐ LA aserción de la Entrega A sobre una TRANSICIÓN: el reactivo exclusivo de
  // SG4 sigue congelado DESPUÉS de archivar. Sin la corrección del candado
  // (publicado ∪ archivado), archivar lo habría LIBERADO. Solo discrimina porque
  // el reactivo es exclusivo de SG4.
  await page.goto(`${BASE}/instructor/reactivos`);
  await espera(async () => (await filas(page).count()) > 0);
  fila = await buscarBanco(R_SOLO_SG4);
  check("⭐ tras archivar SG4, su reactivo exclusivo SIGUE con candado",
    (await candado(fila).count()) === 1);

  // Pill «0» con la búsqueda filtrada a SG4 (los contadores son pre-pestaña).
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  await page.getByPlaceholder("Buscar por título…").fill("Simulacro General 4");
  await espera(async () => (await conteoDeTab(page, "Archivados")) === 1);
  await page.getByRole("tab", { name: /^Archivados/ }).click();
  await espera(async () => (await filaDe(page, "Simulacro General 4").count()) === 1);
  await filaDe(page, "Simulacro General 4")
    .getByRole("button", { name: /^Desarchivar «Simulacro General 4»/ })
    .click();
  await espera(async () => (await dialogo.count()) === 1);
  await dialogo.getByRole("button", { name: /^Desarchivar$/ }).click();
  await espera(async () => (await dialogo.count()) === 0);
  check(
    "⭐ desarchivar vuelve a PUBLICADO (no a borrador) y el pill queda en «0» visible",
    (await espera(async () => (await conteoDeTab(page, "Archivados")) === 0)) === true &&
      (await espera(async () => (await conteoDeTab(page, "Publicados")) === 1)) === true,
  );
  await page.getByPlaceholder("Buscar por título…").fill("");
  await page.getByRole("tab", { name: /^Todos/ }).click();
  await espera(async () => (await filas(page).count()) === 8);
  // El fixture queda restaurado (SG4 publicado): repetibilidad de la suite.

  // ════ §7 · Vista previa de solo lectura ════
  console.log("\n7 · Vista previa");
  const preguntas = (pg) => pg.locator('ol[aria-label="Preguntas del examen"] > li');

  // SG1: conteo EXACTO con locator acotado + un solo pasaje… SG1 solo tiene UNA
  // pregunta de bloque; el caso de DOS hermanas va abajo con el borrador.
  // La cifra de la columna «Reactivos» se CAPTURA de la fila ANTES de navegar:
  // compararla contra un literal (como hacía antes) no probaba la coherencia
  // tabla↔preview que el nombre afirma (hallazgo de auditoría).
  const filaSG1 = filaDe(page, "Simulacro General 1");
  const columnaReactivos = Number(
    ((await filaSG1.locator("td").nth(3).innerText()) ?? "").trim(),
  );
  await filaSG1.getByRole("link", { name: /^Ver el examen/ }).click();
  await page.waitForURL(/\/instructor\/examenes\/[^/]+\/vista/, { timeout: 15_000 });
  await espera(async () => (await preguntas(page).count()) > 0);
  check("⭐ la URL es …/vista y el título del examen está en pantalla",
    ((await page.textContent("h1")) ?? "").includes("Simulacro General 1"));
  check(
    "⭐ nº de preguntas (locator ACOTADO) === columna «Reactivos» capturada de la fila",
    Number.isFinite(columnaReactivos) &&
      columnaReactivos > 0 &&
      (await preguntas(page).count()) === columnaReactivos,
    `columna=${columnaReactivos}, preview=${await preguntas(page).count()}`,
  );
  const region = page.locator('ol[aria-label="Preguntas del examen"]');
  check("⭐ SOLO LECTURA: sin inputs ni contenteditable ni «Guardar»",
    (await region.locator("input, textarea, [contenteditable='true']").count()) === 0 &&
      (await region.getByRole("button", { name: /Guardar/ }).count()) === 0);
  check("la respuesta correcta está marcada",
    (await region.getByLabel("Respuesta correcta").count()) > 0);

  // El bloque COMPLETO (2 hermanas contiguas) → UN pasaje.
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  await page.getByRole("tab", { name: /^Borradores/ }).click();
  await espera(async () => (await filaDe(page, "Comprensión de lectura (borrador)").count()) === 1);
  await filaDe(page, "Comprensión de lectura (borrador)")
    .getByRole("link", { name: /^Ver el examen/ })
    .click();
  await page.waitForURL(/\/vista/, { timeout: 15_000 });
  await espera(async () => (await preguntas(page).count()) === 2);
  check(
    "⭐ 2 preguntas HERMANAS → UN solo pasaje de lectura",
    (await page.getByText("Lectura: El valor de la objecion en un debate").count()) === 1,
  );

  // El fantasma: renderiza el hueco, no crashea, y el conteo cuadra.
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  await page.getByPlaceholder("Buscar por título…").fill("Simulacro legado");
  await espera(async () => (await filas(page).count()) === 1);
  await filaDe(page, "Simulacro legado").getByRole("link", { name: /^Ver el examen/ }).click();
  await page.waitForURL(/\/vista/, { timeout: 15_000 });
  await espera(async () => (await preguntas(page).count()) === 1);
  check(
    "⭐ el reactivo FANTASMA renderiza «ya no está disponible» en su posición",
    ((await page.textContent("body")) ?? "").includes("ya no está disponible"),
  );

  // Geometría del material (SG4, restaurado a publicado): ENTRE enunciado y opciones.
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  await page.getByPlaceholder("Buscar por título…").fill("Simulacro General 4");
  await espera(async () => (await filas(page).count()) === 1);
  await filaDe(page, "Simulacro General 4").getByRole("link", { name: /^Ver el examen/ }).click();
  await page.waitForURL(/\/vista/, { timeout: 15_000 });
  await espera(async () => (await preguntas(page).count()) === 1);
  const material = page.getByRole("group", { name: "Material del reactivo" });
  await espera(async () => (await material.count()) === 1);
  const cajaMaterial = await material.boundingBox();
  // El enunciado se localiza por su TEXTO, no por clase CSS: `cn()` (tailwind-merge)
  // puede fusionar/eliminar clases utilitarias, así que una clase no es un ancla.
  const cajaEnunciado = await page
    .locator('ol[aria-label="Preguntas del examen"]')
    .getByText("falacia de generalización apresurada")
    .first()
    .boundingBox();
  const cajaOpcion = await page
    .locator('ol[aria-label="Preguntas del examen"] ul > li')
    .first()
    .boundingBox();
  check(
    "⭐ GEOMETRÍA: el material queda entre el enunciado y la primera opción",
    cajaMaterial !== null &&
      cajaEnunciado !== null &&
      cajaOpcion !== null &&
      cajaEnunciado.y < cajaMaterial.y &&
      cajaMaterial.y < cajaOpcion.y,
  );

  // ════ §8 · Doble montaje, middleware y navegación (admin) ════
  console.log("\n8 · Doble montaje y middleware");
  await page.goto(`${BASE}/admin/examenes/biblioteca`);
  await page.waitForURL(/\/instructor/, { timeout: 15_000 });
  check("⭐ el middleware saca al instructor de la zona admin", true);

  const ctxAdmin = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pageAdmin = await ctxAdmin.newPage();
  await login(pageAdmin, ADMIN, /\/admin/);
  const esperaAdmin = poller(pageAdmin);

  await pageAdmin.goto(`${BASE}/instructor/examenes`);
  await pageAdmin.waitForURL(/\/admin/, { timeout: 15_000 });
  check("el middleware saca a la admin de la zona instructor", true);

  await pageAdmin.goto(`${BASE}/admin/examenes/biblioteca`);
  await esperaAdmin(async () => (await filas(pageAdmin).count()) > 0);
  check("la biblioteca CARGA en el montaje admin",
    ((await pageAdmin.textContent("h1")) ?? "").trim() === "Exámenes");

  await pageAdmin.getByRole("tab", { name: /^Publicados/ }).click();
  await esperaAdmin(async () => (await filaDe(pageAdmin, "Simulacro General 3").count()) === 1);
  const hrefAsignar = await filaDe(pageAdmin, "Simulacro General 3")
    .getByRole("link", { name: /^Asignar/ })
    .getAttribute("href");
  check(
    "⭐ el href de «Asignar» empieza por /admin/examenes/biblioteca/",
    (hrefAsignar ?? "").startsWith("/admin/examenes/biblioteca/"),
    `href=${hrefAsignar}`,
  );

  await pageAdmin.getByRole("tab", { name: /^Borradores/ }).click();
  await esperaAdmin(async () => (await filaDe(pageAdmin, "Diagnóstico Redacción").count()) === 1);
  check(
    "⭐ la ADMIN sí puede editar el borrador de Carlos (rama admin de esEditable)",
    (await filaDe(pageAdmin, "Diagnóstico Redacción")
      .getByRole("link", { name: /^Continuar editando/ })
      .count()) === 1,
  );

  // «Crear examen» tiene casa en la zona admin (no 404).
  await pageAdmin.getByRole("button", { name: /Crear examen/ }).click();
  await pageAdmin.waitForURL(/\/admin\/examenes\/biblioteca\/nuevo/, { timeout: 15_000 });
  check(
    "⭐ «Crear examen» del montaje admin NO da 404",
    ((await pageAdmin.textContent("body")) ?? "").includes("Crear examen"),
  );

  // Un solo aria-current, y es la Biblioteca (no «Resumen de exámenes»).
  await pageAdmin.goto(`${BASE}/admin/examenes/biblioteca`);
  await esperaAdmin(async () => (await filas(pageAdmin).count()) > 0);
  const actuales = pageAdmin.locator('aside nav [aria-current="page"]');
  check("⭐ EXACTAMENTE UN aria-current en el sidebar admin",
    (await actuales.count()) === 1,
    `recibidos ${await actuales.count()}`);
  check("⭐ …y es «Biblioteca de exámenes» (no el Resumen)",
    ((await actuales.first().innerText()) ?? "").includes("Biblioteca de exámenes"));

  // El breadcrumb de la vista admin apunta a la base ADMIN.
  await filaDe(pageAdmin, "Simulacro General 1").getByRole("link", { name: /^Ver el examen/ }).click();
  await pageAdmin.waitForURL(/\/admin\/examenes\/biblioteca\/[^/]+\/vista/, { timeout: 15_000 });
  // Acotado al nav del breadcrumb: `getByRole(name)` casa por SUBCADENA y un
  // «Exámenes» suelto atraparía «Resumen de exámenes» del sidebar.
  const hrefMiga = await pageAdmin
    .locator('nav[aria-label="Ruta de navegación"]')
    .getByRole("link", { name: "Exámenes" })
    .getAttribute("href");
  check("⭐ el breadcrumb de la vista admin apunta a /admin/examenes/biblioteca",
    hrefMiga === "/admin/examenes/biblioteca", `href=${hrefMiga}`);

  // ════ §9 · Métrica por grupo (efecto colateral documentado del fixture) ════
  console.log("\n9 · Métrica «Exámenes aplicados» por grupo (LUI-12)");
  /** La CIFRA de la tarjeta «Exámenes aplicados» de la ficha del grupo. Se
   *  localiza la tarjeta por su etiqueta y se lee SOLO su texto — buscar el
   *  número en todo el body era un verde vacío (Matutino tiene 5 alumnas: un «5»
   *  suelto siempre aparece; hallazgo de auditoría). El div más INTERNO que
   *  contiene la etiqueta es la columna cifra+etiqueta del MetricCard. */
  async function metricaExamenesAplicados(pg, grupo) {
    await pg.goto(`${BASE}/admin/grupos`);
    await poller(pg)(async () => (await filas(pg).count()) > 0);
    await filaDe(pg, grupo).getByRole("link").first().click();
    await pg.waitForURL(/\/admin\/grupos\/[^/]+$/, { timeout: 15_000 });
    const tarjeta = pg
      .locator("div", { has: pg.getByText("Exámenes aplicados", { exact: true }) })
      .last();
    await poller(pg)(async () => (await tarjeta.count()) === 1);
    const m = ((await tarjeta.innerText()) ?? "").match(/\d+/);
    return m ? Number(m[0]) : NaN;
  }
  check(
    "Matutino A: la TARJETA «Exámenes aplicados» dice 5 (3 previos + SG0 + SG4)",
    (await metricaExamenesAplicados(pageAdmin, "Matutino A")) === 5,
  );
  check(
    "Vespertino B: la TARJETA «Exámenes aplicados» dice 4 (3 previos + SG4)",
    (await metricaExamenesAplicados(pageAdmin, "Vespertino B")) === 4,
  );

  // ════ §10 · Estado vacío, paginación defensiva, aria-live, responsive ════
  console.log("\n10 · Estado vacío, paginación y responsive");
  await page.goto(`${BASE}/instructor/examenes`);
  await espera(async () => (await filas(page).count()) === 8);
  // Filtros sin coincidencia → rama con «Limpiar filtros».
  await page.getByPlaceholder("Buscar por título…").fill("zzz-no-existe");
  await espera(async () =>
    ((await page.textContent("body")) ?? "").includes("No hay exámenes con esta combinación"));
  check("estado vacío de FILTROS ofrece «Limpiar filtros»",
    (await page.getByRole("button", { name: "Limpiar filtros" }).count()) === 1);
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await espera(async () => (await filas(page).count()) === 8);

  // Paginación defensiva: última página + búsqueda de 1 resultado → se VE.
  await page.getByRole("button", { name: "2", exact: true }).click();
  await espera(async () => (await filas(page).count()) === 6);
  await page.getByPlaceholder("Buscar por título…").fill("Práctica libre");
  await espera(async () => (await filas(page).count()) === 1);
  // Rótulo honesto (hallazgo de auditoría): esto ejercita el `setPage(1)` del
  // BUSCADOR — el clamp `safePage` (page > pageCount sin ningún setPage, p. ej.
  // cuando otro usuario archiva y pageCount se encoge REACTIVAMENTE bajo los
  // pies) no es alcanzable desde una sola sesión y queda verificado por revisión
  // de `biblioteca-examenes-client.tsx`.
  check("⭐ setPage(1) del buscador: buscar desde la página 2 muestra el resultado, no una página vacía",
    (await filaDe(page, "Práctica libre").count()) === 1);
  check("aria-live anuncia el conteo",
    ((await page.locator("[aria-live='polite']").innerText()) ?? "").includes("encontrados"));
  await page.getByPlaceholder("Buscar por título…").fill("");
  await espera(async () => (await filas(page).count()) === 8);

  // Responsive: a 900px las 8 columnas hacen scroll DENTRO del contenedor.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(400);
  const scrollea = await page
    .locator(".overflow-x-auto")
    .first()
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  check("responsive: la tabla scrollea dentro de su contenedor (geometría)", scrollea);

  await ctxAdmin.close();
  await ctxInst.close();
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e.stack ?? e}`);
} finally {
  await navegador.close();
  console.log("\nRestaurando el fixture…");
  try {
    await pizarraLimpia();
  } catch (e) {
    console.error(`  (no se pudo restaurar: ${e.message})`);
  }
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
