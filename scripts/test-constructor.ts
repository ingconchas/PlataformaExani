/**
 * Prueba del núcleo puro del constructor de examen (LUI-21, Entrega A). Corre con
 * `npm run test:constructor` (tsx).
 *
 * Misma razón de existir que `test-examenes.ts`: **`npx convex run` corre SIN identidad**,
 * así que todo lo que vive tras `requireStaff` se rechaza antes de llegar a la lógica — un
 * falso verde. Lo decidible sin BD se prueba aquí, contra el MISMO código que corre en
 * producción.
 *
 * Nota sobre `publicabilidadDeBloques`: las filas llevan el identificador CRUDO
 * `r.bloque?.lecturaId` (aquí simulado), JAMÁS el `lecturaId` público de
 * `lecturaParaEnlace` — ese se anula justo para la hermana inconsistente y la sacaría de su
 * grupo, desactivando la agregación que la función existe para garantizar.
 */
import { ConvexError } from "convex/values";
import {
  MAX_DURACION_MIN,
  MAX_META,
  MAX_REACTIVOS,
  MAX_SECCIONES,
  publicabilidadDeBloques,
  tipoDeEstructura,
  validarAgrupacion,
  validarEstructura,
  type SeccionDeExamen,
} from "../convex/constructorExamen";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

/** Ejecuta y devuelve el mensaje de la ConvexError, o null si NO lanzó. */
function mensajeDe(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ConvexError ? String(e.data) : `error inesperado: ${e}`;
  }
}

/** Ids tipados para el módulo puro (mismo truco `as never` que test-examenes.ts). */
const sec = (s: string) => s as never;
const seccion = (s: string, meta?: number): SeccionDeExamen =>
  meta === undefined
    ? { seccionId: sec(s) }
    : { seccionId: sec(s), meta };

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · tipoDeEstructura — regla TOTAL, calculada de la estructura declarada");
// ─────────────────────────────────────────────────────────────────────────────

const nucleo = (s: string) => ({ seccionId: sec(s), tipoSeccion: "nucleo" as const });
const modulo = (s: string) => ({ seccionId: sec(s), tipoSeccion: "modulo" as const });

