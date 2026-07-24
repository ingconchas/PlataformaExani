import { ConvexError } from "convex/values";
import { PUNTAJE_BASE, PUNTAJE_MAX, PUNTAJE_RANGO, redondearPuntaje } from "./simulacro";

/**
 * META de la alumna — reglas PURAS del perfil académico (LUI-36) y de su comparación con el
 * puntaje (LUI-28).
 *
 * Misma razón de existir que `simulacro.ts`, `examenEstado.ts` y `temarioReglas.ts`: estas
 * reglas las comparten el SERVIDOR (que valida lo que se guarda), el CLIENTE (que pinta la
 * barra, el delta y el copy) y las PRUEBAS (`scripts/test-meta-alumna.ts`, que corre con
 * `tsx` y no puede importar `_generated/server`). Solo importa `convex/values` y el otro
 * módulo puro.
 *
 * La escala 700–1300 se REUSA de `simulacro.ts`, no se redefine: una segunda definición de
 * la escala es un bug esperando a que alguien mueva una sola de las dos.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Texto libre (institución y carrera)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Longitud máxima de institución y carrera. Calcado de `MAX_NOMBRE_TEMARIO` (mismo problema:
 * un string sin tope puede pesar hasta el límite duro de 1 MiB por documento y volvería
 * indefendible cualquier presupuesto de bytes de quien lea la fila).
 *
 * La cota va en CARACTERES —no en bytes— porque es lo que el formulario puede enunciar de
 * forma comprensible; el presupuesto de bytes queda acotado por construcción: 120 caracteres
 * × 4 B (peor caso UTF-8) = 480 B por campo.
 */
export const MAX_TEXTO_META = 120;

export const MSG_INSTITUCION_OBLIGATORIA = "Escribe la institución a la que quieres entrar.";
export const MSG_CARRERA_OBLIGATORIA = "Escribe la carrera a la que vas a aplicar.";
export const MSG_TEXTO_LARGO = `No puede exceder ${MAX_TEXTO_META} caracteres.`;
export const MSG_TEXTO_CONTROL = "El texto no puede contener caracteres invisibles.";

/** C0 + DEL + C1. Un salto de línea en un campo de UNA línea es basura pegada, no contenido:
 *  se rechaza en vez de normalizarse en silencio (jamás se altera lo que la alumna escribió
 *  más allá del recorte de extremos). */
const CARACTERES_DE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Normaliza y valida un texto del perfil: NFC → recorte de extremos → no vacío → sin
 * caracteres de control → ≤ `MAX_TEXTO_META` caracteres. LANZA con el copy exacto que pinta
 * el formulario.
 *
 * El orden importa: la normalización NFC va ANTES de contar porque «é» puede llegar como uno
 * o dos code points según el teclado, y sin ella la misma palabra pasaría o no la cota según
 * cómo se tecleó. La frontera exacta (120 pasa, 121 rechaza) la fija `test-meta-alumna.ts`.
 */
