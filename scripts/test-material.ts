/**
 * Prueba del material de columnas/ordenamiento (LUI-16). Corre con `npm run test:material`
 * (tsx → sin depender del type-stripping de Node).
 *
 * Es la prueba que cubre TODA la superficie hostil del material, y existe porque
 * `convex/material.ts` es un módulo PURO: `crear`/`actualizar` están tras `requireStaff`, así
 * que `npx convex run` sin identidad se rechaza ANTES de llegar a estas guardas — una prueba
 * de integración no podría alcanzarlas, y el formulario nunca envía las combinaciones
 * ilegales. Aquí se llama el MISMO código que corre producción, no un duplicado.
 */
import { getConvexSize } from "convex/values";
import {
  MAX_HTML_RENGLON,
  MAX_MATERIAL_BYTES,
  MAX_RENGLONES,
  MIN_COLUMNA,
  MIN_ELEMENTOS,
  resolverIntencionMaterial,
  sanearMaterial,
  validarMaterial,
  type MaterialDeReactivo,
} from "../convex/material";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

/** ¿`validarMaterial` rechazó? Devuelve el mensaje, o null si NO lanzó. */
function rechazo(material: MaterialDeReactivo): string | null {
  try {
    validarMaterial(material);
    return null;
  } catch (e) {
    // ConvexError lleva payload STRING a propósito: `mensajeDeError` del formulario hace
    // `String(e.data)`, así que un payload objeto se vería como «[object Object]».
    const data = (e as { data?: unknown }).data;
    check(`payload string: ${String(data).slice(0, 40)}`, typeof data === "string");
    return String(data);
  }
}

const cols = (c1: string[], c2: string[]): MaterialDeReactivo => ({
  tipo: "columnas",
  columna1: c1,
  columna2: c2,
});
const orden = (elementos: string[]): MaterialDeReactivo => ({
  tipo: "ordenamiento",
  elementos,
});
const relleno = (n: number) => Array.from({ length: n }, (_, i) => `renglón ${i + 1}`);

console.log("1 · Cotas de longitud por lista");
check("columnas mínimas pasan", rechazo(cols(relleno(2), relleno(2))) === null);
check("columna de 1 renglón se rechaza", rechazo(cols(relleno(1), relleno(2))) !== null);
check(
  "la SEGUNDA columna también se valida",
  rechazo(cols(relleno(2), relleno(1))) !== null,
);
check(
  `más de ${MAX_RENGLONES} renglones se rechaza`,
  rechazo(cols(relleno(MAX_RENGLONES + 1), relleno(2))) !== null,
);
check(`${MAX_RENGLONES} renglones pasan`, rechazo(cols(relleno(MAX_RENGLONES), relleno(2))) === null);
check(
  `ordenamiento con ${MIN_ELEMENTOS - 1} elementos se rechaza`,
  rechazo(orden(relleno(MIN_ELEMENTOS - 1))) !== null,
);
check(`ordenamiento con ${MIN_ELEMENTOS} elementos pasa`, rechazo(orden(relleno(MIN_ELEMENTOS))) === null);
// DECISIÓN DE PRODUCTO: en el Exani II real la columna 2 trae distractores, así que
// forzar la igualdad prohibiría un reactivo válido.
check(
  "columnas de DISTINTO largo pasan (columna 2 con distractores)",
  rechazo(cols(relleno(3), relleno(5))) === null,
);
check(`mínimo por columna = ${MIN_COLUMNA}`, MIN_COLUMNA === 2);

console.log("2 · Renglones vacíos e invisibles");
const ZWSP = String.fromCodePoint(0x200b);
const WJ = String.fromCodePoint(0x2060);
const VS16 = String.fromCodePoint(0xfe0f); // Default_Ignorable que NO es Cf
check("renglón vacío se rechaza", rechazo(cols(["a", ""], relleno(2))) !== null);
check("renglón de solo espacios se rechaza", rechazo(cols(["a", "   "], relleno(2))) !== null);
check("renglón `<p></p>` se rechaza", rechazo(cols(["a", "<p></p>"], relleno(2))) !== null);
check(
  "renglón de solo INVISIBLES se rechaza (Cf + Default_Ignorable)",
  rechazo(cols(["a", `${ZWSP}${WJ}${VS16}`], relleno(2))) !== null,
);

console.log("3 · Saneo del contenido de cada renglón");
const saneado = validarMaterial(cols(["<script>alert(1)</script>x", "<strong>b</strong>"], relleno(2)));
const c1 = saneado.tipo === "columnas" ? saneado.columna1 : [];
check("el `<script>` queda escapado", c1[0].includes("&lt;script&gt;") && !c1[0].includes("<script"));
check("el `<strong>` de la whitelist sobrevive", c1[1] === "<strong>b</strong>");
check(
  "sanearMaterial es idempotente sobre material ya saneado",
  JSON.stringify(sanearMaterial(saneado)) === JSON.stringify(saneado),
);
check(
  "validarMaterial es idempotente",
  JSON.stringify(validarMaterial(saneado)) === JSON.stringify(saneado),
);

