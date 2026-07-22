/**
 * E2E de LUI-19 — Panel principal del Instructor (Diseño 13). Corre con
 * `npm run e2e:lui19` (requiere `npm run dev` + `npx convex dev` activos).
 *
 * Estructura: §0 pizarra en dos tiempos (el VACÍO se prueba primero, sin
 * fixture) → §1 estado vacío → §2 carga REACTIVA del seed con el panel abierto →
 * §3 panel de cristian contra el oráculo → §4 panel de diana → §4b authz de Q2
 * por cliente HTTP autenticado → §5 testigo de TIEMPO (ambos cruces) → §5b cota
 * de vivas (escritor `asignar`, ramas `grupos` y `todosLosGrupos`) → §5c
 * frontera de membresías (escritores reales vía mutations autenticadas) → §6
 * móvil (drawer `<dialog>`) → §7 admin no roto.
 *
 * Aserciones DISCRIMINANTES (⭐ — cada una se demostró en ROJO con el sabotaje
 * indicado):
 *  · §1 regiones Pendientes/«Tu material» AUSENTES en vacío — renderizarlas
 *    siempre las haría aparecer (mock 02 = SOLO la card).
 *  · §3 SG3 (futura) y SG0/SG4 (cerradas) SIN card — leer `by_grupo` sin corte
 *    temporal o pintar sin `estadoDeVentana` las mete.
 *  · §3 card SG2 SIN «Vespertino B» — pintar todas las asignaciones del examen
 *    sin intersectar con los grupos DEL instructor la mete.
 *  · §3 «Matutino A · 4 de 4 completaron» — contar INTENTOS (no alumnas) da
 *    «5 de 4» por el reintento de ana.lopez; sin filtro `activo` da «de 5» por
 *    Santiago.
 *  · §3 barra naranja con `bg-unx-orange` presente y `bg-unx-green` ausente —
 *    umbral invertido o clase concatenada que el JIT de Tailwind v4 no emite.
 *  · §3 fila de Emiliano «En curso» / Fernanda Gutiérrez «No ha iniciado» —
 *    derivar el badge de «tiene algún intento» las confunde.
 *  · §3 «Tu material» = conteo de FILAS del oráculo — contar `by_autor` del
 *    instructor da otro número (autores repartidos); el oráculo cuenta filas,
 *    así que una deriva del contador denormalizado también cae aquí.
 *  · §4 diana ve SG2 con «Vespertino B» y SIN «Matutino A» — filtrar por
 *    `creadoPor` (todo el seed es de cristian) le vaciaría el panel.
 *  · §4b `participacionDeGrupo` de un grupo AJENO devuelve null — sin la
 *    comprobación de membresía entregaría el roster de otro instructor.
 *  · §5 la card de SG3 APARECE al cruzar `abreEn` y DESAPARECE al cruzar
 *    `cierraEn` SIN recargar y SIN cambio documental — al cruzar una frontera
 *    ningún doc cambia, la query jamás se re-ejecuta: sin el timer del reloj
 *    anclado la card queda mal PARA SIEMPRE. Anti-vacuidad: se espera el CAMBIO
 *    de `data-ahora-servidor` (la entrega reactiva llegó) ANTES de asertar la
 *    ausencia, y el deadline se DERIVA de la frontera (+8 s — no perdona un
 *    reloj roto).
 *  · §5b la 31ª asignación viva de un grupo se RECHAZA nombrándolo (rama
 *    `grupos` vía diana; rama `todosLosGrupos` vía admin) — quitar
 *    `validarCapacidadVivas` del escritor la deja pasar.
 *  · §5c la membresía 101 se RECHAZA en `grupos.crear` (con rollback: el grupo
 *    NO persiste) y en `usuarios.actualizar`; la 100 PASA — quitar
 *    `asegurarCapacidadMembresias` de cualquiera de esos escritores rompe su
 *    rama. Se conduce por las MUTATIONS reales autenticadas (integración del
 *    escritor — la opción del dictamen; el formulario solo deduplica antes).
 *  · §6 Escape cierra el drawer y el foco REGRESA a la hamburguesa; con el
 *    drawer abierto Tab NO sale del dialog (fondo inert) — un drawer de
 *    translate-x no da ninguna de las dos.
 *
 * Lo que esta suite NO puede probar (declarado):
 *  · El cruce de MEDIANOCHE MX de la fecha del encabezado (exigiría correr a
 *    medianoche) — la frontera está unit-testeada (`siguienteMedianocheMx` en
 *    fronteras de la derivación).
 *  · `usuarios.crear` al tope de membresías (un instructor NUEVO exigiría 101
 *    grupos preexistentes) — cubierto por el unit de TAMAÑO FINAL multi-alta y
 *    por compartir la frontera centralizada con los 3 caminos aquí probados.
 *  · Legados desbordados (membresía >100 real, catálogo >200, roster >200,
 *    sondas >512) — exigirían cientos de docs; sus estados de problema están
 *    unit-testeados en la derivación (`test-panel-instructor.ts`).
 *  · Q2 en «error» real (exigiría romper el deployment a mitad de corrida) —
 *    la costura está unit-testeada.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const CRISTIAN = "cristian.instructor@demo.unx.mx";
const DIANA = "diana.instructor@demo.unx.mx";

const SG2 = "Simulacro General 2";
const SG3 = "Simulacro General 3";
// El examen del testigo de tiempo (§5). ⚠️ NO puede ser SG3: ese es el
// publicado DEGRADADO a propósito del fixture (trae un reactivo desactivado
// para el candado de LUI-14/20) y `asignar` re-valida `validarPublicable`, así
// que lo rechaza — correcto. «Módulo Biología 1» es asignable (lui22 lo asigna
// por UI) y no tiene card previa para cristian.
const EXAMEN5 = "Módulo Biología 1";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const OFFSET_MX = 6 * HORA;
const UMBRAL = 0.6;

// ── URL efectiva de Convex (condición del GO) ────────────────────────────────
// La MISMA precedencia que Next: primero la variable del proceso, después
// `.env.local`. `E2E_CONVEX_URL` NO elige deployment (no puede cambiar el de la
// app ya arrancada ni el de `npx convex run`): si está definida, se EXIGE que
// coincida — si difiere, la app, el JWT, los fixtures y este cliente apuntarían
// a deployments distintos y toda la suite mentiría.
function urlConvexEfectiva() {
  let url = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  if (!url) {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      const m = env.match(/^NEXT_PUBLIC_CONVEX_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m);
      if (m) url = m[1].trim();
    } catch {
      /* sin .env.local: cae al error de abajo */
    }
  }
  if (!url) {
    console.error(
      "✘ No hay NEXT_PUBLIC_CONVEX_URL (ni en el proceso ni en .env.local).",
    );
    process.exit(1);
  }
  if (process.env.E2E_CONVEX_URL && process.env.E2E_CONVEX_URL !== url) {
    console.error(
      `✘ E2E_CONVEX_URL (${process.env.E2E_CONVEX_URL}) difiere de la URL efectiva de la app (${url}).`,
    );
    process.exit(1);
  }
  return url;
}
const CONVEX_URL = urlConvexEfectiva();
// Clave EXACTA del JWT de @convex-dev/auth (namespace escapado — jamás «la
// primera con prefijo»: localStorage puede guardar sesiones de varios
// deployments). ⚠️ El token NUNCA se imprime.
const CLAVE_JWT = `__convexAuthJWT_${CONVEX_URL.replace(/[^a-zA-Z0-9]/g, "")}`;

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

