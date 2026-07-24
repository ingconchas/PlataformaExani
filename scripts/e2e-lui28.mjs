/**
 * E2E del paquete META Y RESULTADOS — LUI-36 «Meta y Perfil de la alumna» ·
 * LUI-28 «Resultados del simulacro» (parcial: sin las CTAs a LUI-29/LUI-34).
 *
 * Corre con `npm run e2e:lui28`. Requisitos: `npx convex dev` + `npm run dev`.
 *
 * ⚠️ Usa la MISMA base de dev que las demás suites: NUNCA correr dos a la vez. Es
 * idempotente (dos corridas seguidas dan el mismo resultado): el `finally` borra lo que
 * sembró y devuelve el fixture con la pizarra, y cada limpieza se intenta por SEPARADO
 * sumando fallos si falla — un verde con la pizarra sucia sería un falso verde para la
 * siguiente suite.
 *
 * Lo DISCRIMINANTE (⭐ = demostrada en ROJO antes del GO):
 *  · §1 el estado SIN FILA es real y alcanzable (Ana): «Define tu meta», y Resultados sin
 *    marcador de barra pero CON la invitación a ponerla.
 *  · §2/§3 ⭐ upsert por FRAGMENTO en los DOS órdenes desde cero: la segunda escritura no
 *    borra lo que puso la primera, y queda UNA sola fila.
 *  · §4 ⭐⭐ dos PRIMERAS escrituras CONCURRENTES dejan exactamente UNA fila — la unicidad
 *    por `userId` la sostiene la disciplina sonda+insert, no el índice (que no es constraint).
 *  · §5 ⭐ el desglose de la pantalla sale del ORÁCULO del seed (recalculado a mano) y es
 *    IDÉNTICO al que ve el instructor para el mismo intento.
 *  · §6 ⭐ borde del umbral: 59 % marca «A estudiar», 60 % EXACTO no. ⭐ invariante de
 *    redondeo: 1149.6 se muestra 1150 = la meta ⇒ ALCANZADA y SIN «A N puntos». Y un intento
 *    DIRECTO no ofrece repaso.
 *  · §7 ⭐⭐ cruce VIVO de `cierraEn`: la CTA de repaso desaparece sola, sin recargar y sin
 *    provocar otra escritura, y la mutation sigue rechazando fuera de ventana.
 *  · §8 ⭐ frontera de módulos por sus bordes: 30 pasa, 31 rechaza, reactivar al límite
 *    rechaza, reactivar uno ya activo es no-op, y dos escrituras concurrentes dejan ≤30.
 *  · §9 ⭐ un módulo elegido que se DESACTIVA o se BORRA se CUENTA, no desaparece en silencio.
 *  · §10 ⭐⭐ authz: anónimo, staff y otra alumna no tocan el perfil académico; y no existe
 *    parámetro por el que nombrar un perfil ajeno.
 *  · §11 ⭐⭐ «Cerrar sesión» solo confirma el cierre con el 200 del proxy: éxito ⇒ navega y
 *    la cookie se BORRA; abort/5xx/cuelgue —incluso con `/inicio` fail-closeando a /login—
 *    ⇒ avisa, se queda y la cookie SIGUE viva. Y sigue presente aun con la query en error.
 *  · §12 ⭐ editar la meta mueve la barra de Resultados SIN recargar (dos pestañas).
 *
 * Lo que esta suite NO puede probar (revisión de código): el paro por bytes del catálogo de
 * clasificaciones (`CATALOGO_CLASIF_BYTES`) y el techo de 500 clasificaciones distintas —
 * sus bordes exactos viven en `test:resultados`; y las fronteras puras de texto y redondeo,
 * que están en `test:meta`.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const PASSWORD = "Demo1234";
const ADMIN = "mayra.admin@demo.unx.mx";
const DIANA = "diana.instructor@demo.unx.mx";
const FERNANDA = "fernanda.alumna@demo.unx.mx";
const ANA = "ana.lopez@correo.com";

const META_FERNANDA = 1150;
const MAX_MODULOS_ACTIVOS = 30;
const BIOLOGIA = "Módulo Biología 1"; // publicado y asignable por API (1 sola pregunta)

const SEG = 1000;
const MIN = 60 * SEG;
/** Ventana del testigo de cruce: `MIN_VIGENCIA_RESTANTE_MS` son 60 s, así que 100 s deja
 *  margen para iniciar y enviar por HTTP y aun así cruzar dentro de la prueba. */
const VENTANA_CRUCE_MS = 100 * SEG;

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
    console.error("✘ No hay NEXT_PUBLIC_CONVEX_URL (ni en el proceso ni en .env.local).");
    process.exit(1);
  }
  return url;
}
const CONVEX_URL = urlConvexEfectiva();
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
function jsonDe(salida) {
  const m = salida.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Salida sin JSON: ${salida.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

async function login(pg, correo, urlRe) {
  await pg.goto(`${BASE}/login`);
  await pg.fill("#correo", correo);
  await pg.fill("#password", PASSWORD);
  await pg.click('button[type="submit"]');
  await pg.waitForURL(urlRe, { timeout: 20_000 });
}
async function tokenDe(pg) {
  const token = await pg.evaluate((k) => localStorage.getItem(k), CLAVE_JWT);
  if (!token) throw new Error("No hay JWT en localStorage (clave namespaced).");
  return token;
}
function clienteConvex(token) {
  const c = new ConvexHttpClient(CONVEX_URL);
  if (token) c.setAuth(token);
  return c;
}
/** ¿La llamada RECHAZÓ? Devuelve el mensaje, o null si pasó (el caso que debe fallar). */
async function rechazo(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e?.data ?? e?.message ?? e);
  }
}
async function espera(cond, ms = 15_000, paso = 200) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await new Promise((r) => setTimeout(r, paso));
  }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** `cierraEn` de la asignación que siembra §7. El `finally` la borra por esta llave exacta. */
let cierreSembrado = null;
/** Inventario de línea base. Declarado FUERA del `try`: un `const` dentro no sería visible
 *  en el `finally` (bloques hermanos) y la comprobación final reventaría por referencia. */
let inventarioAntes = null;

/** Réplica INDEPENDIENTE del umbral de refuerzo (0.6, estricto). Duplicada a propósito: si
 *  importara la constante de producción, un cambio de signo pasaría desapercibido. */
const reforzarEsperado = (aciertos, total) => (total > 0 ? aciertos / total : 0) < 0.6;
/** Réplica del único redondeo del sistema. */
const mostrado = (crudo) => Math.round(crudo);

const navegador = await chromium.launch({ headless: !HEADED });
/** Contextos abiertos, para cerrarlos todos en el `finally`. */
const contextos = [];

/**
 * UNA sesión = UN contexto de navegador. No es ceremonia: el JWT de Convex Auth vive en
 * `localStorage`, que es por ORIGEN, así que dos logins en el mismo contexto se pisan y el
 * segundo se queda sin token (mismo patrón que `e2e:lui30`).
 */
