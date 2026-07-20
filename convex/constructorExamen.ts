import { ConvexError, v, type Infer } from "convex/values";
import type { TipoExamen } from "./examenEstado";

/**
 * Núcleo del CONSTRUCTOR de examen (LUI-21), en un módulo PURO.
 *
 * Vive aparte por las mismas dos razones que `examenEstado.ts`: (1) `npx convex run` corre
 * sin identidad, así que lo decidible sin BD se prueba aquí (`scripts/test-constructor.ts`)
 * o no se prueba; (2) `schema.ts` importa `seccionDeExamenValidator` de aquí, y un módulo
 * con `ctx` no puede ser importado por el schema. Solo importa `convex/values` y el módulo
 * puro `examenEstado` — jamás `_generated` (los tipos salen de `Infer`).
 *
 * ══ EL INVARIANTE DEL EXAMEN CON ESTRUCTURA ══
 *
 * Si `examenes.secciones` está PRESENTE:
 *   (i)   sin `seccionId` duplicados en la estructura;
 *   (ii)  cada reactivo de `reactivoIds` existe y su `seccionId` ∈ secciones declaradas;
 *   (iii) `reactivoIds` es la concatenación de RACHAS contiguas — a lo más UNA racha por
 *         sección, y las rachas siguen el orden del arreglo `secciones`;
 *   (iv)  sin ids repetidos;
 *   (v)   una sección declarada sin reactivos es legal (racha vacía).
 *
 * Si `secciones` está AUSENTE: examen LEGADO sin invariante de agrupación (los sembrados
 * antes de LUI-21 y los de producción). Los escritores nuevos siempre escriben estructura.
 *
 * Quién lo sostiene: los TRES escritores (`examenes.crear`, `examenes.actualizar` y el
 * crear-directo de `reactivos.crear`) pasan por la frontera compartida
 * (`examenGuardado.validarGuardado`), que RECHAZA entrada no conforme — nunca normaliza en
 * silencio. `examenes.publicar` RE-valida: el invariante puede degradarse sin escribir en
 * `examenes` (reclasificar un reactivo toca `reactivos`, y ni un borrador ni un publicado
 * sin compromisos congelan).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tope de reactivos por examen. El EXANI-II real ronda 168 reactivos; 240 lo cubre con
 * holgura sin acercarse al techo físico del arreglo (8192 elementos, ver `examenes.listar`).
 * Acota el payload de la query del constructor y el trabajo de las validaciones. El 90 del
 * simulacro de núcleo UNX (30/30/30) es CONVENCIÓN de contenido, no constante del sistema:
 * vive en la plantilla del cliente y en la meta opcional por sección.
 *
 * ⚠️ Las mutations aplican este tope sobre la entrada CRUDA, antes de leer reactivos — y
 * los LECTORES lo comprueban antes de resolver ids: un examen legado admitido por el schema
 * puede traer hasta 8192.
 */
export const MAX_REACTIVOS = 240;
/** Defensa contra estructuras absurdas; el temario real tiene 3 secciones de núcleo + módulos. */
export const MAX_SECCIONES = 20;
/** Una meta mayor que el tope de reactivos sería inalcanzable por construcción. */
export const MAX_META = MAX_REACTIVOS;
/** 10 horas. El input del cliente es horas/minutos; esto acota el `duracionMin` serializado. */
export const MAX_DURACION_MIN = 600;
/** El título es una etiqueta, no un texto — mismo criterio y cota que `bloque.MAX_TITULO`. */
export const MAX_TITULO = 160;

// ─────────────────────────────────────────────────────────────────────────────
// La estructura declarada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una sección DECLARADA del examen. El orden del arreglo `secciones` ES el orden de las
 * secciones en el examen. `meta` es la meta de reactivos de ESA sección en ESTE examen
 * (opcional y por examen — el AC de LUI-21: «configurable por examen», no constante).
 *
 * La PERTENENCIA de un reactivo a una sección NO se almacena aquí: se deriva de la
 * clasificación del propio reactivo (`reactivos.seccionId`, requerida). Almacenarla anidada
 * duplicaría la verdad; derivarla mantiene `reactivoIds` plano intacto para
 * `calcularBloqueo`, la vista previa y el player (LUI-24).
 */
export const seccionDeExamenValidator = v.object({
  seccionId: v.id("secciones"),
  meta: v.optional(v.number()),
});

export type SeccionDeExamen = Infer<typeof seccionDeExamenValidator>;

/**
 * Valida la estructura declarada — cota, duplicados y metas. Lanza `ConvexError` con el
 * primer problema; los mensajes van al `Alert` del constructor tal cual.
 */