async function correrConvex(fn, args = { confirmar: "SOLO_DEV" }) {
  const { code, salida } = await ejecutar("npx", [
    "convex", "run", fn, JSON.stringify(args),
  ]);
  if (code !== 0)
    throw new Error(`«convex run ${fn}» salió con código ${code}: ${salida.trim()}`);
  return salida;
}

/** Epoch → «YYYY-MM-DDTHH:mm» en RELOJ DE PARED MX (para el datetime-local). */
function relojMx(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** Epoch al que el servidor redondea un valor de datetime-local (minuto exacto). */
function alMinuto(ts) {
  return ts - ((ts - OFFSET_MX) % MIN);
}

// ── Réplicas INDEPENDIENTES (a propósito duplicadas de convex/) ──────────────
const DIAS_L = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function fechaLargaEsperada(ts) {
  const d = new Date(ts - OFFSET_MX);
  return `${DIAS_L[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_L[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
function fechaHoraEsperada(ts) {
  const d = new Date(ts - OFFSET_MX);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} de ${MESES_L[d.getUTCMonth()]}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Réplica MÍNIMA de la derivación del panel (precedente `rangoEsperado` de
 * lui22): del oráculo CRUDO del seed + el `ahora` de Node AL ASERTAR produce
 * cards (orden: cierre → título es), barras («X de Y», tono por umbral 60 %),
 * pendientes (orden: cierre → examen → grupo → alumna) y «Ver todos».
 */
function derivarReplica(oraculo, ahora) {
  const rosterDe = new Map(oraculo.grupos.map((g) => [g.nombre, g.alumnasActivas]));
  const abiertas = oraculo.asignaciones.filter(
    (a) => a.abreEn <= ahora && ahora < a.cierraEn,
  );
  const porExamen = new Map();
  for (const a of abiertas) {
    const l = porExamen.get(a.examenId) ?? [];
    l.push(a);
    porExamen.set(a.examenId, l);
  }
  const cards = [];
  const pendientes = [];
  for (const [examenId, filasEx] of porExamen) {
    const cierraProximo = Math.min(...filasEx.map((f) => f.cierraEn));
    const porGrupo = new Map();
    for (const f of filasEx) {
      const l = porGrupo.get(f.grupo) ?? [];
      l.push(f);
      porGrupo.set(f.grupo, l);
    }
    const barras = [];
    for (const [grupo, fg] of porGrupo) {
      const roster = rosterDe.get(grupo) ?? [];
      const envs = new Set();
      for (const f of fg)
        for (const al of f.porAlumna)
          if (al.estado === "enviado" && roster.includes(al.nombre))
            envs.add(al.nombre);
      barras.push({
        grupo,
        completaron: envs.size,
        total: roster.length,
        tono:
          roster.length > 0 && envs.size / roster.length >= UMBRAL
            ? "green"
            : "orange",
      });
      for (const alumna of roster) {
        let envio = false;
        let enCurso = false;
        for (const f of fg)
          for (const al of f.porAlumna) {
            if (al.nombre !== alumna) continue;
            if (al.estado === "enviado") envio = true;
            else enCurso = true;
          }
        if (!envio)
          pendientes.push({
            alumna,
            grupo,
            examen: fg[0].examen,
            examenId,
            cierre: cierraProximo,
            estado: enCurso ? "En curso" : "No ha iniciado",
          });
      }
    }
    barras.sort((x, y) => x.grupo.localeCompare(y.grupo, "es"));
    cards.push({ examenId, titulo: filasEx[0].examen, cierraProximo, barras });
  }
  cards.sort(
    (x, y) =>
      x.cierraProximo - y.cierraProximo ||
      x.titulo.localeCompare(y.titulo, "es") ||
      (x.examenId < y.examenId ? -1 : x.examenId > y.examenId ? 1 : 0),
  );
  pendientes.sort(
    (x, y) =>
      x.cierre - y.cierre ||
      x.examen.localeCompare(y.examen, "es") ||
      (x.examenId < y.examenId ? -1 : x.examenId > y.examenId ? 1 : 0) ||
      x.grupo.localeCompare(y.grupo, "es") ||
      x.alumna.localeCompare(y.alumna, "es"),
  );
  return {
    cards,
    pendientes,
    verTodos: cards.length > 0 ? cards[0].examenId : null,
  };
}

// ── §0 · Pizarra en DOS tiempos ──────────────────────────────────────────────
// Limpiar SIN cargar: el estado vacío se prueba PRIMERO contra una BD sin
// contenido (los grupos y usuarios sobreviven a la pizarra; las credenciales se
// generan aquí y NO se regeneran en §2 — la sesión abierta debe sobrevivir a la
// carga para que §2 pruebe reactividad y no un re-login).
console.log("\nE2E LUI-19 · §0 pizarra en dos tiempos (limpiar + credenciales)…");
try {
  await correrConvex("seed:limpiarContenidoDemo");
  await correrConvex("seedAuth:credencialesDemo");
} catch (e) {
  console.error(`\n✘ No se pudo preparar la BD de dev — ${e.message}`);
  process.exit(1);
}

// El navegador se lanza DENTRO del try (hallazgo medio del GO de código): §0 ya
// vació la BD, así que un fallo del lanzamiento también debe pasar por el
// finally que la restaura.
let navegador = null;

function poller(pg) {
  return async (cond, ms = 10_000) => {
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

/** El token de la sesión del contexto de `pg` — jamás se imprime. */
async function tokenDe(pg) {
  const token = await pg.evaluate((k) => localStorage.getItem(k), CLAVE_JWT);
  if (!token) throw new Error("No hay JWT en localStorage (clave namespaced).");
  return token;
}
function clienteConvex(token) {
  const c = new ConvexHttpClient(CONVEX_URL);
  c.setAuth(token);
  return c;
}

const cards = (pg) => pg.locator("[data-examen-activo]");
const cardDe = (pg, titulo) => cards(pg).filter({ hasText: titulo }).first();
const regionPendientes = (pg) =>
  pg.getByRole("region", { name: "Pendientes de participación" });
const regionMaterial = (pg) => pg.getByRole("region", { name: "Tu material" });

// Helpers del formulario de asignación (calcados de e2e-lui22.mjs).
const filasBiblioteca = (pg) => pg.locator("tbody tr");
async function abrirAsignar(pg, biblioteca, titulo) {
  await pg.goto(`${BASE}${biblioteca}`);
  const espera = poller(pg);
  await espera(async () => (await filasBiblioteca(pg).count()) > 0);
  await pg.getByPlaceholder("Buscar por título…").fill(titulo);
  await espera(
    async () =>
      (await filasBiblioteca(pg).filter({ hasText: titulo }).count()) === 1,
  );
  await pg.getByRole("link", { name: `Asignar «${titulo}»` }).click();
  await pg.waitForURL(/\/asignar$/, { timeout: 15_000 });
  await espera(async () =>
    ((await pg.textContent("body")) ?? "").includes("¿A quién va dirigido?"),
  );
}
async function elegirGrupo(pg, nombre) {
  await pg.getByRole("combobox").click();
  await pg.getByRole("option", { name: new RegExp(`^${nombre}`) }).click();
  await pg.keyboard.press("Escape");
}
async function llenarVentana(pg, abreTs, cierraTs) {
  await pg.fill("#asignar-apertura", relojMx(abreTs));
  await pg.fill("#asignar-cierre", relojMx(cierraTs));
}
const confirmarBtn = (pg) =>
  pg.getByRole("button", { name: "Confirmar asignación" });

let oraculo = null; // panelInstructorEsperado (lo entrega el seed en §2)

try {
  navegador = await chromium.launch({ headless: !HEADED });
  const ctxCristian = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctxCristian.newPage();
  await login(page, CRISTIAN, /\/instructor/);
  const espera = poller(page);

  // ════ §1 · Estado VACÍO (mock 13, variante 02) ════
  console.log("\n1 · Estado vacío (sin contenido en la BD)");
  await espera(async () =>
    ((await page.textContent("body")) ?? "").includes("Hola, Cristian"),
  );
  check(
    "encabezado «Hola, Cristian» (nombre de PILA)",
    ((await page.textContent("h1")) ?? "").trim() === "Hola, Cristian",
  );
  {
    const antes = fechaLargaEsperada(Date.now());
    const sub = ((await page.textContent("h1 + p")) ?? "").trim();
    const despues = fechaLargaEsperada(Date.now());
    check(
      "la fecha larga MX (réplica muestreada antes/después)",
      sub === antes || sub === despues,
      sub,
    );
  }
  const cuerpo1 = (await page.textContent("body")) ?? "";
  check(
    "card vacía: «No tienes exámenes en aplicación»",
    cuerpo1.includes("No tienes exámenes en aplicación"),
  );
  check(
    "card vacía: el texto guía del mock",
    cuerpo1.includes("Crea un examen y asígnalo a tus grupos para verlo aquí."),
  );
  check(
    "⭐ región «Pendientes de participación» AUSENTE en vacío",
    (await regionPendientes(page).count()) === 0,
    "el mock 02 es SOLO la card — renderizar la sección siempre la haría aparecer",
  );
  check(
    "⭐ región «Tu material» AUSENTE en vacío",
    (await regionMaterial(page).count()) === 0,
  );
  await page.getByRole("link", { name: "Crear examen" }).click();
  await page.waitForURL(/\/instructor\/examenes\/nuevo$/, { timeout: 15_000 });
  check("CTA «Crear examen» navega al constructor", true);
  await page.goto(`${BASE}/instructor`);

  // ════ §2 · Carga REACTIVA con el panel abierto ════
  console.log("\n2 · El seed carga con el panel abierto (reactividad, sin recargar)");
  const salidaSeed = await correrConvex("seed:cargarDatosDePrueba");
  const json = salidaSeed.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("No se pudo leer la salida del seed.");
  oraculo = JSON.parse(json[0]).panelInstructorEsperado;
  check(
    "las cards aparecen SIN recargar (la mutación del seed invalida las queries)",
    await espera(async () => (await cards(page).count()) > 0, 20_000),
  );

  // ════ §3 · Panel de cristian contra el oráculo ════
  console.log("\n3 · Panel de cristian (derivación de la réplica AL ASERTAR)");
  const oc = oraculo.instructores[CRISTIAN];
  check(
    "sanidad del oráculo: cristian instruye Matutino A y Sabatino C",
    JSON.stringify(oc.grupos.map((g) => g.nombre)) ===
      JSON.stringify(["Matutino A", "Sabatino C"]),
  );
  {
    const d3 = derivarReplica(oc, Date.now());
    await espera(async () => (await cards(page).count()) === d3.cards.length);
    // Las Q2 llegan DESPUÉS de Q1 (queries separadas por diseño): la costura se
    // ESPERA antes de asertar barras/pendientes — mientras carga, las cards van
    // SIN barra a propósito (nada fabricado) y asertar ahí probaría la carga.
    const cardSG2 = cardDe(page, SG2);
    const c2 = d3.cards.find((c) => c.titulo === SG2);
    await espera(
      async () =>
        (await cardSG2.locator("[data-grupo-barra]").count()) ===
        c2.barras.length,
      20_000,
    );
    await espera(
      async () =>
        (await regionPendientes(page)
          .locator("[data-pendiente-alumno]")
          .count()) === Math.min(d3.pendientes.length, 5),
      20_000,
    );
    const titulos = await cards(page).locator("h3").allTextContents();
    check(
      "conjunto Y ORDEN de cards = réplica (cierre → título)",
      JSON.stringify(titulos) === JSON.stringify(d3.cards.map((c) => c.titulo)),
      `UI: ${titulos.join(" | ")} · réplica: ${d3.cards.map((c) => c.titulo).join(" | ")}`,
    );
    check(
      "⭐ SG3 (ventana futura) SIN card",
      (await cardDe(page, SG3).count()) === 0,
      "leer vivas sin filtrar `estadoDeVentana` en cliente la mete",
    );
    check(
      "⭐ SG0 y SG4 (cerradas) SIN card",
      (await cardDe(page, "Simulacro General 0").count()) === 0 &&
        (await cardDe(page, "Simulacro General 4").count()) === 0,
      "leer `by_grupo` sin `gt(cierraEn, ahora)` las mete",
    );
    check(
      "badge «Cierra el {fecha, hora}» exacto (réplica de fechaHoraMx)",
      ((await cardSG2.textContent()) ?? "").includes(
        `Cierra el ${fechaHoraEsperada(c2.cierraProximo)}`,
      ),
    );
    check(
      "⭐ card SG2: exactamente sus 2 grupos (Matutino A y Sabatino C)",
      (await cardSG2.locator("[data-grupo-barra]").count()) === 2 &&
        !((await cardSG2.textContent()) ?? "").includes("Vespertino B"),
      "pintar TODAS las asignaciones del examen (VespB incluida) rompe el alcance",
    );
    const etiquetas = await cardSG2
      .locator("[data-grupo-barra] p")
      .allTextContents();
    const esperadas = c2.barras.map(
      (b) => `${b.grupo} · ${b.completaron} de ${b.total} completaron`,
    );
    check(
      "⭐ etiquetas de barras de SG2 = réplica («Matutino A · 4 de 4 completaron»…)",
      JSON.stringify(etiquetas) === JSON.stringify(esperadas),
      `UI: ${etiquetas.join(" | ")} · réplica: ${esperadas.join(" | ")}`,
    );
    // Tonos por umbral: una barra VERDE y una NARANJA reales del fixture.
    const verde = d3.cards.flatMap((c) =>
      c.barras.filter((b) => b.tono === "green").map((b) => ({ c, b })),
    )[0];
    const naranja = d3.cards.flatMap((c) =>
      c.barras.filter((b) => b.tono === "orange").map((b) => ({ c, b })),
    )[0];
    check("el fixture ofrece barra verde Y naranja", !!verde && !!naranja);
    if (verde && naranja) {
      const barraDe = (par) =>
        cardDe(page, par.c.titulo)
          .locator("[data-grupo-barra]")
          .filter({ hasText: par.b.grupo });
      check(
        `barra verde (${par2s(verde)}) usa bg-unx-green`,
        (await barraDe(verde).locator(".bg-unx-green").count()) === 1 &&
          (await barraDe(verde).locator(".bg-unx-orange").count()) === 0,
      );
      check(
        `⭐ barra naranja (${par2s(naranja)}) usa bg-unx-orange y NO bg-unx-green`,
        (await barraDe(naranja).locator(".bg-unx-orange").count()) === 1 &&
          (await barraDe(naranja).locator(".bg-unx-green").count()) === 0,
        "umbral invertido o clase concatenada (el JIT no la emite)",
      );
    }
    const hrefResultados = await cardSG2
      .getByRole("link", { name: `Ver resultados de «${SG2}»` })
      .getAttribute("href");
    check(
      "«Ver resultados →» apunta al examen EXACTO del oráculo",
      hrefResultados === `/instructor/examenes/${c2.examenId}/resultados`,
      hrefResultados ?? "sin href",
    );
    // Pendientes contra la réplica (nombres en orden + estado por fila).
    const nombresUI = await regionPendientes(page)
      .locator("[data-pendiente-alumno]")
      .allTextContents();
    const pendEsperados = d3.pendientes.slice(0, 5);
    check(
      "pendientes: nombres EN ORDEN de la réplica (≤5 filas)",
      JSON.stringify(nombresUI) ===
        JSON.stringify(pendEsperados.map((p) => p.alumna)),
      `UI: ${nombresUI.join(" | ")} · réplica: ${pendEsperados.map((p) => p.alumna).join(" | ")}`,
    );
    let estadosBien = true;
    for (let i = 0; i < pendEsperados.length; i++) {
      const fila = regionPendientes(page).locator("tbody tr").nth(i);
      const texto = (await fila.textContent()) ?? "";
      if (!texto.includes(pendEsperados[i].estado)) estadosBien = false;
    }
    check("cada fila pendiente lleva SU estado de la réplica", estadosBien);
    const filaEmiliano = regionPendientes(page)
      .locator("tbody tr")
      .filter({ hasText: "Emiliano Ríos Paz" })
      .filter({ hasText: SG2 });
    check(
      "⭐ Emiliano (intento en curso en SG2) lleva badge «En curso»",
      (await filaEmiliano.count()) === 1 &&
        ((await filaEmiliano.first().textContent()) ?? "").includes("En curso"),
      "derivar el badge de «tiene algún intento» lo marcaría completado o «No ha iniciado»",
    );
    const filaFernanda = regionPendientes(page)
      .locator("tbody tr")
      .filter({ hasText: "Fernanda Gutiérrez Peña" })
      .filter({ hasText: "Diagnóstico por áreas" });
    check(
      "⭐ Fernanda Gutiérrez (sin intento en el Diagnóstico) lleva «No ha iniciado»",
      (await filaFernanda.count()) === 1 &&
        ((await filaFernanda.first().textContent()) ?? "").includes(
          "No ha iniciado",
        ),
    );
    const hrefVerTodos = await page
      .locator("[data-ver-todos]")
      .getAttribute("href");
    check(
      "«Ver todos» → resultados del examen MÁS PRÓXIMO a cerrar",
      hrefVerTodos === `/instructor/examenes/${d3.verTodos}/resultados`,
      hrefVerTodos ?? "sin href",
    );
    // «Tu material» + placeholder de resultados.
    check(
      "⭐ «Tu material» = conteo de FILAS del oráculo",
      ((await regionMaterial(page).textContent()) ?? "").includes(
        `${oraculo.totalReactivos} reactivos institucionales`,
      ),
      "contar `by_autor` o heredar una deriva del contador da otro número",
    );
    check(
      "«Ir al banco» apunta al banco",
      (await regionMaterial(page)
        .getByRole("link", { name: "Ir al banco" })
        .getAttribute("href")) === "/instructor/reactivos",
    );
    check(
      "sin hamburguesa en desktop",
      !(await page
        .getByRole("button", { name: "Abrir menú de navegación" })
        .isVisible()),
    );
    await page.goto(`${BASE}/instructor/examenes/${c2.examenId}/resultados`);
    check(
      "el placeholder de resultados (LUI-30) renderiza",
      await poller(page)(async () =>
        ((await page.textContent("body")) ?? "").includes("Resultados del examen"),
      ),
    );
    await page.goto(`${BASE}/instructor`);
    await espera(async () => (await cards(page).count()) > 0);
  }

  // ════ §4 · Panel de diana (alcance por MEMBRESÍA, no por creadoPor) ════
  console.log("\n4 · Panel de diana");
  const ctxDiana = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const pageD = await ctxDiana.newPage();
  await login(pageD, DIANA, /\/instructor/);
  const esperaD = poller(pageD);
  await esperaD(async () => (await cards(pageD).count()) > 0, 20_000);
  {
    const cardSG2D = cardDe(pageD, SG2);
    // Esperar la costura de las Q2 de diana (misma razón que en §3).
    await esperaD(
      async () =>
        ((await cardSG2D.textContent()) ?? "").includes("Vespertino B"),
      20_000,
    );
    const textoD = (await cardSG2D.textContent()) ?? "";
    check(
      "⭐ diana ve SG2 con «Vespertino B» y SIN «Matutino A»",
      textoD.includes("Vespertino B") && !textoD.includes("Matutino A"),
      "filtrar por `creadoPor` (todo el seed es de cristian) vaciaría su panel",
    );
  }

  // ════ §4b · Authz de Q2 por cliente HTTP autenticado ════
  console.log("\n4b · participacionDeGrupo niega grupos ajenos (origen de «sin_acceso»)");
  {
    const clienteDiana = clienteConvex(await tokenDe(pageD));
    const resumenDiana = await clienteDiana.query("panelInstructor:resumen", {});
    const vespB = resumenDiana.grupos.find((g) => g.nombre === "Vespertino B");
    check("sanidad: diana SÍ alcanza Vespertino B por Q1", !!vespB);
    const q2Diana = await clienteDiana.query(
      "panelInstructor:participacionDeGrupo",
      { grupoId: vespB.grupoId },
    );
    check(
      "control positivo: la Q2 de SU grupo entrega roster",
      q2Diana !== null && q2Diana.alumnas.length > 0,
    );
    const clienteCristian = clienteConvex(await tokenDe(page));
    const q2Ajena = await clienteCristian.query(
      "panelInstructor:participacionDeGrupo",
      { grupoId: vespB.grupoId },
    );
    check(
      "⭐ la Q2 de un grupo AJENO devuelve null (ni roster ni estados)",
      q2Ajena === null,
      "sin la comprobación de membresía, cristian leería el roster de diana",
    );
  }

  // ════ §5 · Testigo de TIEMPO: ambos cruces sin recargar ════
  console.log(
    `\n5 · «${EXAMEN5}»→Sabatino C programada: aparece al abrir y desaparece al cerrar`,
  );
  {
    const anclaAntes = await page
      .locator("[data-ahora-servidor]")
      .getAttribute("data-ahora-servidor");
    const page2 = await ctxCristian.newPage();
    await abrirAsignar(page2, "/instructor/examenes", EXAMEN5);
    await elegirGrupo(page2, "Sabatino C");
    // La ventana se calcula JUSTO antes del submit (patrón §7b de lui22 — la
    // primera corrida la calculó ANTES de abrir el formulario y el flujo se
    // comió el margen: la vigencia mínima rechazaba la ventana): el próximo
    // minuto que deje ≥45 s de flujo; cierre un minuto después.
    let abre5 = alMinuto(Date.now()) + MIN;
    if (abre5 - Date.now() < 45_000) abre5 += MIN;
    const cierra5 = abre5 + MIN;
    await llenarVentana(page2, abre5, cierra5);
    await poller(page2)(async () => !(await confirmarBtn(page2).isDisabled()));
    await confirmarBtn(page2).click();
    await page2.waitForURL(/\/instructor\/examenes$/, { timeout: 15_000 });
    await page2.close();
    // Anti-vacuidad: la entrega REACTIVA ya llegó (el ancla cambió) — la
    // ausencia que sigue no puede ser una entrega tardía.
    check(
      "⭐ la re-entrega reactiva llegó (data-ahora-servidor CAMBIÓ)",
      await espera(
        async () =>
          (await page
            .locator("[data-ahora-servidor]")
            .getAttribute("data-ahora-servidor")) !== anclaAntes,
        20_000,
      ),
    );
    check(
      "la card sigue AUSENTE (programada, con los datos ya entregados)",
      (await cardDe(page, EXAMEN5).count()) === 0,
    );
    const margenAbre = abre5 - Date.now() + 8_000;
    check(
      "⭐ la card APARECE al cruzar abreEn — sin recargar ni cambio documental",
      await espera(async () => (await cardDe(page, EXAMEN5).count()) === 1, margenAbre),
      "sin el abreEn de las programadas en las fronteras del timer, jamás aparece",
    );
    check(
      "…y sus pendientes de Sabatino C aparecieron con ella",
      await espera(
        async () =>
          (await regionPendientes(page)
            .locator("tbody tr")
            .filter({ hasText: EXAMEN5 })
            .count()) > 0,
      ),
    );
    const margenCierra = cierra5 - Date.now() + 8_000;
    check(
      "⭐ la card DESAPARECE al cruzar cierraEn — sin recargar",
      await espera(async () => (await cardDe(page, EXAMEN5).count()) === 0, margenCierra),
      "al cruzar cierraEn ningún documento cambia: sin timer, la card queda para siempre",
    );
    check(
      "⭐ …y sus filas pendientes se fueron en el MISMO cruce",
      await espera(
        async () =>
          (await regionPendientes(page)
            .locator("tbody tr")
            .filter({ hasText: EXAMEN5 })
            .count()) === 0,
      ),
    );
  }

  // ════ §5b · Cota de VIVAS en el escritor (ramas grupos y todosLosGrupos) ════
  console.log("\n5b · La 31ª asignación viva de Vespertino B se rechaza");
  {
    await correrConvex("seed:completarVivasParaCota", {
      confirmar: "SOLO_DEV",
      grupoNombre: "Vespertino B",
      objetivo: 29,
    });
    // Diana (rama `grupos`): la 30ª pasa…
    await abrirAsignar(pageD, "/instructor/examenes", EXAMEN5);
    await elegirGrupo(pageD, "Vespertino B");
    const abre30 = alMinuto(Date.now() + 40 * DIA);
    await llenarVentana(pageD, abre30, abre30 + DIA);
    await esperaD(async () => !(await confirmarBtn(pageD).isDisabled()));
    await confirmarBtn(pageD).click();
    await pageD.waitForURL(/\/instructor\/examenes$/, { timeout: 15_000 });
    check("la 30ª viva (futura) PASA", true);
    // …y la 31ª se rechaza nombrando al grupo.
    await abrirAsignar(pageD, "/instructor/examenes", EXAMEN5);
    await elegirGrupo(pageD, "Vespertino B");
    const abre31 = alMinuto(Date.now() + 50 * DIA);
    await llenarVentana(pageD, abre31, abre31 + DIA);
    await esperaD(async () => !(await confirmarBtn(pageD).isDisabled()));
    await confirmarBtn(pageD).click();
    check(
      "⭐ la 31ª se RECHAZA con el mensaje de la cota (rama `grupos`)",
      await esperaD(async () =>
        ((await pageD.textContent("body")) ?? "").includes(
          "alcanzó el máximo de asignaciones vivas (30)",
        ),
      ),
      "sin `validarCapacidadVivas` en `asignar`, la 31ª entra",
    );
    // Admin (rama `todosLosGrupos`): el error NOMBRA a Vespertino B.
    const ctxAdmin = await navegador.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageA = await ctxAdmin.newPage();
    await login(pageA, ADMIN, /\/admin/);
    await abrirAsignar(pageA, "/admin/examenes/biblioteca", EXAMEN5);
    await pageA.getByText("Todos los grupos", { exact: true }).click();
    const abreT = alMinuto(Date.now() + 60 * DIA);
    await llenarVentana(pageA, abreT, abreT + DIA);
    await poller(pageA)(async () => !(await confirmarBtn(pageA).isDisabled()));
    await confirmarBtn(pageA).click();
    check(
      "⭐ «Todos los grupos» también se rechaza y NOMBRA a Vespertino B",
      await poller(pageA)(async () => {
        const t = (await pageA.textContent("body")) ?? "";
        return (
          t.includes("Vespertino B") &&
          t.includes("alcanzó el máximo de asignaciones vivas (30)")
        );
      }),
      "la cota no puede existir solo en la rama equivalente `grupos`",
    );

    // ════ §5c · Frontera de MEMBRESÍAS en los escritores reales ════
    console.log("\n5c · La membresía 100 pasa; la 101 se rechaza en crear y actualizar");
    await correrConvex("seed:sembrarMembresiasParaCota", {
      confirmar: "SOLO_DEV",
      instructorCorreo: CRISTIAN,
      objetivo: 98,
      candidatosPara: DIANA,
    });
    const admin = clienteConvex(await tokenDe(pageA));
    const staff1 = await admin.query("usuarios:listarStaff", {});
    const cristian1 = staff1.find((f) => f.correo === CRISTIAN);
    const dianaFila = staff1.find((f) => f.correo === DIANA);
    check(
      "sanidad: cristian quedó con 98 membresías (fillers cerrados incluidos)",
      cristian1.grupos.length === 98,
      `tiene ${cristian1.grupos.length}`,
    );
    const activos = await admin.query("grupos:listar", {});
    const candidato = (letra) =>
      activos.find((g) => g.nombre === `[Cota LUI-19] Candidato ${letra}`);
    const mensajeDe = async (fn) => {
      try {
        await fn();
        return null;
      } catch (e) {
        return String(e?.data ?? e?.message ?? e);
      }
    };
    // 99 — grupos.actualizar añade a cristian al Candidato G.
    const err99 = await mensajeDe(() =>
      admin.mutation("grupos:actualizar", {
        grupoId: candidato("G").id,
        nombre: "[Cota LUI-19] Candidato G",
        ciclo: "Cota",
        turno: "matutino",
        instructorIds: [dianaFila.userId, cristian1.userId],
      }),
    );
    check("99 · `grupos.actualizar` añade al Candidato G (pasa)", err99 === null, err99 ?? "");
    // 100 — usuarios.actualizar añade el Candidato A (pasa ⭐).
    const staff2 = await admin.query("usuarios:listarStaff", {});
    const cristian2 = staff2.find((f) => f.correo === CRISTIAN);
    const err100 = await mensajeDe(() =>
      admin.mutation("usuarios:actualizar", {
        perfilId: cristian2.id,
        nombre: "Cristian",
        apellidos: "Martínez",
        materia: "Matemáticas",
        grupoIds: [...cristian2.grupos.map((g) => g.id), candidato("A").id],
      }),
    );
    check(
      "⭐ 100 · `usuarios.actualizar` añade el Candidato A (el TOPE exacto pasa)",
      err100 === null,
      err100 ?? "",
    );
    // 101 — grupos.crear con cristian: RECHAZO con rollback.
    const err101crear = await mensajeDe(() =>
      admin.mutation("grupos:crear", {
        nombre: "[Cota LUI-19] Intento crear",
        ciclo: "Cota",
        turno: "matutino",
        instructorIds: [cristian1.userId],
      }),
    );
    check(
      "⭐ 101 · `grupos.crear` se RECHAZA con el mensaje de la cota",
      (err101crear ?? "").includes("máximo de grupos por instructor (100)"),
      err101crear ?? "no lanzó",
    );
    check(
      "⭐ …con ROLLBACK: el grupo del intento NO persiste",
      !(await admin.query("grupos:listar", {})).some(
        (g) => g.nombre === "[Cota LUI-19] Intento crear",
      ),
    );
    // 101 — usuarios.actualizar con el Candidato B: RECHAZO.
    const staff3 = await admin.query("usuarios:listarStaff", {});
    const cristian3 = staff3.find((f) => f.correo === CRISTIAN);
    check(
      "sanidad: cristian está exactamente en el tope (100)",
      cristian3.grupos.length === 100,
      `tiene ${cristian3.grupos.length}`,
    );
    const err101act = await mensajeDe(() =>
      admin.mutation("usuarios:actualizar", {
        perfilId: cristian3.id,
        nombre: "Cristian",
        apellidos: "Martínez",
        materia: "Matemáticas",
        grupoIds: [...cristian3.grupos.map((g) => g.id), candidato("B").id],
      }),
    );
    check(
      "⭐ 101 · `usuarios.actualizar` también se RECHAZA — aquí por la cota de " +
        "ENTRADA deduplicada (con reconciliación COMPLETA, |deseados| ES el " +
        "tamaño final; la frontera central queda para el legado saturado)",
      (err101act ?? "").includes("no puede tener más de 100 grupos") ||
        (err101act ?? "").includes("máximo de grupos por instructor (100)"),
      err101act ?? "no lanzó",
    );
    await pageA.close();
    await ctxAdmin.close();
  }

  // ════ §6 · Móvil: drawer <dialog> accesible ════
  console.log("\n6 · Móvil (390×844): drawer modal, foco y teclado");
  {
    const ctxMovil = await navegador.newContext({
      viewport: { width: 390, height: 844 },
    });
    const pgM = await ctxMovil.newPage();
    await login(pgM, CRISTIAN, /\/instructor/);
    const esperaM = poller(pgM);
    const dlg = pgM.getByRole("dialog", { name: "Navegación principal" });
    check(
      "cerrado: el aside de escritorio NO es visible (display:none)",
      !(await pgM.locator("aside").isVisible()),
    );
    check(
      "cerrado: CERO enlaces del sidebar alcanzables",
      (await pgM.locator("aside a:visible").count()) === 0 &&
        (await pgM.locator("dialog[open]").count()) === 0,
    );
    const hamburguesa = pgM.getByRole("button", {
      name: "Abrir menú de navegación",
    });
    await hamburguesa.click();
    await esperaM(async () => (await dlg.count()) === 1);
    check("la hamburguesa abre el dialog «Navegación principal»", true);
    check(
      "el foco ENTRA al dialog al abrir",
      await pgM.evaluate(() => document.activeElement?.closest("dialog") !== null),
    );
    // Escape PRIMERO, en estado limpio: el ciclo de foco de un modal nativo
    // pasa por el chrome del navegador (Tab lo saca del documento) y correrlo
    // antes ensuciaría el punto de retorno del foco.
    await pgM.keyboard.press("Escape");
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 0);
    check(
      "⭐ Escape cierra y el foco REGRESA a la hamburguesa",
      // La restauración es del NAVEGADOR y aterriza un tick después del close:
      // se POLLEA la condición (un one-shot la evaluaba a mitad del aterrizaje).
      await esperaM(
        async () =>
          await pgM.evaluate(
            () =>
              document.activeElement?.getAttribute("aria-label") ===
              "Abrir menú de navegación",
          ),
        5_000,
      ),
      "sin showModal() no hay restauración de foco",
    );
    await hamburguesa.click();
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 1);
    // Lo que el inert GARANTIZA — y lo que se aserta — es que Tab JAMÁS aterriza
    // en un elemento interactivo del FONDO. El salto por el chrome del navegador
    // (activeElement = body) es parte del ciclo normal de un modal nativo.
    let fondoTabulable = false;
    for (let i = 0; i < 10; i++) {
      await pgM.keyboard.press("Tab");
      if (
        await pgM.evaluate(() => {
          const ae = document.activeElement;
          if (!ae || ae === document.body || ae === document.documentElement)
            return false;
          return ae.closest("dialog") === null;
        })
      )
        fondoTabulable = true;
    }
    check(
      "⭐ Tab JAMÁS aterriza en el fondo (inert del modal nativo)",
      !fondoTabulable,
      "un drawer de translate-x deja el fondo tabulable",
    );
    await dlg.getByRole("button", { name: "Cerrar menú de navegación" }).click();
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 0);
    check("la X interna cierra", true);
    await hamburguesa.click();
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 1);
    await pgM.mouse.click(360, 500); // fuera del drawer (w-64 = 256px) = backdrop
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 0);
    check("clic en el backdrop cierra", true);
    await hamburguesa.click();
    await esperaM(async () => (await pgM.locator("dialog[open]").count()) === 1);
    await dlg.getByRole("link", { name: "Banco de reactivos" }).click();
    await pgM.waitForURL(/\/instructor\/reactivos$/, { timeout: 15_000 });
    check(
      "navegar desde el drawer llega al banco Y lo cierra",
      (await pgM.locator("dialog[open]").count()) === 0,
    );
    await pgM.goto(`${BASE}/instructor`);
    check(
      "smoke: el panel renderiza apilado en móvil",
      await esperaM(async () => (await cards(pgM).count()) > 0, 20_000),
    );
    await ctxMovil.close();
  }

  // ════ §7 · Admin no roto (SidebarNav compartido) ════
  console.log("\n7 · El admin conserva su sidebar de escritorio");
  {
    const ctxA2 = await navegador.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pgA = await ctxA2.newPage();
    await login(pgA, ADMIN, /\/admin/);
    await poller(pgA)(async () =>
      ((await pgA.textContent("body")) ?? "").includes("Hola"),
    );
    check("el aside del admin es visible en desktop", await pgA.locator("aside").isVisible());
    check(
      "sin top bar móvil en desktop",
      !(await pgA
        .getByRole("button", { name: "Abrir menú de navegación" })
        .isVisible()),
    );
    await ctxA2.close();
  }
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no controlado: ${e?.stack ?? e}`);
} finally {
  if (navegador) await navegador.close().catch(() => {});
  console.log("\nRestaurando el fixture…");
  // Cada limpieza se intenta INDEPENDIENTEMENTE y su fallo CUENTA como fallo de
  // la suite (hallazgo medio del GO de código: un verde con la pizarra sucia es
  // un falso verde). Orden: primero la limpieza específica de §5c (grupos
  // marcados + uniones — la pizarra NO borra grupos), después la pizarra.
  for (const paso of [
    "seed:limpiarMembresiasParaCota",
    "seed:limpiarContenidoDemo",
    "seed:cargarDatosDePrueba",
    "seedAuth:credencialesDemo",
  ]) {
    try {
      await correrConvex(paso);
    } catch (e) {
      fallos++;
      console.error(`✘ Restauración «${paso}» falló: ${e.message}`);
    }
  }
}

function par2s(par) {
  return `${par.c.titulo} · ${par.b.grupo}`;
}

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
