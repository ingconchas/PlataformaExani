import { type Id } from "./_generated/dataModel";

/**
 * Resolución TRANSITORIA de la lectura de un reactivo (LUI-17, Fase A).
 *
 * Durante la Fase A conviven dos representaciones: `lecturaId` (deprecado, sin escritor) y
 * `bloque: { lecturaId, orden }` (la buena, que lleva pertenencia y orden juntos). Este
 * módulo es el ÚNICO lugar que decide cómo leerlas.
 *
 * Vive en su propio archivo —y no dentro de `reactivos.ts` ni de `lecturas.ts`— para que
 * esos dos no acaben importándose mutuamente: `lecturas.ts` necesita cosas de `reactivos.ts`
 * (el candado, los contadores) y ambos necesitan esta resolución.
 *
 * Es PURO (solo tipos de `_generated/dataModel`, que se borran al compilar): lo puede
 * importar el cliente y lo cubre `scripts/test-bloque.ts`.
 *
 * ⚠️ **Si los dos campos existen y DISCREPAN no se elige en silencio.** Se devuelve
 * `"inconsistente"` y cada consumidor decide de forma CONSERVADORA:
 *  · el candado usa `bloque.lecturaId` — bloquear de más es seguro, sub-bloquear dejaría
 *    editar una pregunta comprometida;
 *  · el chip y el enlace se SUPRIMEN — enlazar a una lectura elegida por desempate sería
 *    peor que no enlazar;
 *  · las ESCRITURAS lanzan (`convex/reactivos.ts`), nunca reparan por su cuenta.
 */

type CamposDeLectura = {
  lecturaId?: Id<"lecturas">;
  bloque?: { lecturaId: Id<"lecturas">; orden: number };
};

export type ResolucionLectura =
  /** Reactivo LIBRE del banco. */
  | { tipo: "libre" }
  /** Pertenece a un bloque (la representación buena). */
  | { tipo: "bloque"; lecturaId: Id<"lecturas">; orden: number }
  /** Solo el campo deprecado: dato anterior a LUI-17, todavía sin bloque. */
  | { tipo: "legado"; lecturaId: Id<"lecturas"> }
  /** Ambos campos presentes y apuntando a lecturas DISTINTAS. */
  | { tipo: "inconsistente"; lecturaId: Id<"lecturas">; orden: number };

export function resolverLectura(r: CamposDeLectura): ResolucionLectura {
  if (r.bloque) {
    if (r.lecturaId && r.lecturaId !== r.bloque.lecturaId)
      return {
        tipo: "inconsistente",
        lecturaId: r.bloque.lecturaId,
        orden: r.bloque.orden,
      };
    return { tipo: "bloque", lecturaId: r.bloque.lecturaId, orden: r.bloque.orden };
  }
  if (r.lecturaId) return { tipo: "legado", lecturaId: r.lecturaId };
  return { tipo: "libre" };
}

/** ¿Es una pregunta de BLOQUE? Es la pregunta que hacen los guards de `reactivos`: un
 *  documento con `bloque` no se edita ni se desactiva por la puerta del banco, ni siquiera
 *  si además arrastra un `lecturaId` que discrepa. */
// Es un PREDICADO DE TIPO para que estreche también en el llamador: con un `boolean` a
// secas, TypeScript no sabría que `res.lecturaId` existe tras comprobarlo.
export function esDeBloque(
  res: ResolucionLectura,
): res is Extract<ResolucionLectura, { tipo: "bloque" | "inconsistente" }> {
  return res.tipo === "bloque" || res.tipo === "inconsistente";
}

/** La lectura cuyo candado se propaga a este reactivo, o `null`. Conservador: incluye el
 *  caso inconsistente. Un `legado` NO participa del candado de bloque (no es un bloque
 *  todavía) y conserva el comportamiento individual de siempre. */
export function lecturaParaBloqueo(
  res: ResolucionLectura,
): Id<"lecturas"> | null {
  return esDeBloque(res) ? res.lecturaId : null;
}

/** La lectura a la que se puede ENLAZAR/atribuir el chip, o `null`. Excluye el caso
 *  inconsistente a propósito. */
export function lecturaParaEnlace(
  res: ResolucionLectura,
): Id<"lecturas"> | null {
  if (res.tipo === "bloque" || res.tipo === "legado") return res.lecturaId;
  return null;
}