export function validarEstructura(
  secciones: readonly SeccionDeExamen[],
): void {
  if (secciones.length > MAX_SECCIONES)
    throw new ConvexError(
      `El examen admite hasta ${MAX_SECCIONES} secciones.`,
    );
  const vistas = new Set<string>();
  for (const s of secciones) {
    if (vistas.has(s.seccionId))
      throw new ConvexError("La estructura del examen repite una sección.");
    vistas.add(s.seccionId);
    if (s.meta !== undefined) {
      if (!Number.isInteger(s.meta) || s.meta < 1 || s.meta > MAX_META)
        throw new ConvexError(
          `La meta de una sección debe ser un entero entre 1 y ${MAX_META}.`,
        );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipo del examen — calculado de la estructura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El `tipo` del examen se CALCULA de la estructura declarada, en el servidor, en cada
 * guardado: exactamente UNA sección declarada y de tipo `modulo` → examen de módulo; todo
 * lo demás (vacía, varias, mixtas, dos módulos) → simulacro general. Sin desempates
 * arbitrarios: la regla es total.
 *
 * Esto NO contradice «almacenado, no derivado» (`examenEstado.tipoExamenValidator`): el
 * campo sigue ALMACENADO y sigue siendo decisión del autor — expresada en la estructura que
 * armó (un borrador vacío de plantilla módulo ya tiene estructura, luego ya tiene tipo). Lo
 * que nunca ocurre es que el CLIENTE mande el tipo: el servidor lo recalcula y lo escribe
 * EXPLÍCITO (nunca `undefined`), así `by_tipo_seccion` no puede quedar incoherente.
 */
export function tipoDeEstructura(
  secciones: ReadonlyArray<{
    seccionId: SeccionDeExamen["seccionId"];
    tipoSeccion: "nucleo" | "modulo";
  }>,
): TipoExamen {
  if (secciones.length === 1 && secciones[0].tipoSeccion === "modulo")
    return { clase: "modulo", seccionId: secciones[0].seccionId };
  return { clase: "general" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrupación de reactivos por sección
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida los puntos (ii)–(v) del invariante sobre datos YA cargados. Devuelve el PRIMER
 * problema o `null` — mismo contrato que `bloque.validarBloquesCompletosPuro`, y por la
 * misma razón: un mensaje concreto por vez, no un reporte.
 *
 * `seccionDe` mapea reactivoId → seccionId REAL (de la clasificación del reactivo); un id
 * sin entrada es un fantasma. `ordenSecciones` es la lista de `seccionId` declarados, en
 * orden y sin duplicados (eso ya lo garantizó `validarEstructura`).
 *
 * El tope `MAX_REACTIVOS` NO se comprueba aquí: es frontera de entrada CRUDA de las
 * mutations, aplicada antes de cargar los documentos que esta función necesita.
 */
export function validarAgrupacion(
  ids: readonly string[],
  seccionDe: ReadonlyMap<string, string>,
  ordenSecciones: readonly string[],
): string | null {
  const declaradas = new Set(ordenSecciones);
  const vistos = new Set<string>();
  // La secuencia de rachas: la sección de cada tramo contiguo, en orden de aparición.
  const rachas: string[] = [];
  for (const id of ids) {
    if (vistos.has(id)) return "El examen tiene un reactivo repetido.";
    vistos.add(id);
    const seccion = seccionDe.get(id);
    if (seccion === undefined)
      return "El examen referencia un reactivo que ya no existe.";
    if (!declaradas.has(seccion))
      return "Un reactivo del examen pertenece a una sección que no está en su estructura.";
    if (rachas[rachas.length - 1] !== seccion) rachas.push(seccion);
  }
  // (iii) a lo más UNA racha por sección: repetirse en `rachas` = reactivos de la misma
  // sección separados por otra (intercalado).
  const conRacha = new Set<string>();
  for (const seccion of rachas) {
    if (conRacha.has(seccion))
      return "Los reactivos de una misma sección deben ir juntos, sin intercalar otras secciones.";
    conRacha.add(seccion);
  }
  // (iii) las rachas siguen el orden declarado: índices estrictamente crecientes.
  let previo = -1;
  for (const seccion of rachas) {
    const indice = ordenSecciones.indexOf(seccion);
    if (indice <= previo)
      return "Los reactivos no siguen el orden de las secciones del examen.";
    previo = indice;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publicabilidad AGREGADA de los bloques de lectura (para la oferta del banco)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Veredicto de publicabilidad POR BLOQUE, no por fila: `false` para TODAS las hermanas de
 * una lectura si CUALQUIERA de ellas está dañada. Sin la agregación, una hermana sana
 * quedaría ofertable junto a su hermana inconsistente suprimida — y el modal «Agregar
 * reactivos» ofrecería un bloque PARCIAL, justo lo que «se agrega completa» prohíbe.
 *
 * ⚠️ `bloqueLecturaId` es el identificador CRUDO `r.bloque?.lecturaId` — JAMÁS el
 * `lecturaId` público que produce `lecturaParaEnlace`: ese se vuelve `null` precisamente
 * para la hermana inconsistente, lo que la sacaría de su grupo y desactivaría la agregación
 * que esta función existe para garantizar. `consistente` lo decide el llamador con
 * `resolverLectura` (¿la resolución es exactamente `tipo:"bloque"` hacia esa misma
 * lectura?); `lecturas` trae el veredicto por lectura (¿existe? ¿pasa `lecturaPublicable`?).
 *
 * Las filas sin bloque (`bloqueLecturaId === null`) no participan: son reactivos sueltos.
 */
export function publicabilidadDeBloques(
  filas: ReadonlyArray<{ bloqueLecturaId: string | null; consistente: boolean }>,
  lecturas: ReadonlyMap<string, { existe: boolean; publicable: boolean }>,
): Map<string, boolean> {
  const veredicto = new Map<string, boolean>();
  for (const fila of filas) {
    if (fila.bloqueLecturaId === null) continue;
    const lectura = lecturas.get(fila.bloqueLecturaId);
    const sana =
      fila.consistente &&
      lectura !== undefined &&
      lectura.existe &&
      lectura.publicable;
    veredicto.set(
      fila.bloqueLecturaId,
      (veredicto.get(fila.bloqueLecturaId) ?? true) && sana,
    );
  }
  return veredicto;
}
