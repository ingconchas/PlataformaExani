import { ConvexError, v } from "convex/values";
import { aTextoPlano, sanear, MAX_HTML } from "./sanitizar";

/**
 * Núcleo del BLOQUE de preguntas de una lectura (LUI-17).
 *
 * Módulo PURO — sin `ctx`, sin `_generated`, sin DOM — para que corra igual en el runtime V8
 * de Convex, en el cliente y en `scripts/test-bloque.ts`. Mismo patrón y misma razón que
 * `convex/material.ts`: todo lo que está tras `requireStaff` es inalcanzable desde
 * `npx convex run`, así que la superficie hostil solo queda PROBADA si es pura.
 *
 * Aquí vive además la frontera que heredará el constructor de exámenes (LUI-21): la regla
 * «un bloque no entra partido a un examen» se expresa una sola vez, en
 * `validarBloquesCompletosPuro`, para que LUI-21 no la re-derive.
 */

/** Mínimo para PUBLICAR. No es mínimo para editar: una lectura puede quedarse en 0 o 1
 *  preguntas mientras se arma (si no, una lectura mal armada sería irreparable). */
export const MIN_PREGUNTAS = 2;
export const MAX_PREGUNTAS = 5;
/** El título es una etiqueta, no un texto: 160 caracteres son de sobra y acotan el payload. */
export const MAX_TITULO = 160;

/**
 * Una pregunta del bloque tal como llega del cliente. **No lleva `subtemaId`**: la
 * clasificación la fija la LECTURA y sus preguntas la copian, así que clasificar una pregunta
 * fuera de su lectura no es «algo que se comprueba», es algo que no se puede expresar.
 *
 * Tampoco lleva imagen ni presentación: las preguntas de lectura son siempre directas en el
 * MVP.
 */
export const preguntaValidator = v.object({
  enunciado: v.string(),
  opciones: v.array(v.object({ id: v.string(), texto: v.string() })),
  opcionCorrecta: v.string(),
  dificultad: v.union(
    v.literal("facil"),
    v.literal("medio"),
    v.literal("dificil"),
  ),
  retroalimentacion: v.string(),
});

/**
 * Título de la lectura: TEXTO PLANO. Devuelve `titulo.trim()`.
 *
 * ⚠️ `aTextoPlano` se usa SOLO como PREDICADO de «no vacío» —caza los invisibles que
 * sobreviven al `trim`— y su salida **jamás se almacena**: desescapa entidades, y su contrato
 * dice que solo es segura como texto. Un título `&lt;b&gt;` debe seguir siendo `&lt;b&gt;`.
 */
export function validarTitulo(titulo: string): string {
  if (titulo.length > MAX_TITULO)
    throw new ConvexError(
      `El título no puede pasar de ${MAX_TITULO} caracteres.`,
    );
  const limpio = titulo.trim();
  if (!aTextoPlano(limpio).trim())
    throw new ConvexError("El título de la lectura es obligatorio.");
  return limpio;
}

/**
 * Texto base de la lectura: HTML enriquecido, saneado a la whitelist.
 *
 * ⚠️ La cota se comprueba con THROW **antes** de sanear, no se delega en el truncado: `sanear`
 * corta en silencio a `MAX_HTML` y puede partir un tag por la mitad. El texto base es el campo
 * más largo del modelo, así que es justo donde el truncado silencioso haría más daño.
 */
export function validarTextoBase(html: string): string {
  if (html.length > MAX_HTML)
    throw new ConvexError("El texto base es demasiado largo.");
  const limpio = sanear(html);
  if (!aTextoPlano(limpio).trim())
    throw new ConvexError("El texto base de la lectura es obligatorio.");
  return limpio;
}

/** Una pregunta del bloque, con lo que el orden necesita. Se desempata como en el temario
 *  (`convex/temario.ts:porOrden`): `orden` puede traer empates o huecos por edición manual, y
 *  `_creationTime`/`_id` dan un orden determinista sin exigir unicidad. */
export type PreguntaOrdenable = {
  _id: string;
  _creationTime: number;
  orden: number;
};