async function abrirSesion(correo, urlRe, viewport = { width: 390, height: 844 }) {
  const ctx = await navegador.newContext({ viewport });
  contextos.push(ctx);
  const pg = await ctx.newPage();
  await login(pg, correo, urlRe);
  return { ctx, pg, convex: clienteConvex(await tokenDe(pg)) };
}

try {
  // ── §0 · Pizarra y oráculo ────────────────────────────────────────────────
  console.log("\n0 · Pizarra y oráculo del fixture");
  const oraculo = jsonDe(await correrConvex("seed:cargarDatosDePrueba"));
  // Inventario de LÍNEA BASE: el `finally` compara contra él. Verificar solo «Ana volvió a
  // cero» dejaba fuera lo que de verdad se acumulaba entre corridas (asignaciones e intentos
  // de §7, que `asignar` inserta siempre nuevos porque NO es idempotente).
  inventarioAntes = jsonDe(await correrConvex("seed:inventarioLui28"));
  const oraFer = oraculo.resultadoAlumnaEsperado[FERNANDA];
  const oraAna = oraculo.resultadoAlumnaEsperado[ANA];
  check("el oráculo trae la meta de Fernanda", oraFer.meta === META_FERNANDA, String(oraFer.meta));
  check("…y Ana NO tiene meta (estado sin fila)", oraAna.meta === null);
  check(
    "…y Fernanda tiene intentos enviados con desglose",
    oraFer.intentos.length > 0 && oraFer.intentos.every((i) => !i.sinDesglose),
  );

  // ── §1 · Estado SIN FILA (Ana) ────────────────────────────────────────────
  console.log("\n1 · Perfil y Resultados SIN meta (estado alcanzable)");
  const sesAna = await abrirSesion(ANA, /\/(inicio|examenes)/);
  const pgAna = sesAna.pg;
  await pgAna.goto(`${BASE}/perfil`);
  await pgAna.waitForSelector("[data-perfil]", { timeout: 20_000 });
  check(
    "⭐ sin fila, la CTA dice «Define tu meta», no «Editar meta»",
    (await pgAna.locator("[data-editar-meta]").innerText()).trim() === "Define tu meta",
  );
  check(
    "…y no se pinta ningún puntaje objetivo",
    (await pgAna.locator("[data-meta-puntaje]").count()) === 0,
  );

  const intentoAna = oraAna.intentos.find((i) => !i.sinDesglose) ?? oraAna.intentos[0];
  if (intentoAna) {
    await pgAna.goto(`${BASE}/examenes/${intentoAna.intentoId}/resultado`);
    await pgAna.waitForSelector("[data-tarjeta-puntaje]", { timeout: 20_000 });
    check(
      "⭐ Resultados SIN meta: no hay marcador de barra…",
      (await pgAna.locator("[data-meta-marcador]").count()) === 0,
    );
    check(
      "…ni delta, pero SÍ la invitación a poner la meta",
      (await pgAna.locator("[data-delta-meta]").count()) === 0 &&
        (await pgAna.locator("[data-sin-meta]").count()) === 1,
    );
    check(
      "…y el puntaje se muestra igual (la meta no condiciona la calificación)",
      (await pgAna.locator("[data-resultado-puntaje]").innerText()).trim() ===
        String(intentoAna.puntajeMostrado),
    );
  }
  const convexAna = sesAna.convex;

  // ── §2/§3 · Upsert por fragmento en AMBOS órdenes, desde cero ─────────────
  console.log("\n2 · Captura desde cero — orden meta → módulos");
  await correrConvex("seed:borrarPerfilAlumnaLui28", {
    confirmar: "SOLO_DEV",
    correo: ANA,
  });
  const catalogoAna = await convexAna.query("temario:modulosParaAlumna", {});
  check(
    "el catálogo de módulos llega completo a la alumna",
    catalogoAna.catalogoIncompleto === false && catalogoAna.modulos.length >= 1,
  );
  await convexAna.mutation("perfilAlumna:guardarMeta", {
    institucion: "Universidad de Prueba",
    carrera: "Enfermería",
    puntaje: 1147,
  });
  let crudo = jsonDe(
    await correrConvex("seed:perfilAlumnaCrudoLui28", {
      confirmar: "SOLO_DEV",
      correo: ANA,
    }),
  );
  check(
    "guardarMeta INSERTA con modulosIds vacío (no ausente)",
    crudo.filas === 1 && crudo.fila.metaPuntaje === 1147 && crudo.fila.modulos === 0,
  );
  check(
    "⭐ 1147 se acepta aunque no sea múltiplo de 10 (el paso es del slider)",
    crudo.fila.metaPuntaje === 1147,
  );
  await convexAna.mutation("perfilAlumna:guardarModulos", {
    modulosIds: [catalogoAna.modulos[0].id],
  });
  crudo = jsonDe(
    await correrConvex("seed:perfilAlumnaCrudoLui28", {
      confirmar: "SOLO_DEV",
      correo: ANA,
    }),
  );
  check(
    "⭐ guardarModulos NO borra la tripleta que puso guardarMeta",
    crudo.filas === 1 &&
      crudo.fila.metaPuntaje === 1147 &&
      crudo.fila.carreraObjetivo === "Enfermería" &&
      crudo.fila.modulos === 1,
  );

  console.log("\n3 · Captura desde cero — orden módulos → meta");
  await correrConvex("seed:borrarPerfilAlumnaLui28", {
    confirmar: "SOLO_DEV",
    correo: ANA,
  });
  await convexAna.mutation("perfilAlumna:guardarModulos", {
    modulosIds: [catalogoAna.modulos[0].id],
  });
  crudo = jsonDe(
    await correrConvex("seed:perfilAlumnaCrudoLui28", {
      confirmar: "SOLO_DEV",
      correo: ANA,
    }),
  );
  check(
    "⭐ guardarModulos INSERTA sin tripleta (estado 2: módulos sin meta)",
    crudo.filas === 1 && crudo.fila.metaPuntaje === null && crudo.fila.modulos === 1,
  );
  check(
    "…y la query lo reporta como «sin meta», no como error",
    (await convexAna.query("perfilAlumna:mio", {})).meta === null,
  );
  await convexAna.mutation("perfilAlumna:guardarMeta", {
    institucion: "Universidad de Prueba",
    carrera: "Enfermería",
    puntaje: 1200,
  });
  crudo = jsonDe(
    await correrConvex("seed:perfilAlumnaCrudoLui28", {
      confirmar: "SOLO_DEV",
      correo: ANA,
    }),
  );
  check(
    "⭐ guardarMeta NO borra los módulos que puso guardarModulos",
    crudo.filas === 1 && crudo.fila.metaPuntaje === 1200 && crudo.fila.modulos === 1,
  );
  const vacio = await rechazo(() =>
    convexAna.mutation("perfilAlumna:guardarMeta", {
      institucion: "   ",
      carrera: "Enfermería",
      puntaje: 1200,
    }),
  );
  check("institución vacía se rechaza con su copy", vacio?.includes("institución") === true, String(vacio));
  const fuera = await rechazo(() =>
    convexAna.mutation("perfilAlumna:guardarMeta", {
      institucion: "U",
      carrera: "C",
      puntaje: 1301,
    }),
  );
  check("puntaje fuera de rango se rechaza", fuera !== null, String(fuera));

  // ── §4 · Concurrencia de las PRIMERAS escrituras ──────────────────────────
  console.log("\n4 · Dos primeras escrituras concurrentes");
  await correrConvex("seed:borrarPerfilAlumnaLui28", {
    confirmar: "SOLO_DEV",
    correo: ANA,
  });
  await Promise.all([
    convexAna.mutation("perfilAlumna:guardarMeta", {
      institucion: "A",
      carrera: "B",
      puntaje: 1000,
    }),
    convexAna.mutation("perfilAlumna:guardarModulos", {
      modulosIds: [catalogoAna.modulos[0].id],
    }),
  ]);
  crudo = jsonDe(
    await correrConvex("seed:perfilAlumnaCrudoLui28", {
      confirmar: "SOLO_DEV",
      correo: ANA,
    }),
  );
  check(
    "⭐⭐ dos inserciones simultáneas dejan UNA sola fila (la unicidad la sostiene " +
      "sonda+insert en la transacción, no el índice)",
    crudo.filas === 1,
    `filas=${crudo.filas}`,
  );
  check(
    "…y ninguno de los dos fragmentos se perdió",
    crudo.fila.metaPuntaje === 1000 && crudo.fila.modulos === 1,
  );

  // ── §5 · Resultados de Fernanda contra el oráculo + paridad ───────────────
  console.log("\n5 · Resultados con desglose y paridad con el instructor");
  const convexAdminPrevio = (await abrirSesion(ADMIN, /\/admin/, { width: 1440, height: 900 }))
    .convex;
  const sesFer = await abrirSesion(FERNANDA, /\/(inicio|examenes)/);
  const pgFer = sesFer.pg;
  const convexFer = sesFer.convex;

  const conDesglose = oraFer.intentos.find((i) => i.porArea.length >= 2);
  await pgFer.goto(`${BASE}/examenes/${conDesglose.intentoId}/resultado`);
  await pgFer.waitForSelector("[data-tarjeta-puntaje]", { timeout: 20_000 });

  check(
    "el puntaje mostrado es el REDONDEADO del oráculo",
    (await pgFer.locator("[data-resultado-puntaje]").innerText()).trim() ===
      String(conDesglose.puntajeMostrado),
  );
  const cmp = mostrado(conDesglose.puntajeCrudo);
  if (cmp < META_FERNANDA) {
    check(
      "⭐ el delta es meta − puntaje MOSTRADO, con su singular/plural",
      (await pgFer.locator("[data-delta-meta]").innerText()).includes(
        `${META_FERNANDA - cmp} ${META_FERNANDA - cmp === 1 ? "punto" : "puntos"}`,
      ),
    );
    check(
      "…y la barra trae marcador de meta",
      (await pgFer.locator("[data-meta-marcador]").count()) === 1,
    );
  }

  for (const s of conDesglose.porSeccion) {
    const fila = pgFer.locator(`[data-seccion="${s.nombre}"]`);
    check(
      `sección «${s.nombre}» muestra ${s.aciertos} de ${s.total}`,
      (await fila.count()) === 1 && (await fila.innerText()).includes(`${s.aciertos} de ${s.total}`),
    );
  }

  // Paridad: el MISMO intento visto por el instructor. Se compara el porcentaje del área.
  const convexDiana = (await abrirSesion(DIANA, /\/instructor/, { width: 1440, height: 900 }))
    .convex;
  // PARIDAD REAL: se consulta la superficie del INSTRUCTOR (`resultadosExamen:intentosDe`,
  // la Q3 de LUI-30) para la MISMA asignación y se compara, área por área, contra lo que la
  // alumna recibe derivado. La versión anterior de este testigo solo comparaba el oráculo
  // consigo mismo: una divergencia de integración entre ambas superficies habría pasado.
  const resFer = await convexFer.query("player:resultado", {
    intentoId: conDesglose.intentoId,
  });
  // Se consulta con la ADMIN (la gemela admin de LUI-30 usa la MISMA query): una instructora
  // solo está autorizada en los grupos que imparte, y el grupo de Fernanda puede no ser suyo.
  const q3 = await convexAdminPrevio.query("resultadosExamen:intentosDe", {
    asignacionId: resFer.asignacionId,
  });
  check("la Q3 del instructor responde sin problema", q3 !== null && q3.problema === null);
  const alumnaUserId = (
    await convexAdminPrevio.query("alumnos:listar", {})
  ).find((u) => u.correo === FERNANDA)?.userId;
  const suyoEnInstructor =
    q3?.diagnosticos.find((d) => d.alumnoId === alumnaUserId) ?? null;
  check("⭐ el intento de Fernanda aparece en la lectura del instructor", suyoEnInstructor !== null);

  if (suyoEnInstructor) {
    const nombrePorArea = new Map(q3.catalogo.areas.map((a) => [a.areaId, a.nombre]));
    // Lo que la alumna VE, ya derivado por la función compartida.
    const areasAlumna = new Map(
      resFer.desglose.acordeon
        .flatMap((sec) => sec.areas)
        .map((a) => [a.areaId, a]),
    );
    let paridad = 0;
    let divergencias = [];
    for (const c of suyoEnInstructor.aciertosPorArea ?? []) {
      const vistaAlumna = areasAlumna.get(c.areaId);
      const nombreInstructor = nombrePorArea.get(c.areaId) ?? null;
      const igual =
        vistaAlumna !== undefined &&
        vistaAlumna.aciertos === c.aciertos &&
        vistaAlumna.total === c.total &&
        vistaAlumna.nombre === nombreInstructor &&
        vistaAlumna.reforzar === reforzarEsperado(c.aciertos, c.total);
      if (igual) paridad++;
      else divergencias.push(nombreInstructor ?? c.areaId);
    }
    check(
      `⭐⭐ PARIDAD: las ${paridad} áreas del intento coinciden en nombre, conteos y bandera ` +
        "entre lo que ve la alumna y lo que lee el instructor",
      divergencias.length === 0 && paridad > 0,
      `divergencias: ${divergencias.join(", ") || "ninguna"} · áreas=${paridad}`,
    );
  }

  const areaOraculo = conDesglose.porArea.find((a) => a.total > 0);
  check(
    "…y el oráculo del seed (recalculado a mano) coincide con esa misma cifra",
    areaOraculo.pct === Math.round((areaOraculo.aciertos / areaOraculo.total) * 100) &&
      areaOraculo.reforzar === reforzarEsperado(areaOraculo.aciertos, areaOraculo.total),
  );

  // ── §6 · Bordes sembrados: umbral y redondeo ──────────────────────────────
  console.log("\n6 · Borde del umbral, invariante de redondeo e intento directo");
  const bordes = jsonDe(await correrConvex("seed:sembrarBordesLui28"));
  await pgFer.goto(`${BASE}/examenes/${bordes.intentoId}/resultado`);
  await pgFer.waitForSelector("[data-tarjeta-puntaje]", { timeout: 20_000 });

  check(
    "⭐ 1149.6 crudo se MUESTRA como 1150 (el único redondeo del sistema)",
    (await pgFer.locator("[data-resultado-puntaje]").innerText()).trim() === "1150",
  );
  check(
    "⭐ …y como 1150 = su meta, se marca ALCANZADA",
    (await pgFer.locator("[data-badge-meta]").count()) === 1,
  );
  check(
    "⭐ …con «¡Alcanzaste tu meta!» (empatar no es superar)",
    (await pgFer.locator("[data-badge-meta]").innerText())
      .toLocaleLowerCase("es")
      .includes("alcanzaste"),
    await pgFer.locator("[data-badge-meta]").innerText(),
  );
  check(
    "⭐⭐ …y SIN «A N puntos»: comparar contra el crudo diría «A 1 punto» bajo un 1150",
    (await pgFer.locator("[data-delta-meta]").count()) === 0,
  );

  // Abrir TODAS las secciones del acordeón para poder ver las áreas.
  const cabeceras = pgFer.locator("[data-acordeon-seccion] button");
  for (let i = 0; i < (await cabeceras.count()); i++) {
    const b = cabeceras.nth(i);
    if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
  }
  const areaAlg = pgFer.locator('[data-area="Álgebra"]');
  const areaCel = pgFer.locator('[data-area="Célula"]');
  check(
    "⭐ 59 % SÍ se marca «A estudiar»",
    (await areaAlg.locator("[data-badge-estudiar]").count()) === 1,
  );
  check(
    "⭐⭐ 60 % EXACTO NO se marca (la comparación es estricta)",
    (await areaCel.count()) === 1 &&
      (await areaCel.locator("[data-badge-estudiar]").count()) === 0,
  );
  check(
    "…y los conteos crudos viajan sin convertirse en porcentaje",
    (await areaAlg.locator("[data-area-conteo]").innerText()).includes("59 de 100") &&
      (await areaCel.locator("[data-area-conteo]").innerText()).includes("6 de 10"),
  );
  check(
    "⭐ un intento DIRECTO (sin asignación) NO ofrece repaso",
    (await pgFer.locator('[data-cta="repetir-repaso"]').count()) === 0 &&
      (await pgFer.locator('[data-cta="continuar-repaso"]').count()) === 0,
  );

  // ── §7 · Cruce VIVO del cierre de ventana ─────────────────────────────────
  console.log("\n7 · La CTA de repaso desaparece al cruzar `cierraEn`, sin recargar");
  const convexAdmin = convexAdminPrevio;
  const examenes = await convexAdmin.query("examenes:listar", {});
  const bioId = examenes.find((e) => e.titulo === BIOLOGIA)?.id ?? null;
  const alumnas = await convexAdmin.query("alumnos:listar", {});
  const ferFila = alumnas.find((u) => u.correo === FERNANDA) ?? null;

  check("precondición del cruce: existen el examen asignable y la alumna", !!bioId && !!ferFila);
  if (bioId && ferFila) {
    const abre = Date.now() - MIN;
    const cierra = Date.now() + VENTANA_CRUCE_MS;
    cierreSembrado = cierra;
    await convexAdmin.mutation("asignaciones:asignar", {
      examenId: bioId,
      destino: { tipo: "alumnos", alumnoIds: [ferFila.userId] },
      abreEn: abre,
      cierraEn: cierra,
    });
    const mis = await convexFer.query("player:misExamenes", {});
    const fila = mis.filas.find((f) => f.titulo === BIOLOGIA && f.cierraEn === cierra);
    const { intentoId } = await convexFer.mutation("player:iniciarIntento", {
      asignacionId: fila.asignacionId,
    });
    await convexFer.mutation("player:enviar", { intentoId });

    await pgFer.goto(`${BASE}/examenes/${intentoId}/resultado`);
    await pgFer.waitForSelector("[data-tarjeta-puntaje]", { timeout: 20_000 });
    // ANTI-VACUIDAD: si la CTA no estuviera visible AHORA, su desaparición no probaría nada.
    check(
      "anti-vacuidad: con la ventana ABIERTA la CTA de repaso está visible",
      (await pgFer.locator('[data-cta="repetir-repaso"]').count()) === 1,
    );
    check(
      "…y el cierre que la pantalla ancló es el de la asignación",
      (await pgFer.locator("[data-resultado]").getAttribute("data-cierra-en")) ===
        String(cierra),
    );
    const faltan = cierra - Date.now();
    console.log(`    (esperando ${Math.ceil(faltan / 1000)} s al cierre, sin recargar…)`);
    await dormir(Math.max(0, faltan) + 2 * SEG);
    check(
      "⭐⭐ la CTA DESAPARECE sola al cruzar el cierre (timer a la frontera; Convex no " +
        "re-invalida una query por el paso del tiempo)",
      await espera(
        async () => (await pgFer.locator('[data-cta="repetir-repaso"]').count()) === 0,
        15_000,
      ),
    );
    const traRechazo = await rechazo(() =>
      convexFer.mutation("player:iniciarIntento", { asignacionId: fila.asignacionId }),
    );
    check(
      "⭐ …y el servidor sigue rechazando el repaso fuera de ventana",
      traRechazo !== null,
      String(traRechazo),
    );
  }

  // ── §8 · Frontera de módulos activos por sus bordes ───────────────────────
  console.log("\n8 · Frontera de módulos activos (29 → 30 → 31)");
  await correrConvex("seed:sembrarModulosLui28", {
    confirmar: "SOLO_DEV",
    objetivo: MAX_MODULOS_ACTIVOS - 1,
  });
  let conteo = jsonDe(await correrConvex("seed:contarModulosActivosLui28"));
  check(`precondición: ${MAX_MODULOS_ACTIVOS - 1} módulos activos`, conteo.activos === MAX_MODULOS_ACTIVOS - 1);

  const creado30 = await rechazo(() =>
    convexAdmin.mutation("temario:crear", {
      tipo: "modulo",
      nombre: "[E2E LUI-28] Módulo 30",
    }),
  );
  check("⭐ el módulo 30 SÍ entra (la frontera no se adelanta)", creado30 === null, String(creado30));
  const creado31 = await rechazo(() =>
    convexAdmin.mutation("temario:crear", {
      tipo: "modulo",
      nombre: "[E2E LUI-28] Módulo 31",
    }),
  );
  check("⭐⭐ el 31 se RECHAZA con el copy del techo", creado31?.includes("30") === true, String(creado31));
  conteo = jsonDe(await correrConvex("seed:contarModulosActivosLui28"));
  check("…y el estado final queda EXACTAMENTE en el techo", conteo.activos === MAX_MODULOS_ACTIVOS);

  // Desactivar uno y reactivarlo al límite: la reactivación también consume cupo.
  const arbol = await convexAdmin.query("temario:listarArbol", {});
  const marcado = arbol.find(
    (f) => f.nivel === 1 && String(f.nombre).startsWith("[E2E LUI-28]"),
  );
  // La precondición se EXIGE, no se salta: un `if (marcado)` sin `else` convertiría un
  // selector roto en cuatro pruebas que nunca corren y una suite verde que no probó nada.
  check("precondición: existe un módulo marcado para desactivar", marcado !== undefined);
  if (marcado) {
    await convexAdmin.mutation("temario:cambiarEstado", {
      nivel: "seccion",
      id: marcado.id,
      activo: false,
    });
    await convexAdmin.mutation("temario:crear", {
      tipo: "modulo",
      nombre: "[E2E LUI-28] Relleno",
    });
    const reactivar = await rechazo(() =>
      convexAdmin.mutation("temario:cambiarEstado", {
        nivel: "seccion",
        id: marcado.id,
        activo: true,
      }),
    );
    check(
      "⭐ reactivar al límite RECHAZA (la reactivación también consume cupo)",
      reactivar?.includes("30") === true,
      String(reactivar),
    );
    const noOp = await rechazo(() =>
      convexAdmin.mutation("temario:cambiarEstado", {
        nivel: "seccion",
        id: marcado.id,
        activo: false,
      }),
    );
    check(
      "⭐ «desactivar» uno ya inactivo es NO-OP: no rechaza ni consume cupo",
      noOp === null,
      String(noOp),
    );
    conteo = jsonDe(await correrConvex("seed:contarModulosActivosLui28"));
    check("…y el conteo no se movió", conteo.activos === MAX_MODULOS_ACTIVOS);
  }

  // Concurrencia contra la frontera: dos altas simultáneas con UN solo hueco.
  await correrConvex("seed:limpiarModulosLui28");
  await correrConvex("seed:sembrarModulosLui28", {
    confirmar: "SOLO_DEV",
    objetivo: MAX_MODULOS_ACTIVOS - 1,
  });
  const dos = await Promise.allSettled([
    convexAdmin.mutation("temario:crear", { tipo: "modulo", nombre: "[E2E LUI-28] Carrera A" }),
    convexAdmin.mutation("temario:crear", { tipo: "modulo", nombre: "[E2E LUI-28] Carrera B" }),
  ]);
  conteo = jsonDe(await correrConvex("seed:contarModulosActivosLui28"));
  check(
    "⭐⭐ dos altas concurrentes con UN hueco dejan el estado final en ≤30 (la " +
      "serialización de Convex hace reintentar a una y el reintento vuelve a contar)",
    conteo.activos <= MAX_MODULOS_ACTIVOS,
    `activos=${conteo.activos} · resultados=${dos.map((d) => d.status).join(",")}`,
  );

  // ── §9 · Módulos que dejan de estar disponibles ───────────────────────────
  console.log("\n9 · Un módulo elegido que se retira se CUENTA, no desaparece");
  await correrConvex("seed:limpiarModulosLui28");
  const catFer = await convexFer.query("temario:modulosParaAlumna", {});
  const modA = catFer.modulos[0];
  await convexFer.mutation("perfilAlumna:guardarModulos", { modulosIds: [modA.id] });
  const arbol2 = await convexAdmin.query("temario:listarArbol", {});
  const filaModA = arbol2.find((f) => f.nivel === 1 && f.nombre === modA.nombre);
  check("precondición: el módulo elegido existe en el temario", filaModA !== undefined);
  await convexAdmin.mutation("temario:cambiarEstado", {
    nivel: "seccion",
    id: filaModA.id,
    activo: false,
  });
  const perfilTrasRetiro = await convexFer.query("perfilAlumna:mio", {});
  check(
    "⭐ un módulo DESACTIVADO se reporta como no disponible…",
    perfilTrasRetiro.modulosNoDisponibles === 1,
    `no disponibles=${perfilTrasRetiro.modulosNoDisponibles}`,
  );
  check(
    "…y no se cuela en la lista de módulos vigentes",
    perfilTrasRetiro.modulos.length === 0,
  );
  await pgFer.goto(`${BASE}/perfil`);
  await pgFer.waitForSelector("[data-card-modulos]", { timeout: 20_000 });
  check(
    "…y la pantalla lo DICE antes de que vuelva a guardar",
    await espera(
      async () => (await pgFer.locator("[data-modulos-no-disponibles]").count()) === 1,
      15_000,
    ),
  );
  const guardarRetirado = await rechazo(() =>
    convexFer.mutation("perfilAlumna:guardarModulos", { modulosIds: [modA.id] }),
  );
  check(
    "⭐ y guardar un módulo retirado se RECHAZA (no entra por la puerta de atrás)",
    guardarRetirado !== null,
    String(guardarRetirado),
  );
  await convexAdmin.mutation("temario:cambiarEstado", {
    nivel: "seccion",
    id: filaModA.id,
    activo: true,
  });

  // ── §10 · Authz negativa ──────────────────────────────────────────────────
  console.log("\n10 · Authz del perfil académico");
  const anonimo = clienteConvex(null);
  check(
    "⭐ anónimo no lee el perfil académico",
    (await rechazo(() => anonimo.query("perfilAlumna:mio", {}))) !== null,
  );
  check(
    "⭐ anónimo no escribe la meta",
    (await rechazo(() =>
      anonimo.mutation("perfilAlumna:guardarMeta", {
        institucion: "X",
        carrera: "Y",
        puntaje: 1000,
      }),
    )) !== null,
  );
  check(
    "⭐ anónimo no lee el catálogo de módulos de la alumna",
    (await rechazo(() => anonimo.query("temario:modulosParaAlumna", {}))) !== null,
  );
  check(
    "⭐⭐ el STAFF tampoco: el perfil académico es del portal de la alumna",
    (await rechazo(() => convexAdmin.query("perfilAlumna:mio", {}))) !== null,
  );
  check(
    "⭐ …ni el instructor",
    (await rechazo(() => convexDiana.query("perfilAlumna:mio", {}))) !== null,
  );
  const mioFer = await convexFer.query("perfilAlumna:mio", {});
  const mioAna = await convexAna.query("perfilAlumna:mio", {});
  check(
    "⭐⭐ cada alumna solo puede obtener el SUYO: no hay parámetro por el que nombrar otro",
    mioFer.correo === FERNANDA && mioAna.correo === ANA,
  );
  check(
    "⭐ un intento AJENO responde null (cero oráculo de existencia)",
    (await convexAna.query("player:resultado", { intentoId: conDesglose.intentoId })) === null,
  );
  const payload = JSON.stringify(
    await convexFer.query("player:resultado", { intentoId: conDesglose.intentoId }),
  );
  check(
    "⭐⭐ el payload de Resultados NO trae respuestas correctas ni retroalimentación",
    !payload.includes("opcionCorrecta") &&
      !payload.includes("retroalimentacion") &&
      !payload.includes('"correcta"'),
  );

  // ── §11 · Cerrar sesión sobrevive al fallo de la query ────────────────────
  console.log("\n11 · «Cerrar sesión» con la query del perfil en ERROR");
  // El fallo que se prueba es el DISEÑADO, no una caída de red: `metaAlumna.metaDe` LANZA
  // ante una tripleta parcial, así que `perfilAlumna.mio` revienta y el boundary del segmento
  // toma el control — con la conexión sana, que es lo que permite verificar que el cierre de
  // sesión de verdad funciona (matar el WebSocket rompería también `signOut` y la prueba
  // mediría otra cosa). El estado se fabrica con un helper porque el producto no puede
  // producirlo: ninguna mutation escribe media tripleta.
  await correrConvex("seed:sembrarTripletaParcialLui28", {
    confirmar: "SOLO_DEV",
    correo: ANA,
  });
  const sesRota = await abrirSesion(ANA, /\/(inicio|examenes)/);
  const pgRoto = sesRota.pg;
  const mioRoto = await rechazo(() => sesRota.convex.query("perfilAlumna:mio", {}));
  check(
    "⭐ una tripleta PARCIAL hace fallar la query en vez de degradar a «sin meta»",
    mioRoto !== null,
    String(mioRoto),
  );
  await pgRoto.goto(`${BASE}/perfil`);
  const hayError = await espera(
    async () => (await pgRoto.locator("[data-perfil-error]").count()) === 1,
    20_000,
  );
  check("⭐ …y la pantalla cae en su boundary, no en blanco", hayError);
  const hayBoton = await espera(
    async () => (await pgRoto.locator("[data-cerrar-sesion]").count()) >= 1,
    20_000,
  );
  check(
    "⭐ con la query en error, «Cerrar sesión» sigue presente (única salida de la app)",
    hayBoton,
  );
  if (hayBoton) {
    await pgRoto.locator("[data-cerrar-sesion]").first().click();
    check(
      "⭐⭐ …y funciona: la sesión se cierra y aterriza en /login",
      await espera(async () => /\/login/.test(pgRoto.url()), 20_000),
      pgRoto.url(),
    );
  }

  await pgRoto.close();

  // ⭐⭐ El fallo del transporte, en sus formas: cuelgue, abort inmediato, 5xx, y —el caso
  // que motivó el 3er NO-GO— 5xx CON la validación de una ruta protegida TAMBIÉN caída. La
  // credencial vive en cookies HttpOnly (`__convexAuthJWT`/`RefreshToken`), que ningún
  // cliente puede borrar si `/api/auth` no completa `setAuthCookies(null)` en el proxy — y
  // `signOut()` traga esos errores y resuelve igual. La CONFIRMACIÓN es el 200 del proxy,
  // NADA MÁS: en todas estas formas no hay 200 ⇒ debe AVISAR, quedarse en /perfil, conservar
  // la cookie y NO fingir un cierre.
  //
  // El último caso es el discriminante del 3er dictamen: se fuerza que `/inicio` redirija a
  // `/login` (como haría el middleware al fail-closear con el backend caído) MIENTRAS la
  // cookie sigue viva. Una implementación que sondeara `/inicio` leería `/login` y fingiría
  // el cierre; la que exige el 200 del proxy no cae — jamás sondea `/inicio`.
  const fallosTransporte = [
    ["cuelgue (nunca responde)", () => {}, null],
    ["abort inmediato", (r) => r.abort(), null],
    ["5xx del endpoint", (r) => r.fulfill({ status: 500, body: "boom" }), null],
    [
      "5xx + /inicio fail-close a /login (cookie viva)",
      (r) => r.fulfill({ status: 500, body: "boom" }),
      (r) => r.fulfill({ status: 307, headers: { location: "/login" }, body: "" }),
    ],
  ];
  for (const [nombre, handler, handlerInicio] of fallosTransporte) {
    const ses = await abrirSesion(FERNANDA, /\/(inicio|examenes)/);
    const pg = ses.pg;
    await pg.route("**/api/auth", handler);
    if (handlerInicio) await pg.route(`${BASE}/inicio`, handlerInicio);
    await pg.goto(`${BASE}/perfil`);
    await pg.waitForSelector("[data-cerrar-sesion]", { timeout: 20_000 });
    await pg.locator("[data-cerrar-sesion]").click();
    check(
      `⭐⭐ [${nombre}] AVISA que la sesión sigue abierta`,
      await espera(
        async () => (await pg.locator("[data-cierre-atascado]").count()) === 1,
        20_000,
      ),
    );
    check(
      `⭐⭐ [${nombre}] NO navega a /login (un cierre que miente es peor que uno que falla)`,
      /\/perfil/.test(pg.url()),
      pg.url(),
    );
    // La prueba de fondo: la cookie —la credencial real— SIGUE presente en el navegador.
    const cookies = (await ses.ctx.cookies()).map((c) => c.name);
    check(
      `⭐⭐ [${nombre}] la cookie de sesión SIGUE viva (no hubo falso cierre)`,
      cookies.includes("__convexAuthJWT"),
      cookies.join(",") || "(ninguna)",
    );
    // El aviso es una región viva para lectores de pantalla.
    check(
      `[${nombre}] el aviso es una región viva (role=alert)`,
      (await pg.locator('[data-cierre-atascado][role="alert"]').count()) === 1,
    );
    await pg.close();
  }

  // ⭐ Y el CAMINO EXITOSO con red sana: el POST de signOut devuelve 200, se navega de verdad
  // a /login y la cookie queda BORRADA (evidencia inequívoca del cierre, no aparente).
  const sesOk = await abrirSesion(FERNANDA, /\/(inicio|examenes)/);
  await sesOk.pg.goto(`${BASE}/perfil`);
  await sesOk.pg.waitForSelector("[data-cerrar-sesion]", { timeout: 20_000 });
  await sesOk.pg.locator("[data-cerrar-sesion]").click();
  check(
    "⭐ camino exitoso: se navega a /login…",
    await espera(async () => /\/login/.test(sesOk.pg.url()), 20_000),
    sesOk.pg.url(),
  );
  check(
    "⭐⭐ …y la cookie de sesión quedó BORRADA (cierre real, no aparente)",
    !(await sesOk.ctx.cookies()).some((c) => c.name === "__convexAuthJWT"),
  );
  await sesOk.pg.close();

  // ⭐⭐⭐ DOS PESTAÑAS (4º dictamen): el JWT de acceso vive TAMBIÉN en `localStorage`, y una
  // pestaña hermana que lo conserve seguiría autenticada aunque las cookies ya no existan (las
  // guardas usan `getAuthUserId`+perfil, no consultan `authSessions` por operación). El cierre
  // debe borrar ese token de forma DETERMINISTA y propagarlo. Se prueba con la hidratación de
  // /login BLOQUEADA, para que sea el propio cierre —no /login— quien limpie el token.
  {
    const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
    contextos.push(ctx);
    const A = await ctx.newPage();
    await login(A, FERNANDA, /\/(inicio|examenes)/);
    const B = await ctx.newPage(); // hermana: misma cookie y mismo localStorage
    // La hermana en /perfil con su query protegida VIVA: muestra la meta (1150). Es la señal
    // de que su cliente Convex CARGADO está autenticado y corriendo `perfilAlumna:mio`.
    await B.goto(`${BASE}/perfil`);
    await B.waitForSelector("[data-meta-puntaje]", { timeout: 20_000 });
    const jwtB = await B.evaluate((k) => localStorage.getItem(k), CLAVE_JWT);
    check("dos pestañas: la hermana tiene el JWT antes del cierre", !!jwtB);
    check(
      "⭐ dos pestañas: su cliente CARGADO corre la query protegida (muestra la meta)",
      (await B.locator("[data-meta-puntaje]").innerText()).trim() === String(META_FERNANDA),
    );

    // /login BLOQUEADO: su hidratación en la pestaña A NO puede ser la que limpie el token
    // compartido — así el borrado en la hermana solo puede venir del `limpiarTokenLocal` del
    // cierre. Es justo el escenario del dictamen: «A se cierra o no alcanza a hidratar /login».
    await ctx.route("**/login", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>bloqueado</body></html>" }),
    );
    await A.goto(`${BASE}/perfil`);
    await A.waitForSelector("[data-cerrar-sesion]", { timeout: 20_000 });
    await A.locator("[data-cerrar-sesion]").click();

    check(
      "⭐⭐ dos pestañas: tras el cierre la hermana YA NO tiene el JWT (borrado determinista, propagado por el evento storage — no por la hidratación de /login, que está bloqueada)",
      await espera(
        async () => (await B.evaluate((k) => localStorage.getItem(k), CLAVE_JWT)) === null,
        20_000,
      ),
    );
    // La prueba que pedía el dictamen: NO basta con el localStorage. El CLIENTE Convex CARGADO
    // de la hermana perdió la autenticación (listener de `storage` → `setToken(null)` →
    // `clearAuth()`): su query protegida `perfilAlumna:mio` deja de devolver datos y la meta
    // DESAPARECE de una pantalla que NO navegó. Sin el borrado del token no habría evento
    // storage y la meta SEGUIRÍA ahí — por eso esta aserción discrimina el arreglo (comprobado
    // en rojo), mientras que una segunda lectura del localStorage no lo haría.
    check(
      "⭐⭐⭐ dos pestañas: el cliente CARGADO de la hermana quedó sin auth — su query protegida ya NO devuelve datos (la meta desaparece sin recargar)",
      await espera(
        async () => (await B.locator("[data-meta-puntaje]").count()) === 0,
        20_000,
      ),
    );
    check(
      "…y las cookies también quedaron borradas",
      !(await ctx.cookies()).some((c) => c.name === "__convexAuthJWT"),
    );
    await A.close();
    await B.close();
  }

  // ⭐ Recuperación de contraseña: NO afirma el envío antes de que el servidor responda. Con
  // la red caída debe DECIR que no se pudo (recuperable), no fingir el envío ni dejar un
  // rechazo sin capturar. El servidor sigue siendo silencioso (anti-oráculo): el mensaje de
  // éxito jamás confirma si el correo existe.
  {
    const ses = await abrirSesion(FERNANDA, /\/(inicio|examenes)/);
    const pg = ses.pg;
    await pg.goto(`${BASE}/perfil`);
    await pg.waitForSelector("[data-card-cuenta]", { timeout: 20_000 });
    // OFFLINE corta el WebSocket ya abierto (una `route` no lo toca). La mutation de Convex
    // no rechaza: se encola y reintenta, así que el acierto es que la UI NUNCA afirme el
    // envío y, por el plazo, ofrezca reintentar.
    await ses.ctx.setOffline(true);
    await pg.locator("[data-cambiar-contrasena]").click();
    // Durante el vuelo dice «Enviando…», JAMÁS «te enviamos un enlace».
    check(
      "⭐ con la red caída NUNCA afirma el envío (el estado optimista mentía)",
      !(await espera(async () => {
        const txt = (await pg.locator("[data-aviso-contrasena]").innerText()).trim();
        return /te enviamos un enlace/i.test(txt);
      }, 3_000)),
    );
    check(
      "⭐ …y por el plazo termina diciendo «no pudimos confirmar» (recuperable, no cuelga; el copy NO afirma que no se envió, porque la mutation puede correr al volver la red)",
      await espera(async () => {
        const txt = (await pg.locator("[data-aviso-contrasena]").innerText()).trim();
        return /no pudimos confirmar/i.test(txt);
      }, 20_000),
    );
    check(
      "…y el botón vuelve a estar disponible para reintentar",
      !(await pg.locator("[data-cambiar-contrasena]").isDisabled()),
    );
    await ses.ctx.setOffline(false);
    await pg.close();
  }

  // ── §12 · Editar la meta mueve la barra SIN recargar ─────────────────────
  console.log("\n12 · La meta editada se refleja en Resultados sin recargar");
  const pgRes = (await abrirSesion(FERNANDA, /\/(inicio|examenes)/)).pg;
  const conBarra = oraFer.intentos.find(
    (i) => !i.sinDesglose && mostrado(i.puntajeCrudo) < META_FERNANDA,
  );
  if (conBarra) {
    await pgRes.goto(`${BASE}/examenes/${conBarra.intentoId}/resultado`);
    await pgRes.waitForSelector("[data-delta-meta]", { timeout: 20_000 });
    const antes = (await pgRes.locator("[data-delta-meta]").innerText()).trim();
    const nuevaMeta = mostrado(conBarra.puntajeCrudo) + 7;
    await convexFer.mutation("perfilAlumna:guardarMeta", {
      institucion: "Universidad de Guadalajara (UDG)",
      carrera: "Medicina",
      puntaje: nuevaMeta,
    });
    check(
      "⭐ el delta cambia solo, sin recargar (la meta vive en su propia query reactiva)",
      await espera(async () => {
        const t = (await pgRes.locator("[data-delta-meta]").innerText()).trim();
        return t !== antes && t.includes("7 puntos");
      }, 15_000),
    );
  }
  const pgPerfil = pgRes;
  await pgPerfil.goto(`${BASE}/perfil`);
  await pgPerfil.waitForSelector("[data-card-meta]", { timeout: 20_000 });
  await pgPerfil.locator("[data-editar-meta]").click();
  await pgPerfil.waitForSelector("[data-hoja-meta]", { timeout: 10_000 });
  check(
    "la hoja abre como modal nativo (top layer, fondo inerte, Escape)",
    await pgPerfil.locator("[data-hoja-meta]").evaluate((d) => d.open === true),
  );
  // ⭐ ESCRITURA REAL, tecla por tecla: la versión anterior del campo acotaba en cada
  // pulsación y hacía IMPOSIBLE teclear 1147 (los estados «1», «11», «114» saltaban a 700).
  const campo = pgPerfil.locator("[data-meta-numero]");
  await campo.click();
  await campo.press("ControlOrMeta+a");
  await campo.press("Backspace");
  check(
    "⭐ vaciar el campo NO salta a 700: queda vacío y avisa",
    (await campo.inputValue()) === "" &&
      (await pgPerfil.locator("[data-meta-error]").count()) === 1,
    `valor=«${await campo.inputValue()}»`,
  );
  check(
    "…y con el borrador inválido, «Guardar cambios» está DESHABILITADO",
    await pgPerfil.locator("[data-guardar-meta]").isDisabled(),
  );
  await campo.pressSequentially("1147", { delay: 30 });
  check(
    "⭐⭐ se puede teclear 1147 dígito a dígito (no múltiplo de 10)",
    (await campo.inputValue()) === "1147",
    `valor=«${await campo.inputValue()}»`,
  );
  check(
    "…y el guardado se rehabilita",
    !(await pgPerfil.locator("[data-guardar-meta]").isDisabled()),
  );
  // Bordes del rango: 699 y 1301 se RECHAZAN con mensaje, no se corrigen en silencio.
  for (const [valor, valido] of [["699", false], ["700", true], ["1300", true], ["1301", false]]) {
    await campo.press("ControlOrMeta+a");
    await campo.pressSequentially(valor, { delay: 10 });
    const hayError = (await pgPerfil.locator("[data-meta-error]").count()) === 1;
    check(
      `⭐ ${valor} ${valido ? "se acepta" : "se rechaza CON mensaje (sin corregir en silencio)"}`,
      (await campo.inputValue()) === valor && hayError === !valido,
      `valor=«${await campo.inputValue()}» error=${hayError}`,
    );
  }
  await campo.press("ControlOrMeta+a");
  await campo.pressSequentially(String(META_FERNANDA), { delay: 10 });
  await pgPerfil.locator("[data-guardar-meta]").click();
  check(
    "⭐ guardar cierra la hoja y anuncia con toast FUERA de ella",
    await espera(
      async () =>
        (await pgPerfil.locator("[data-hoja-meta]").count()) === 0 &&
        (await pgPerfil.locator('[role="status"]').count()) === 1,
      15_000,
    ),
  );
  check(
    "…y la card muestra la meta nueva",
    await espera(
      async () =>
        (await pgPerfil.locator("[data-meta-puntaje]").innerText()).trim() ===
        String(META_FERNANDA),
      10_000,
    ),
  );
  const escape = await pgPerfil.locator("[data-editar-meta]").click();
  void escape;
  await pgPerfil.waitForSelector("[data-hoja-meta]", { timeout: 10_000 });
  await pgPerfil.keyboard.press("Escape");
  check(
    "⭐ Escape cierra la hoja (modal nativo, sin reimplementar)",
    await espera(async () => (await pgPerfil.locator("[data-hoja-meta]").count()) === 0, 8_000),
  );
} catch (e) {
  fallos++;
  console.error(`\n✘ Error no capturado: ${e?.stack ?? e}`);
} finally {
  // ── Limpieza: cada paso por SEPARADO, sumando fallos si falla ─────────────
  console.log("\nRestaurando el fixture…");
  for (const [etiqueta, fn, args] of [
    ["intento directo sembrado", "seed:limpiarBordesLui28", { confirmar: "SOLO_DEV" }],
    ["módulos marcados", "seed:limpiarModulosLui28", { confirmar: "SOLO_DEV" }],
    ...(cierreSembrado === null
      ? []
      : [
          [
            "asignación e intento de §7",
            "seed:limpiarAsignacionLui28",
            { confirmar: "SOLO_DEV", examenTitulo: BIOLOGIA, cierraEn: cierreSembrado },
          ],
        ]),
    ["fixture (pizarra)", "seed:cargarDatosDePrueba", { confirmar: "SOLO_DEV" }],
  ]) {
    try {
      await correrConvex(fn, args);
      console.log(`  · ${etiqueta}: ok`);
    } catch (e) {
      fallos++;
      console.error(`  ✘ limpieza «${etiqueta}»: ${e?.message ?? e}`);
    }
  }
  try {
    const fin = jsonDe(
      await correrConvex("seed:perfilAlumnaCrudoLui28", {
        confirmar: "SOLO_DEV",
        correo: ANA,
      }),
    );
    check("⭐ el fixture vuelve a su línea base: Ana SIN fila", fin.filas === 0);
    const finFer = jsonDe(
      await correrConvex("seed:perfilAlumnaCrudoLui28", {
        confirmar: "SOLO_DEV",
        correo: FERNANDA,
      }),
    );
    check(
      "…y Fernanda con su meta original (1150) y sus 2 módulos",
      finFer.filas === 1 && finFer.fila.metaPuntaje === META_FERNANDA && finFer.fila.modulos === 2,
      JSON.stringify(finFer),
    );
    const mods = jsonDe(await correrConvex("seed:contarModulosActivosLui28"));
    check("…y el catálogo de módulos vuelve a 2 activos", mods.activos === 2, `activos=${mods.activos}`);
    const inventarioDespues = jsonDe(await correrConvex("seed:inventarioLui28"));
    const difs = Object.keys(inventarioAntes ?? {}).filter(
      (k) => inventarioAntes[k] !== inventarioDespues[k],
    );
    check(
      "⭐⭐ INVENTARIO: todas las tablas vuelven EXACTO a la línea base (nada se acumula)",
      difs.length === 0,
      difs.map((k) => `${k}: ${inventarioAntes[k]} → ${inventarioDespues[k]}`).join(" · "),
    );
  } catch (e) {
    fallos++;
    console.error(`  ✘ verificación de línea base: ${e?.message ?? e}`);
  }
  for (const c of contextos) await c.close().catch(() => {});
  await navegador.close();
  console.log("\n──────────────");
  console.log(`${ok} pruebas OK, ${fallos} fallos`);
  process.exit(fallos === 0 ? 0 : 1);
}
