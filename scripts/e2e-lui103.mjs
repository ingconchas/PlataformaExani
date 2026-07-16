/**
 * E2E de LUI-103 — invitación y recuperación de acceso (Entregas 1 y 2).
 *
 * Sustituye al `e2e103.js` que vivía en un scratchpad de sesión y se perdió: la
 * verificación de este flujo tiene que ser reproducible por cualquiera, no un
 * recuerdo. Por eso este script se commitea y `playwright` está fijado con versión
 * exacta en `devDependencies`.
 *
 * **Cómo funciona el truco central:** con `CORREO_TRANSPORTE=dev` (el default), el
 * transporte no envía correo — escribe el enlace en los logs de Convex. El script
 * levanta `npx convex logs` y espía ahí el enlace que un usuario recibiría por
 * correo. Así se prueba el flujo completo sin gastar un solo envío real.
 *
 * ── Requisitos ──────────────────────────────────────────────────────────────
 *   1. npm install                       (trae playwright; NO descarga navegadores)
 *   2. npx playwright install chromium   (esto sí descarga el navegador)
 *   3. npx convex dev                    (en otra terminal)
 *   4. npm run dev                       (en otra terminal → http://localhost:3000)
 *   5. Seed demo aplicado.
 *
 * ── Guard de reputación (NO es opcional) ────────────────────────────────────
 * Este script crea alumnos ficticios y dispara correos. Si el deployment tuviera
 * `CORREO_TRANSPORTE=resend` —por ejemplo, porque alguien acaba de hacer una
 * prueba de envío real en dev y no lo regresó a `dev`— saldrían correos REALES
 * hacia direcciones inventadas → **rebotes duros → daño a la reputación de envío**.
 * Eso es exactamente lo que esta entrega existe para evitar, así que el script se
 * niega a correr: verifica el transporte del deployment ANTES de abrir el navegador
 * y aborta si no está en `dev`. No basta con documentarlo.
 *
 * ── Uso ─────────────────────────────────────────────────────────────────────
 *   node scripts/e2e-lui103.mjs
 *   E2E_HEADED=1 node scripts/e2e-lui103.mjs     # ver el navegador
 *
 * Sale con código 1 si alguna comprobación falla o si el guard aborta.
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const HEADED = process.env.E2E_HEADED === "1";
const ADMIN = { correo: "mayra.admin@demo.unx.mx", password: "Demo1234" };
const PASS_FUERTE = "Prueba1234";
const PASS_DEBIL = "abc"; // viola la política: min 8 + mayúscula + número

// Dominio reservado por la RFC 2606: no pertenece a nadie y no acepta correo, así
// que ni siquiera un envío accidental golpearía el dominio de un tercero. Es la
// segunda línea de defensa; la primera es el guard de transporte de abajo.
const sello = Date.now();
const alumnoA = `e2e.a.${sello}@example.com`;
const alumnoB = `e2e.b.${sello}@example.com`;

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

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Guard de reputación: el transporte DEBE estar en dev ────────────────────

/** Corre un comando y devuelve stdout+stderr juntos. */
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

/**
 * Transporte del deployment Convex actual. `null` = la variable no está definida,
 * que es el default seguro (`dev`). Cualquier otra cosa se devuelve tal cual para
 * que el guard decida.
 */
async function transporteDelDeployment() {
  const salida = await ejecutar("npx", ["convex", "env", "get", "CORREO_TRANSPORTE"]);
  if (/not found/i.test(salida)) return null; // ausente ⇒ default dev
  const lineas = salida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/warning|experimental|node:/i.test(l));
  const valor = lineas[lineas.length - 1] ?? "";
  return valor === "" ? null : valor;
}

const transporte = await transporteDelDeployment();
const transporteSeguro = transporte === null || transporte === "dev";