export function porOrdenDeBloque(a: PreguntaOrdenable, b: PreguntaOrdenable) {
  return (
    a.orden - b.orden ||
    a._creationTime - b._creationTime ||
    a._id.localeCompare(b._id)
  );
}

/**
 * Mueve una pregunta dentro del bloque y devuelve la asignación de `orden` **densa y
 * renumerada 0..n-1** para TODAS las preguntas, o `null` si el movimiento es imposible (la
 * pregunta no está, ya es el extremo, o el bloque tiene una sola).
 *
 * ⚠️ Devuelve la renumeración completa, no un intercambio de dos valores: un `.index()` de
 * Convex no es constraint único, así que empates y huecos son representables y solo la
 * renumeración en CADA escritura los mantiene fuera. Un swap ingenuo dejaría `[0,0,5]` tal
 * cual, y el orden visible pasaría a depender del desempate.
 */
export function reordenar(
  preguntas: PreguntaOrdenable[],
  moverId: string,
  direccion: "arriba" | "abajo",
): { _id: string; orden: number }[] | null {
  const ordenadas = [...preguntas].sort(porOrdenDeBloque);
  const i = ordenadas.findIndex((p) => p._id === moverId);
  if (i === -1) return null;
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if (j < 0 || j >= ordenadas.length) return null;
  [ordenadas[i], ordenadas[j]] = [ordenadas[j], ordenadas[i]];
  return ordenadas.map((p, k) => ({ _id: p._id, orden: k }));
}

/**
 * ¿La lectura puede entrar a un examen? Es la ÚNICA expresión de la regla, para que LUI-21 no
 * la re-derive.
 *
 * `clasificacionDisponible` es conjuntivo (nodo y ancestros activos, ver `temario.ts`): sin
 * él, una lectura activa colgada de un área RETIRADA resultaría publicable.
 */
export function lecturaPublicable(a: {
  preguntas: number;
  activas: number;
  lecturaActiva: boolean;
  clasificacionDisponible: boolean;
}): boolean {
  return (
    a.lecturaActiva &&
    a.clasificacionDisponible &&
    a.preguntas >= MIN_PREGUNTAS &&
    a.preguntas <= MAX_PREGUNTAS &&
    a.activas === a.preguntas
  );
}

/** Lo que los helpers de bloque necesitan saber de un reactivo, ya cargado. */
export type ReactivoDeExamen = {
  _id: string;
  bloque?: { lecturaId: string; orden: number };
};

/**
 * Lo que los helpers necesitan saber de una LECTURA referenciada, ya cargada.
 *
 * ⚠️ `existe` es un campo propio y no «el mapa tiene entrada»: el índice `by_bloque` encuentra
 * las preguntas huérfanas de una lectura borrada, así que el envoltorio construye una entrada
 * NO vacía para ellas. Sin este campo, una lectura fantasma pasaría la frontera.
 */
export type BloqueDeLectura = {
  existe: boolean;
  preguntas: PreguntaOrdenable[];
  activas: number;
  lecturaActiva: boolean;
  clasificacionDisponible: boolean;
};

/**
 * Expande una lista de ids de examen para que **cada bloque referenciado entre COMPLETO y en
 * su orden**, conservando el orden relativo del examen: las preguntas sueltas no se mueven, y
 * cada bloque aparece en la posición donde apareció su primera pregunta.
 *
 * Es lo que el constructor debe llamar al AGREGAR, para que un bloque no pueda entrar partido
 * por construcción en vez de por validación.
 */
