import { ConvexError, getConvexSize, v } from "convex/values";
import { aTextoPlano, sanear } from "./sanitizar";

/**
 * Material estructurado de un reactivo (LUI-16): las dos listas de una «relación de
 * columnas» o la lista de una pregunta de «ordenamiento». El alumno lo LEE; sigue
 * respondiendo con una opción múltiple normal, así que el motor de calificación no
 * cambia: las opciones son combinaciones («1b, 2c, 3a») o secuencias («3, 2, 1, 4»)
 * escritas como texto.
 *
 * Módulo PURO — sin `ctx`, sin `_generated`, sin DOM — para que corra IGUAL en el runtime
 * V8 de Convex (escritura), en el cliente (importado vía `@/convex/material`) y en
 * `scripts/test-material.ts`. Mismo patrón que `convex/sanitizar.ts` y `convex/politica.ts`.
 *
 * La pureza NO es estética: es lo que hace que la superficie hostil quede **probada** y no
 * solo revisada. `crear`/`actualizar` están tras `requireStaff`, así que `convex run` sin
 * identidad se rechaza ANTES de llegar aquí — una prueba de integración no podría alcanzar
 * estas guardas.
 *
 * ⚠️ La presentación NO es un campo aparte: **ES** este objeto, y se deriva con
 * `material?.tipo ?? "directa"`. Un `presentacion` separado admitiría estados ilegales
 * («columnas» sin material, o «directa» con material zombi de una edición previa).
 */

/** Mínimo de renglones por columna. Con 1 la presentación no significa nada. */
export const MIN_COLUMNA = 2;

/** Mínimo de elementos a ordenar. Con 2 solo hay 2 permutaciones — menos que las 3-4
 *  opciones que exige un reactivo, así que no se puede armar un distractor. */
export const MIN_ELEMENTOS = 3;

/** Máximo de renglones por lista. El Exani II real usa 3-5; 8 deja margen y acota el payload. */
export const MAX_RENGLONES = 8;

/** Tope CRUDO por renglón, en caracteres, ANTES de sanear. Un renglón es una etiqueta corta
 *  («x² + 3x − 2», «Trinomio cuadrado perfecto»), no un párrafo: heredar el `MAX_HTML` de
 *  10 000 del enunciado sería tres órdenes de magnitud de más. */
export const MAX_HTML_RENGLON = 400;

/**
 * Cota AGREGADA del material, en **BYTES**. `MAX_HTML` se aplica por campo, así que con N
 * renglones el payload crecería sin techo.
 *
 * ⚠️ Se mide con `getConvexSize`, NO con `.length`: `.length` cuenta unidades UTF-16 y Convex
 * mide bytes UTF-8. Caso discriminante real: 16 renglones de `"<".repeat(116)+"漢".repeat(284)`
 * saneados dan 11 968 caracteres —que pasarían una cota de 12 288 medida con `.length`— pero
 * pesan 21 138 bytes. Cada `<` sanea a `&lt;` (4 bytes) y cada `漢` ocupa 3 bytes en 1 unidad
 * UTF-16.
 */
export const MAX_MATERIAL_BYTES = 12 * 1024;

export const materialValidator = v.union(
  v.object({
    tipo: v.literal("columnas"),
    columna1: v.array(v.string()), // se etiqueta 1., 2., 3.… al pintar
    columna2: v.array(v.string()), // se etiqueta a., b., c.… al pintar
  }),
  v.object({
    tipo: v.literal("ordenamiento"),
    elementos: v.array(v.string()),
  }),
);

/**
 * Intención de `actualizar` sobre el material. **El argumento AUSENTE significa MANTENER.**
 *
 * ⚠️ NO es un `v.optional(materialValidator)` a secas, y la diferencia no es cosmética: sería
 * una actualización incompatible hacia atrás. `ctx.db.patch` BORRA el campo cuando recibe
 * `undefined`, y `undefined` desaparece al serializar los argumentos, así que un frontend
 * viejo durante la ventana de despliegue (`DEPLOY.md`), una pestaña abierta desde antes o un
 * rollback omitirían el argumento y convertirían un reactivo de columnas en pregunta directa
 * **en silencio**. Misma razón por la que la imagen usa `mantener|quitar|reemplazar`.
 */
export const intencionMaterialValidator = v.union(
  v.object({ op: v.literal("quitar") }),
  v.object({ op: v.literal("reemplazar"), material: materialValidator }),
);

export type MaterialDeReactivo =
  | { tipo: "columnas"; columna1: string[]; columna2: string[] }
  | { tipo: "ordenamiento"; elementos: string[] };

export type IntencionMaterial =
  | { op: "quitar" }
  | { op: "reemplazar"; material: MaterialDeReactivo };

/**
 * Valida y SANEA una lista de renglones. El orden de las comprobaciones es la mitad del
 * diseño: acotar el arreglo ANTES de tocar su contenido evita gastar hasta 8 192 barridos de
 * regex (el máximo de un arreglo de Convex) contra el límite de 1 s de CPU para después
 * rechazar.
 */