if (!transporteSeguro) {
  if (process.env.E2E_PERMITIR_TRANSPORTE_REAL === "1") {
    console.error(
      "\n" +
        "!".repeat(78) +
        `\n!!  ADVERTENCIA: CORREO_TRANSPORTE="${transporte}" y forzaste el override.` +
        "\n!!  ESTE E2E VA A ENVIAR CORREOS REALES a direcciones @example.com," +
        "\n!!  que NO existen → rebotes duros → daño a la reputación de envío." +
        "\n!!  Cancela con Ctrl+C AHORA si no es exactamente lo que quieres.\n" +
        "!".repeat(78) +
        "\n",
    );
    await dormir(8000);
  } else {
    console.error(
      "\n✘ ABORTADO por el guard de reputación.\n" +
        `\n  El deployment Convex tiene CORREO_TRANSPORTE="${transporte}", no "dev".` +
        "\n  Este script crea alumnos ficticios y dispara correos: con el transporte" +
        "\n  real saldrían correos a direcciones que no existen, y los rebotes duros" +
        "\n  dañan la reputación de envío del dominio.\n" +
        "\n  Arréglalo con:\n" +
        "      npx convex env set CORREO_TRANSPORTE dev\n" +
        "    o npx convex env remove CORREO_TRANSPORTE\n" +
        "\n  (Si de verdad sabes lo que haces: E2E_PERMITIR_TRANSPORTE_REAL=1)\n",
    );
    process.exit(1);
  }
}
console.log(
  `Guard de transporte: ${transporte ?? "sin definir"} → dev · no se enviará correo real`,
);

// ── Espía de los logs de Convex ─────────────────────────────────────────────