export function expandirBloquesPuro(
  ids: string[],
  porId: Map<string, ReactivoDeExamen>,
  bloquePorLectura: Map<string, BloqueDeLectura>,
): string[] {
  const salida: string[] = [];
  const puestos = new Set<string>();
  const bloquesPuestos = new Set<string>();
  for (const id of ids) {
    if (puestos.has(id)) continue; // duplicado en la entrada: se colapsa
    const r = porId.get(id);
    if (!r) {
      // Id fantasma: se conserva tal cual. Quitarlo aquí escondería el problema; a esta
      // función le toca expandir, y a `validarBloquesCompletosPuro` denunciarlo.
      salida.push(id);
      puestos.add(id);
      continue;
    }
    if (!r.bloque) {
      salida.push(id);
      puestos.add(id);
      continue;
    }
    if (bloquesPuestos.has(r.bloque.lecturaId)) continue; // ya se volcó entero
    bloquesPuestos.add(r.bloque.lecturaId);
    const hermanas = bloquePorLectura.get(r.bloque.lecturaId)?.preguntas ?? [];
    for (const h of [...hermanas].sort(porOrdenDeBloque)) {
      if (puestos.has(h._id)) continue;
      salida.push(h._id);
      puestos.add(h._id);
    }
  }
  return salida;
}

/**
 * La FRONTERA de publicación: devuelve el primer problema encontrado, o `null`.
 *
 * ⚠️ **No confía en que el `orden` persistido sea denso.** Las mutations renumeran, pero la
 * frontera no debe aceptar corrupción manual (edición desde el dashboard, import) solo porque
 * el camino feliz renumera: `[0,0,5]` en la base se RECHAZA, no se «interpreta».
 */
export function validarBloquesCompletosPuro(
  ids: string[],
  porId: Map<string, ReactivoDeExamen>,
  bloquePorLectura: Map<string, BloqueDeLectura>,
): string | null {
  const vistos = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) return "El examen tiene un reactivo repetido.";
    vistos.add(id);
    if (!porId.has(id)) return "El examen referencia un reactivo que ya no existe.";
  }

  // Lecturas referenciadas, en el orden en que aparecen.
  const lecturas: string[] = [];
  for (const id of ids) {
    const b = porId.get(id)?.bloque;
    if (b && !lecturas.includes(b.lecturaId)) lecturas.push(b.lecturaId);
  }

  for (const lecturaId of lecturas) {
    const b = bloquePorLectura.get(lecturaId);
    // ⚠️ `existe` explícito: el índice `by_bloque` SÍ encuentra las preguntas de una lectura
    // borrada, así que «hay entrada en el mapa» no prueba que la lectura siga ahí.
    if (!b || !b.existe || b.preguntas.length === 0)
      return "Una pregunta apunta a una lectura que ya no existe.";
    const hermanas = b.preguntas;

    // ⚠️ ELEGIBILIDAD. Sin esto, la frontera aceptaría exactamente lo que el listado marca
    // «Incompleta»: un bloque de una sola pregunta, una pregunta inactiva, la lectura
    // desactivada o su clasificación retirada. El filtro de la UI NO es una frontera.
    if (
      !lecturaPublicable({
        preguntas: hermanas.length,
        activas: b.activas,
        lecturaActiva: b.lecturaActiva,
        clasificacionDisponible: b.clasificacionDisponible,
      })
    )
      return `Una lectura del examen no está lista para publicarse: necesita entre ${MIN_PREGUNTAS} y ${MAX_PREGUNTAS} preguntas activas, estar activa y colgar de una rama vigente del temario.`;

    // El `orden` persistido tiene que ser denso 0..n-1 y sin empates.
    const ordenes = [...hermanas.map((h) => h.orden)].sort((a, b) => a - b);
    const denso = ordenes.every((o, k) => o === k);
    if (!denso)
      return "El orden de una lectura está corrupto; reordénala antes de publicar.";

    const posiciones = hermanas.map((h) => ids.indexOf(h._id));
    if (posiciones.some((p) => p === -1))
      return "El examen incluye solo una parte de una lectura; agrégala completa.";

    // Contiguas y en el orden del bloque.
    const esperado = [...hermanas].sort(porOrdenDeBloque).map((h) => h._id);
    const inicio = Math.min(...posiciones);
    const tramo = ids.slice(inicio, inicio + esperado.length);
    if (tramo.length !== esperado.length || tramo.some((id, k) => id !== esperado[k]))
      return "Las preguntas de una lectura deben ir juntas y en su orden.";
  }
  return null;
}