console.log("4 · Cota CRUDA por renglón y límite de arreglo");
check(
  `renglón de ${MAX_HTML_RENGLON} caracteres pasa`,
  rechazo(cols(["a".repeat(MAX_HTML_RENGLON), "b"], relleno(2))) === null,
);
check(
  `renglón de ${MAX_HTML_RENGLON + 1} caracteres se rechaza`,
  rechazo(cols(["a".repeat(MAX_HTML_RENGLON + 1), "b"], relleno(2))) !== null,
);
// La longitud del ARREGLO se comprueba PRIMERO: si no, serían hasta 8 192 barridos de
// regex contra el límite de 1 s de CPU para acabar rechazando igual.
//
// El ORDEN se demuestra con el MENSAJE, no con un cronómetro (un umbral de reloj de pared
// es inestable en CI congestionado): estos renglones violan AMBAS reglas a la vez —son
// 8 193 y cada uno excede `MAX_HTML_RENGLON`—, así que el mensaje dice cuál corrió antes.
const ambasReglas = cols(
  Array.from({ length: 8193 }, () => "x".repeat(MAX_HTML_RENGLON + 1)),
  relleno(2),
);
const mensajeOrden = rechazo(ambasReglas);
check("8 193 renglones se rechazan", mensajeOrden !== null);
check(
  "…por LONGITUD DEL ARREGLO, no por renglón ⇒ el conteo corre ANTES de sanear",
  mensajeOrden?.includes("renglones.") === true && !mensajeOrden?.includes("El renglón"),
  `mensaje: «${mensajeOrden}»`,
);

console.log("5 · ⭐ Cota agregada en BYTES (vector discriminante)");
// Este vector es el ÚNICO que distingue una implementación correcta de una que mida con
// `.length`: cada `<` sanea a `&lt;` (4 caracteres, 4 bytes) y cada `漢` ocupa 1 unidad
// UTF-16 pero 3 BYTES en UTF-8. Un vector de 16×400 `<` sería inútil: da 25 600 caracteres,
// así que una cota en `.length` también lo rechazaría y la prueba pasaría en verde sin
// demostrar nada.
const CRUDO = "<".repeat(116) + "漢".repeat(284); // 400 caracteres crudos, justo en la cota
const filas = Array.from({ length: 8 }, () => CRUDO);
const vector = cols(filas, filas);
const filaSaneada = "&lt;".repeat(116) + "漢".repeat(284);
const caracteres = filaSaneada.length * 16;
const bytes = getConvexSize({
  material: { tipo: "columnas", columna1: Array.from({ length: 8 }, () => filaSaneada), columna2: Array.from({ length: 8 }, () => filaSaneada) },
});
check(`cada renglón crudo mide ${MAX_HTML_RENGLON} caracteres`, CRUDO.length === MAX_HTML_RENGLON);
check(
  `(1) saneado agregado = ${caracteres} caracteres, POR DEBAJO de la cota ${MAX_MATERIAL_BYTES}`,
  caracteres < MAX_MATERIAL_BYTES,
  "una implementación con .length lo dejaría pasar",
);
check(
  `(2) getConvexSize({material}) = ${bytes} bytes, POR ENCIMA de la cota ${MAX_MATERIAL_BYTES}`,
  bytes > MAX_MATERIAL_BYTES,
);
check("(3) validarMaterial lo RECHAZA", rechazo(vector) !== null);
// Multibyte puro: la medida en bytes debe superar a la de caracteres.
const acentos = orden(Array.from({ length: 5 }, () => "√ áéíóú ≤ ≠ 漢".repeat(20)));
const normalizadoAcentos = validarMaterial(acentos);
check(
  "en contenido multibyte, los bytes superan a los caracteres",
  getConvexSize({ material: normalizadoAcentos }) >
    JSON.stringify(normalizadoAcentos).length,
);

console.log("6 · ⭐ resolverIntencionMaterial (fragmento de patch)");
// La diferencia entre `{}` y `{ material: undefined }` es INVISIBLE con `===` pero decide
// si el dato sobrevive: `patch` solo borra el campo si la CLAVE está presente.
const fragAusente = resolverIntencionMaterial(undefined);
const fragQuitar = resolverIntencionMaterial({ op: "quitar" });
const fragReemplazar = resolverIntencionMaterial({
  op: "reemplazar",
  material: cols(relleno(2), relleno(2)),
});
check(
  "AUSENTE ⇒ la clave `material` NO existe (mantener)",
  !Object.hasOwn(fragAusente, "material"),
  JSON.stringify(fragAusente),
);
check("AUSENTE ⇒ fragmento vacío", Object.keys(fragAusente).length === 0);
check(
  "quitar ⇒ la clave SÍ existe (para que el patch borre)",
  Object.hasOwn(fragQuitar, "material"),
);
check("quitar ⇒ el valor es undefined", fragQuitar.material === undefined);
check(
  "reemplazar ⇒ material normalizado",
  fragReemplazar.material?.tipo === "columnas",
);
check("reemplazar VALIDA el material", (() => {
  try {
    resolverIntencionMaterial({ op: "reemplazar", material: cols(relleno(1), relleno(2)) });
    return false;
  } catch {
    return true;
  }
})());

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