const enlaces = [];
const lineasCorreo = [];
const logs = spawn("npx", ["convex", "logs"], { stdio: ["ignore", "pipe", "pipe"] });
for (const flujo of [logs.stdout, logs.stderr]) {
  flujo.on("data", (buf) => {
    const s = buf.toString();
    for (const m of s.matchAll(/Enlace:\s*(https?:\/\/[^\s'"]+)/g)) enlaces.push(m[1]);
    for (const m of s.matchAll(/Asunto:\s*([^·'\\]+)/g)) lineasCorreo.push(m[1].trim());
  });
}

/** Espera un enlace NUEVO (posterior a `desde`). Devuelve null si no llega. */
async function esperarEnlace(desde, timeoutMs = 20_000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (enlaces.length > desde) return enlaces[enlaces.length - 1];
    await dormir(250);
  }
  return null;
}

// ── Helpers de UI ───────────────────────────────────────────────────────────

async function entrar(page, correo, password) {
  await page.goto(`${BASE}/login`);
  await page.fill("#correo", correo);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
}

async function salir(page) {
  const boton = page.getByRole("button", { name: /cerrar sesión/i });
  if (await boton.count()) {
    await boton.first().click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  } else {
    await page.context().clearCookies();
  }
}

/**
 * Desactiva TODO alumno del namespace `e2e.*@example.com` — los de esta corrida y
 * los que dejaron corridas anteriores.
 *
 * Existe porque este script **contaminaba la base que prueba**: creaba alumnos y
 * nunca los limpiaba, así que cualquier métrica de «alumnos activos» (p. ej. el
 * panel de LUI-9) quedaba envenenada y sus pruebas fallaban con el código
 * correcto. Que un script de prueba commiteado ensucie el entorno es un defecto
 * suyo, no una condición del entorno.
 *
 * Se llama DOS veces a propósito: al inicio (barre restos ajenos → el script es
 * auto-reparable, no depende de que el anterior se haya portado bien) y en el
 * `finally` (limpia lo suyo, incluso si falló a media corrida).
 *
 * Va por el CLI y NO por la UI: barrer con Playwright dependía de re-renders,
 * modales y timings — se colgaba 30 s, barría de a uno y perdía la limpieza en
 * silencio. La limpieza de un fixture es una operación de datos, no un flujo de
 * usuario. `seed:limpiarAlumnosE2E` es `internalMutation` (CLI-only, fuera de la
 * API pública) y vive junto al resto del fixture.
 */
async function barrerAlumnosE2E() {
  const salida = await ejecutar("npx", [
    "convex",
    "run",
    "seed:limpiarAlumnosE2E",
  ]);
  const json = salida.match(/\{[\s\S]*\}/);
  if (!json) {
    console.warn(`  ⚠️  el barrido de e2e.* falló: ${salida.slice(0, 120)}`);
    return 0;
  }
  return JSON.parse(json[0]).barridos ?? 0;
}

async function crearAlumno(page, correo, nombre) {
  await page.goto(`${BASE}/admin/alumnos`);
  await page.getByRole("button", { name: "Agregar alumno" }).first().click();
  await page.fill("#alumno-nombre", nombre);
  await page.fill("#alumno-correo", correo);
  const grupo = page.getByLabel("Grupo");
  const opciones = await grupo.locator("option").all();
  // La primera opción es el placeholder; se elige la siguiente que tenga valor.
  for (const o of opciones) {
    const val = await o.getAttribute("value");
    if (val) {
      await grupo.selectOption(val);
      break;
    }
  }
  // Ojo: hay DOS botones «Agregar alumno» (el del encabezado y el del modal). El
  // del modal es el último en el DOM.
  await page.getByRole("button", { name: "Agregar alumno" }).last().click();
  await page.waitForTimeout(1500);
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

const navegador = await chromium.launch({ headless: !HEADED });
const page = await navegador.newPage();

try {
  console.log(`\nE2E LUI-103 · ${BASE}\n`);

  // 1 · Invitación completa
  console.log("1 · Invitación: alta → enlace en logs → contraseña → auto-login");
  await entrar(page, ADMIN.correo, ADMIN.password);
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  check("el admin entra a /admin", page.url().includes("/admin"));

  // Barre restos de corridas anteriores ANTES de empezar: si no, los alumnos
  // e2e.* se acumulan y envenenan las métricas de otras pantallas (LUI-9).
  const previos = await barrerAlumnosE2E();
  if (previos) console.log(`  · barridos ${previos} alumnos e2e.* de corridas previas`);

  const antes = enlaces.length;
  await crearAlumno(page, alumnoA, `E2E Alumno ${sello}`);
  const enlaceInv = await esperarEnlace(antes);
  check("el alta dispara la invitación (enlace en logs)", enlaceInv !== null);
  check(
    "el enlace apunta a /crear-contrasena",
    !!enlaceInv?.includes("/crear-contrasena"),
    enlaceInv ?? "",
  );

  await salir(page);

  // 2 · Token inválido
  console.log("\n2 · Token inválido");
  await page.goto(`${BASE}/crear-contrasena?token=token-que-no-existe`);
  await page.waitForTimeout(2000);
  check(
    "un token inventado se rechaza",
    /no es válido|inválido|expiró|Solicita uno nuevo/i.test(
      await page.textContent("body"),
    ),
  );

  // 3 · Política de contraseña
  console.log("\n3 · Política de contraseña");
  await page.goto(enlaceInv);
  await page.waitForTimeout(1500);
  await page.fill("#password", PASS_DEBIL);
  await page.fill("#confirmar", PASS_DEBIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  check(
    "una contraseña débil NO activa la cuenta",
    !page.url().includes("/inicio"),
    page.url(),
  );

  // 4 · Contraseña válida → auto-login
  console.log("\n4 · Contraseña válida → auto-login por rol");
  await page.fill("#password", PASS_FUERTE);
  await page.fill("#confirmar", PASS_FUERTE);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/inicio/, { timeout: 20_000 }).catch(() => {});
  check("la alumna entra directo a /inicio", page.url().includes("/inicio"), page.url());
  await salir(page);

  // 5 · Reuso del token (uso único)
  console.log("\n5 · Reuso del token");
  await page.goto(enlaceInv);
  await page.waitForTimeout(2000);
  check(
    "el token ya usado se rechaza",
    /ya se usó|ya activaste|no es válido/i.test(await page.textContent("body")),
  );

  // 6 · Login del alumno nuevo
  console.log("\n6 · Login del alumno recién activado");
  await entrar(page, alumnoA, PASS_FUERTE);
  await page.waitForURL(/\/inicio/, { timeout: 15_000 }).catch(() => {});
  check("la alumna inicia sesión con su contraseña", page.url().includes("/inicio"));
  await salir(page);

  // 7 · Recuperación + correo de confirmación
  console.log("\n7 · Recuperación de contraseña + correo de confirmación");
  const antesRec = enlaces.length;
  await page.goto(`${BASE}/recuperar`);
  await page.fill("#correo", alumnoA);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  check(
    "se muestra «Revisa tu correo»",
    /revisa tu correo/i.test(await page.textContent("body")),
  );
  const enlaceRec = await esperarEnlace(antesRec);
  check("llega el enlace de recuperación", enlaceRec !== null);
  check(
    "el enlace apunta a /restablecer",
    !!enlaceRec?.includes("/restablecer"),
    enlaceRec ?? "",
  );

  const asuntosAntes = lineasCorreo.length;
  await page.goto(enlaceRec);
  await page.waitForTimeout(1500);
  const PASS_NUEVA = "Prueba5678";
  await page.fill("#password", PASS_NUEVA);
  await page.fill("#confirmar", PASS_NUEVA);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  check(
    "el correo 3 (confirmación de cambio) se dispara",
    lineasCorreo
      .slice(asuntosAntes)
      .some((a) => /contraseña se actualizó/i.test(a)),
    lineasCorreo.slice(asuntosAntes).join(" | "),
  );
  await salir(page);

  // 8 · No enumeración: correo inexistente
  console.log("\n8 · No enumeración: correo inexistente");
  const antesInex = enlaces.length;
  await page.goto(`${BASE}/recuperar`);
  await page.fill("#correo", `no-existe-${sello}@ejemplo.com`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  check(
    "muestra la MISMA pantalla «Revisa tu correo»",
    /revisa tu correo/i.test(await page.textContent("body")),
  );
  check(
    "y NO se generó ningún enlace",
    enlaces.length === antesInex,
    `enlaces nuevos: ${enlaces.length - antesInex}`,
  );

  // 9 · Reenvío síncrono + rate limiting (Entrega 2)
  console.log("\n9 · Reenvío síncrono y su cuota (Entrega 2)");
  await entrar(page, ADMIN.correo, ADMIN.password);
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  await crearAlumno(page, alumnoB, `E2E Reenvio ${sello}`);
  await page.goto(`${BASE}/admin/alumnos`);
  await page.waitForTimeout(1500);
  await page.getByPlaceholder(/buscar/i).first().fill(alumnoB);
  await page.waitForTimeout(800);

  const btnReenviar = page.getByRole("button", { name: /Reenviar invitación a/i });
  check("el botón de reenvío aparece (acceso pendiente)", (await btnReenviar.count()) > 0);

  // La cubeta `reenvio:perfil` tiene capacidad 2 → el 3er intento debe rechazarse
  // con un mensaje LEGIBLE (no "[object Object]").
  for (let i = 1; i <= 3; i++) {
    await btnReenviar.first().click();
    await page.waitForTimeout(2500);
  }
  const cuerpo = await page.textContent("body");
  check(
    "el 3er reenvío se frena por cuota con mensaje legible",
    /Intenta de nuevo en/i.test(cuerpo),
    cuerpo.slice(0, 200),
  );
  check(
    "el mensaje NO es «[object Object]» (contrato String(e.data))",
    !/\[object Object\]/.test(cuerpo),
  );
} catch (e) {
  fallos++;
  console.error("\n✘ Excepción no controlada:", e);
} finally {
  await navegador.close();
  logs.kill();
  // Limpieza de los alumnos que ESTA corrida creó, aunque haya fallado a media
  // ejecución. Va por CLI, así que no necesita navegador ni sesión.
  const barridos = await barrerAlumnosE2E();
  console.log(`\nLimpieza: ${barridos} alumnos e2e.* desactivados.`);
}

console.log(`\n──────────────\n${ok} pasaron · ${fallos} fallaron\n`);
process.exit(fallos === 0 ? 0 : 1);