export function limpiarTextoMeta(bruto: string, msgVacio: string): string {
  const texto = bruto.normalize("NFC").trim();
  if (!texto) throw new ConvexError(msgVacio);
  if (CARACTERES_DE_CONTROL.test(texto)) throw new ConvexError(MSG_TEXTO_CONTROL);
  if ([...texto].length > MAX_TEXTO_META) throw new ConvexError(MSG_TEXTO_LARGO);
  return texto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Puntaje objetivo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paso del SLIDER, y solo del slider. El servidor acepta cualquier ENTERO del rango: exigir
 * múltiplos de 10 rechazaría justo lo que la entrada numérica accesible permite escribir, y
 * la ruta accesible no puede ser la que falla.
 */
export const PASO_META = 10;

export const MSG_META_RANGO =
  `Tu meta debe ser un número entero entre ${PUNTAJE_BASE} y ${PUNTAJE_MAX}.`;

/** Entero dentro de la escala EXANI. LANZA fuera de rango, con decimales o sin ser finito. */
export function validarMetaPuntaje(bruto: number): number {
  if (!Number.isInteger(bruto) || bruto < PUNTAJE_BASE || bruto > PUNTAJE_MAX) {
    throw new ConvexError(MSG_META_RANGO);
  }
  return bruto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparación con la meta — LA invariante de redondeo
// ─────────────────────────────────────────────────────────────────────────────

export type ComparacionMeta = {
  /** El MISMO número que la alumna lee en 56 px. Todo lo demás se deriva de aquí. */
  puntajeMostrado: number;
  meta: number;
  /** `meta − puntajeMostrado`. ≤ 0 cuando ya la alcanzó. */
  delta: number;
  alcanzada: boolean;
  superada: boolean;
  /** Contrato de `ProgressBar`: value/max/goal ya trasladados al origen de la escala. */
  valorBarra: number;
  maxBarra: number;
  metaBarra: number;
};

/**
 * EMBUDO ÚNICO de toda comparación VISIBLE contra la meta (LUI-28 hoy, LUI-24 y LUI-34
 * después).
 *
 * ══ POR QUÉ RECIBE EL PUNTAJE CRUDO Y REDONDEA AQUÍ ══
 *
 * `calcularPuntaje` almacena EXACTO (`700 + aciertos×600/N`; 67/90 = 1146.666…) y
 * `redondearPuntaje` es «el ÚNICO redondeo del sistema» (`simulacro.ts`). Si la comparación
 * usara el valor crudo, con meta 1147 la pantalla mostraría «1147» en grande y a la vez
 * «A 1 punto de tu meta»: el número principal y su propio comentario contradiciéndose.
 *
 * La regla del paquete es que **todo lo visible se deriva de `puntajeMostrado`**, y esta
 * función es la que la hace cumplir: recibe el crudo para que ningún llamador pueda olvidar
 * redondear, y devuelve ya resueltos el delta, los flags y las tres cifras de la barra.
 *
 * `alcanzada` usa `>=` (la igualdad cuenta como alcanzada) y `superada` usa `>`: son copys
 * distintos y confundirlos le diría «superaste» a quien empató.
 */
export function compararConMeta(puntajeCrudo: number, meta: number): ComparacionMeta {
  const puntajeMostrado = redondearPuntaje(puntajeCrudo);
  return {
    puntajeMostrado,
    meta,
    delta: meta - puntajeMostrado,
    alcanzada: puntajeMostrado >= meta,
    superada: puntajeMostrado > meta,
    valorBarra: puntajeMostrado - PUNTAJE_BASE,
    maxBarra: PUNTAJE_RANGO,
    metaBarra: meta - PUNTAJE_BASE,
  };
}

export const BADGE_META_SUPERADA = "¡Superaste tu meta!";
export const BADGE_META_ALCANZADA = "¡Alcanzaste tu meta!";

/** Etiqueta del badge verde, o `null` si todavía no llega. Singular/plural incluidos. */
export function badgeDeMeta(c: ComparacionMeta): string | null {
  if (c.superada) return BADGE_META_SUPERADA;
  if (c.alcanzada) return BADGE_META_ALCANZADA;
  return null;
}

/**
 * «¡A N puntos de tu meta, Fernanda!» — `null` cuando ya la alcanzó (con `delta <= 0` la
 * frase no existe: no se pinta «A 0 puntos» ni un delta negativo).
 */
export function etiquetaDelta(c: ComparacionMeta, nombre: string): string | null {
  if (c.delta <= 0) return null;
  const unidad = c.delta === 1 ? "punto" : "puntos";
  return `¡A ${c.delta} ${unidad} de tu meta, ${nombre}!`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Máquina de estados del perfil académico
// ─────────────────────────────────────────────────────────────────────────────

/** La forma mínima de la fila que estas reglas necesitan (evita depender de `Doc<>`). */
export type FilaPerfilAlumna = {
  institucionObjetivo?: string;
  carreraObjetivo?: string;
  metaPuntaje?: number;
};

export type MetaAlumna = { institucion: string; carrera: string; puntaje: number };

export const MSG_TRIPLETA_PARCIAL =
  "Perfil académico inconsistente: institución, carrera y puntaje objetivo van siempre juntos.";

/**
 * La TRIPLETA institución + carrera + puntaje, o `null` si la alumna todavía no fijó su meta.
 *
 * ══ ESTADOS LEGALES (los cuatro, y solo estos) ══
 *  1. **sin fila** — alumna nueva ⇒ `metaDe(null) === null`
 *  2. fila con módulos y sin tripleta ⇒ `null`
 *  3. fila con tripleta y `modulosIds: []`
 *  4. fila con tripleta y módulos
 *
 * La tripleta PARCIAL es un estado ilegal e imposible por construcción: una sola mutation
 * (`perfilAlumna.guardarMeta`) la escribe, siempre las tres juntas, y ninguna otra la toca.
 * Por eso aquí LANZA en vez de degradar: si alguna vez aparece una fila con dos de tres, el
 * escritor está roto y una falla ruidosa es la única forma de enterarse — devolver `null`
 * escondería la corrupción detrás de un estado vacío perfectamente normal.
 */
export function metaDe(fila: FilaPerfilAlumna | null | undefined): MetaAlumna | null {
  if (!fila) return null;
  const { institucionObjetivo, carreraObjetivo, metaPuntaje } = fila;
  const presentes =
    Number(institucionObjetivo !== undefined) +
    Number(carreraObjetivo !== undefined) +
    Number(metaPuntaje !== undefined);
  if (presentes === 0) return null;
  if (presentes !== 3) throw new ConvexError(MSG_TRIPLETA_PARCIAL);
  return {
    institucion: institucionObjetivo as string,
    carrera: carreraObjetivo as string,
    puntaje: metaPuntaje as number,
  };
}