function normalizarLista(
  renglones: string[],
  etiqueta: string,
  minimo: number,
): string[] {
  // 1 · Longitud del ARREGLO: acota el trabajo antes de hacerlo.
  if (renglones.length < minimo || renglones.length > MAX_RENGLONES)
    throw new ConvexError(
      `${etiqueta} debe tener entre ${minimo} y ${MAX_RENGLONES} renglones.`,
    );

  const enMinuscula = etiqueta.toLowerCase();
  return renglones.map((crudo, i) => {
    // 2 · Longitud CRUDA, con throw. NO se delega en el truncado de `sanear`, que corta en
    //     silencio a MAX_HTML y puede partir un tag a la mitad (mismo criterio que
    //     `validarContenido` con el enunciado).
    if (crudo.length > MAX_HTML_RENGLON)
      throw new ConvexError(
        `El renglón ${i + 1} de ${enMinuscula} es demasiado largo.`,
      );
    // 3 · Sanear a la whitelist.
    const html = sanear(crudo);
    // 4 · «No vacío» sobre el TEXTO PLANO: un `<p></p>`, puros espacios o puros invisibles
    //     (Cf / Default_Ignorable) no cuentan como contenido.
    if (!aTextoPlano(html).trim())
      throw new ConvexError(
        `El renglón ${i + 1} de ${enMinuscula} no puede estar vacío.`,
      );
    return html;
  });
}

/**
 * Valida y sanea el material completo; devuelve el objeto NORMALIZADO (con cada renglón ya
 * saneado) o lanza `ConvexError` con payload **string** (`mensajeDeError` del formulario hace
 * `String(e.data)`: un payload objeto se vería como «[object Object]»).
 *
 * Las dos columnas PUEDEN tener distinto número de renglones, a propósito: en el Exani II real
 * la columna 2 suele traer distractores, y forzar la igualdad prohibiría un reactivo válido.
 */
export function validarMaterial(material: MaterialDeReactivo): MaterialDeReactivo {
  const normalizado: MaterialDeReactivo =
    material.tipo === "columnas"
      ? {
          tipo: "columnas",
          columna1: normalizarLista(material.columna1, "La columna 1", MIN_COLUMNA),
          columna2: normalizarLista(material.columna2, "La columna 2", MIN_COLUMNA),
        }
      : {
          tipo: "ordenamiento",
          elementos: normalizarLista(
            material.elementos,
            "La lista de elementos",
            MIN_ELEMENTOS,
          ),
        };

  // 5 · Cota agregada en BYTES, al final: es donde ya ocurrió la expansión 4× del escape y
  //     donde cuentan también los arreglos y las claves. Se mide `{ material: … }` —el
  //     fragmento tal como entra al documento— porque la promesa es «LUI-16 aporta ≤12 KiB al
  //     documento», y eso incluye el costo de la clave exterior.
  if (getConvexSize({ material: normalizado }) > MAX_MATERIAL_BYTES)
    throw new ConvexError("El material del reactivo es demasiado largo.");

  return normalizado;
}

/**
 * Re-sanea un material YA almacenado, para la LECTURA (`reactivos.obtener`). Es defensa en
 * profundidad ante un import o una edición manual del dashboard de Convex — el mismo criterio
 * con el que `obtener` re-sanea el enunciado. `sanear` es idempotente, así que no cuesta nada.
 *
 * ⚠️ NO se bifurca por `contenidoFormato`: los renglones son SIEMPRE HTML saneado. Aplicarles
 * `textoPlanoAHtml` haría que un reactivo cambiara la interpretación de su material con solo
 * abrirlo y guardarlo (porque `actualizar` estampa `contenidoFormato:"html"` siempre).
 */
export function sanearMaterial(material: MaterialDeReactivo): MaterialDeReactivo {
  return material.tipo === "columnas"
    ? {
        tipo: "columnas",
        columna1: material.columna1.map(sanear),
        columna2: material.columna2.map(sanear),
      }
    : { tipo: "ordenamiento", elementos: material.elementos.map(sanear) };
}

/**
 * Traduce la intención de `actualizar` al **FRAGMENTO DE PATCH** que el handler esparce:
 *
 * - argumento ausente → `{}`                      la clave NO existe → `patch` no toca el campo
 * - `{ op: "quitar" }` → `{ material: undefined }` la clave existe → `patch` BORRA el campo
 * - `{ op: "reemplazar" }` → `{ material: … }`     valida y normaliza
 *
 * ⚠️ Devuelve el fragmento, y no un `{ escribir, valor }`, **a propósito**: con esa otra forma
 * nada impide escribir el handler como `material: resolucion.valor`, lo que reintroduce el
 * borrado silencioso. Así el handler solo puede esparcirlo. La diferencia entre `{}` y
 * `{ material: undefined }` es invisible con `===` pero decide si el dato sobrevive: se
 * distingue con `Object.hasOwn`.
 *
 * No necesita el material ACTUAL: «mantener» se expresa no escribiendo la clave.
 */
export function resolverIntencionMaterial(
  intencion: IntencionMaterial | undefined,
): { material?: MaterialDeReactivo } {
  if (!intencion) return {};
  if (intencion.op === "quitar") return { material: undefined };
  return { material: validarMaterial(intencion.material) };
}