const soloModulo = tipoDeEstructura([modulo("bio")]);
check(
  "UNA sección de módulo → examen de módulo, con SU id",
  soloModulo.clase === "modulo" && soloModulo.seccionId === sec("bio"),
);
check("UNA sección de núcleo → general", tipoDeEstructura([nucleo("pm")]).clase === "general");
// ⭐ DISCRIMINANTE: la implementación tentadora es «contiene algún módulo → módulo». La
// regla es «exactamente UNA sección y es módulo»; una mezcla módulo+núcleo es general.
check(
  "⭐ módulo + núcleo → GENERAL (caza «algún módulo → módulo»)",
  tipoDeEstructura([modulo("bio"), nucleo("pm")]).clase === "general",
);
check(
  "dos módulos → general",
  tipoDeEstructura([modulo("bio"), modulo("fis")]).clase === "general",
);
check("estructura vacía → general", tipoDeEstructura([]).clase === "general");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2 · validarEstructura — cota, duplicados y metas");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "estructura válida (con y sin meta) pasa",
  mensajeDe(() => validarEstructura([seccion("a", 30), seccion("b")])) === null,
);
check(
  "sección DUPLICADA rechazada",
  mensajeDe(() => validarEstructura([seccion("a"), seccion("a")]))?.includes(
    "repite una sección",
  ) === true,
);
for (const mala of [0, -3, 1.5, NaN, MAX_META + 1]) {
  check(
    `meta inválida (${mala}) rechazada`,
    mensajeDe(() => validarEstructura([seccion("a", mala)]))?.includes(
      "entero entre 1",
    ) === true,
  );
}
check(
  "borde: meta === MAX_META pasa",
  mensajeDe(() => validarEstructura([seccion("a", MAX_META)])) === null,
);
const muchas = Array.from({ length: MAX_SECCIONES + 1 }, (_, i) => seccion(`s${i}`));
check(
  `más de MAX_SECCIONES (${MAX_SECCIONES}) rechazado`,
  mensajeDe(() => validarEstructura(muchas))?.includes("secciones") === true,
);
check(
  "borde: exactamente MAX_SECCIONES pasa",
  mensajeDe(() => validarEstructura(muchas.slice(0, MAX_SECCIONES))) === null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3 · validarAgrupacion — rachas contiguas en el orden declarado");
// ─────────────────────────────────────────────────────────────────────────────

// Fixture: r1,r2 ∈ A · r3,r4 ∈ B.
const clasif = new Map<string, string>([
  ["r1", "A"],
  ["r2", "A"],
  ["r3", "B"],
  ["r4", "B"],
]);

check(
  "agrupación conforme (A,A,B,B con orden [A,B]) pasa",
  validarAgrupacion(["r1", "r2", "r3", "r4"], clasif, ["A", "B"]) === null,
);
// ⭐ DISCRIMINANTE: intercalado A,B,A — la sección A tiene DOS rachas. Una validación que
// solo compruebe «cada reactivo pertenece a una sección declarada» lo dejaría pasar.
check(
  "⭐ intercalado (A,B,A) rechazado",
  validarAgrupacion(["r1", "r3", "r2"], clasif, ["A", "B"])?.includes(
    "deben ir juntos",
  ) === true,
);
// ⭐ DISCRIMINANTE: rachas contiguas pero en orden B,A contra el declarado [A,B]. Una
// validación de PURA contigüidad (sin orden) lo dejaría pasar.
check(
  "⭐ rachas fuera de orden (B,B,A,A vs [A,B]) rechazadas",
  validarAgrupacion(["r3", "r4", "r1", "r2"], clasif, ["A", "B"])?.includes(
    "orden de las secciones",
  ) === true,
);
check(
  "reactivo de sección NO declarada rechazado",
  validarAgrupacion(["r1", "r3"], clasif, ["A"])?.includes(
    "no está en su estructura",
  ) === true,
);
check(
  "sección declarada VACÍA es legal (racha vacía)",
  validarAgrupacion(["r1", "r2"], clasif, ["A", "B"]) === null,
);
check(
  "examen vacío es legal (el mínimo de reactivos es frontera de publicar, no de guardar)",
  validarAgrupacion([], clasif, ["A", "B"]) === null,
);
check(
  "id sin clasificación (fantasma) rechazado",
  validarAgrupacion(["r1", "rx"], clasif, ["A", "B"])?.includes(
    "ya no existe",
  ) === true,
);
check(
  "reactivo repetido rechazado",
  validarAgrupacion(["r1", "r1"], clasif, ["A"])?.includes("repetido") === true,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4 · publicabilidadDeBloques — veredicto AGREGADO por bloque");
// ─────────────────────────────────────────────────────────────────────────────

// ⭐ El caso obligado por auditoría, en UNA MISMA llamada: un bloque SANO (L1) y otro con
// UNA hermana inconsistente (L2). Discrimina en las dos direcciones: el cálculo POR FILA
// dejaría publicable a la hermana sana de L2; la SOBRECORRECCIÓN («un bloque dañado apaga
// todos») tumbaría también a L1.
// La hermana dañada va PRIMERO a propósito: así un cálculo por fila (último-escribe)
// termina en `true` para L2 y esta aserción lo caza; con la dañada al final coincidiría
// con el veredicto correcto por accidente.
const veredicto = publicabilidadDeBloques(
  [
    { bloqueLecturaId: "L1", consistente: true },
    { bloqueLecturaId: "L1", consistente: true },
    { bloqueLecturaId: "L2", consistente: false }, // la hermana dañada, primero
    { bloqueLecturaId: "L2", consistente: true },
    { bloqueLecturaId: null, consistente: true }, // reactivo suelto: no participa
  ],
  new Map([
    ["L1", { existe: true, publicable: true }],
    ["L2", { existe: true, publicable: true }],
  ]),
);
check("⭐ bloque sano → publicable (aun junto a uno dañado)", veredicto.get("L1") === true);
check(
  "⭐ UNA hermana inconsistente → TODAS las hermanas del bloque no publicables",
  veredicto.get("L2") === false,
  "un cálculo por fila dejaría true a la hermana sana y el modal ofrecería un bloque parcial",
);
check("las filas sueltas no entran al veredicto", !veredicto.has("null") && veredicto.size === 2);

check(
  "lectura INEXISTENTE → bloque no publicable",
  publicabilidadDeBloques(
    [{ bloqueLecturaId: "Lx", consistente: true }],
    new Map(),
  ).get("Lx") === false,
);
check(
  "lectura existente pero NO publicable → bloque no publicable",
  publicabilidadDeBloques(
    [{ bloqueLecturaId: "L3", consistente: true }],
    new Map([["L3", { existe: true, publicable: false }]]),
  ).get("L3") === false,
);
check(
  "el orden de las hermanas no importa (dañada al final)",
  publicabilidadDeBloques(
    [
      { bloqueLecturaId: "L4", consistente: true },
      { bloqueLecturaId: "L4", consistente: false },
    ],
    new Map([["L4", { existe: true, publicable: true }]]),
  ).get("L4") === false,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5 · Cotas exportadas — sanidad");
// ─────────────────────────────────────────────────────────────────────────────

check("MAX_META no supera MAX_REACTIVOS (una meta mayor sería inalcanzable)", MAX_META <= MAX_REACTIVOS);
check("MAX_DURACION_MIN es positiva", MAX_DURACION_MIN > 0);

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
