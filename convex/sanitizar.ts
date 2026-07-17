/**
 * Saneo del contenido enriquecido de reactivos (LUI-15 E2). Módulo PURO — sin DOM ni
 * librerías — para que corra IGUAL en el runtime V8 de Convex (escritura) y en el
 * cliente (importado vía `@/convex/sanitizar`; mismo patrón que `convex/politica.ts`).
 *
 * ⚠️⚠️ CONTRATO DE SEGURIDAD de `sanear`: su salida es segura EXCLUSIVAMENTE como
 * CONTENIDO de elemento vía `dangerouslySetInnerHTML`. NUNCA la interpoles en un
 * ATRIBUTO, una URL, `<script>` o `<style>`: `esc` no escapa `&` ni comillas a
 * propósito (para preservar las entidades que emite TipTap), así que fuera de
 * «contenido de elemento» sería insegura. Hoy los únicos sinks son la vista previa del
 * formulario y `reactivo-preview-modal`.
 */

/** Tope de longitud del HTML crudo antes de sanear: acota el trabajo de la regex ante
 *  input patológico (miles de `<` sin cerrar) y es sano para el storage. */
export const MAX_HTML = 10_000;

// Whitelist estricta: lo que emite el editor (bold→strong, italic→em, sup, sub, p, br)
// + b/i por si acaso. SIN atributos.
const PERMITIDAS = new Set(["b", "strong", "i", "em", "sup", "sub", "p", "br"]);
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\/?>/g;

/** Escapa SOLO `<` y `>` (deja `&` intacto → preserva las entidades ya presentes).
 *  Válido únicamente para CONTENIDO de elemento. */
function esc(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanea HTML a la whitelist `{b,strong,i,em,sup,sub,p,br}` SIN atributos; todo lo demás
 * se escapa. Prueba estructural de seguridad: el bucle usa `/g` y `last = index+len` sin
 * saltar ningún carácter, así que el ÚNICO `<` crudo posible en la salida es el inicio de
 * uno de 16 strings fijos (los tags permitidos, sin atributos, sin elementos de parsing
 * especial como script/style/svg) → sin vector de XSS/mXSS. Idempotente.
 */
export function sanear(html: string): string {
  const entrada = String(html).slice(0, MAX_HTML);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(entrada)) !== null) {
    out += esc(entrada.slice(last, m.index));
    const tag = m[1].toLowerCase();
    if (PERMITIDAS.has(tag)) {
      // `br` es vacío → siempre `<br>` (descarta un eventual `</br>`).
      out += tag === "br" ? "<br>" : m[0].startsWith("</") ? `</${tag}>` : `<${tag}>`;
    } else {
      out += esc(m[0]); // tag no permitido → texto escapado
    }
    last = m.index + m[0].length;
  }
  out += esc(entrada.slice(last));
  return out;
}

/** `String.fromCodePoint` blindado: descarta valores hostiles para que una entidad como
 *  `&#999999999;` o un surrogate NO lancen y tumben `reactivos.listar` entero. */
function desdeCodigo(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) {
    return "";
  }
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/**
 * HTML → TEXTO PLANO (para la celda/búsqueda del banco y la validación de «no vacío»).
 * Marcas inline → sin espacio (`x<sup>2</sup>` = «x2», así la búsqueda de LUI-14 no se
 * degrada); límites de bloque (`</p>`, `<br>`) → espacio.
 *
 * ⚠️ REGLA DE ORO: DECODIFICA entidades → PRODUCE `<` crudos. Su salida es segura SOLO
 * pintada como TEXTO (`{texto}` de React / `.textContent`), NUNCA a `dangerouslySetInnerHTML`
 * ni concatenada en HTML — sería XSS almacenado.
 */
export function aTextoPlano(html: string): string {
  return String(html)
    .replace(/<\/?(?:b|strong|i|em|sup|sub)\b[^>]*>/gi, "") // inline → ""
    .replace(/<\/p\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ") // límites de bloque → " "
    .replace(/<[^>]*>/g, "") // cualquier tag residual (incl. `<p>` de apertura)
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => desdeCodigo(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => desdeCodigo(parseInt(d, 10)))
    .replace(/&amp;/gi, "&") // AL FINAL: evita doble-decodificar `&amp;lt;` → `<`
    // Caracteres INVISIBLES: sin esto, un `&#x200B;`/U+200B pasaría la validación de
    // «no vacío» (sobrevive a `.trim()`) → un reactivo visualmente vacío.
    .replace(/\p{Cf}/gu, "") // formato invisible (U+200B, U+2060, U+200E, BOM…) → fuera
    .replace(/\p{Cc}/gu, " ") // control (incl. \n\t) → espacio (no juntar palabras)
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape HTML COMPLETO (`&` PRIMERO, luego `<`/`>`) — distinto de `esc`, para que un
 *  legado con el literal `&lt;` se muestre como `&lt;` y no se reinterprete. */
function escaparCompleto(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Texto plano LEGADO → HTML fiel y seguro. Se usa en `reactivos.obtener` para el
 * contenido sin `contenidoFormato:"html"`, de modo que TipTap y el preview reciban
 * SIEMPRE HTML (jamás un `<` literal que el editor interpretaría como tag).
 */
export function textoPlanoAHtml(plano: string): string {
  return `<p>${escaparCompleto(String(plano)).replace(/\n/g, "<br>")}</p>`;
}
