import { type QueryCtx, type MutationCtx } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  MSG_BLOQUE_DESORDENADO,
  MSG_BLOQUE_PARCIAL,
  expandirBloquesPuro,
  porOrdenDeBloque,
  validarBloquesCompletosPuro,
  type BloqueDeLectura,
  type PreguntaOrdenable,
  type ReactivoDeExamen,
} from "./bloque";
import {
  MAX_DURACION_MIN,
  MAX_REACTIVOS,
  MAX_TITULO,
  tipoDeEstructura,
  validarAgrupacion,
  validarEstructura,
  type SeccionDeExamen,
} from "./constructorExamen";
import { aTextoPlano } from "./sanitizar";
import type { TipoExamen } from "./examenEstado";

/**
 * Lo que un ESCRITOR de examen necesita, en un módulo servidor NEUTRAL (LUI-21 B).
 *
 * Por qué existe: `lecturas.ts` importa de `reactivos.ts`, así que `reactivos.ts` (el
 * crear-directo escribe en el examen destino) NO puede importar los helpers de bloque desde
 * `lecturas.ts` sin cerrar el ciclo `reactivos ↔ lecturas` — exactamente el ciclo que
 * `lecturaCompat.ts` existe para evitar. Este módulo importa solo los PUROS (`bloque.ts`,
 * `constructorExamen.ts`, `sanitizar.ts`) + `_generated`; jamás `lecturas.ts`,
 * `reactivos.ts` ni `examenes.ts`. Lo consumen los tres escritores (`examenes.crear`,
 * `examenes.actualizar`, `reactivos.crear` con destino), `examenes.publicar` — y
 * **LUI-22**: `asignar` debe re-ejecutar `validarPublicable` COMPLETO antes de crear la
 * asignación (un publicado sin compromisos no está congelado y pudo degradarse), y puede
 * importarlo de aquí sin tocar `examenes.ts`.
 *
 * Los helpers de bloque (`mapasDeBloque`, `expandirBloques`, `validarBloquesCompletos`,
 * `reactivosDeLectura`) se MUDARON aquí desde `lecturas.ts` en LUI-21 B — refactor sin
 * cambio de comportamiento; `lecturas.ts` los importa de aquí.
 */

type Ctx = QueryCtx | MutationCtx;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de bloque (mudados de lecturas.ts — mismo comportamiento)
// ─────────────────────────────────────────────────────────────────────────────

/** Vista ordenable de una pregunta (el `orden` vive dentro de `bloque`). Exportada porque
 *  `lecturas.ts` también la usa (renumerar/reordenar) — una sola definición. */
export function comoOrdenable(r: Doc<"reactivos">): PreguntaOrdenable {
  return {
    _id: r._id,
    _creationTime: r._creationTime,
    orden: r.bloque?.orden ?? 0,
  };
}

/**
 * El bloque de una lectura, YA ORDENADO. La regla «la lectura entra completa» se decide con
 * `bloque.ts`, no re-derivada en cada consumidor.
 */
export async function reactivosDeLectura(
  ctx: Ctx,
  lecturaId: Id<"lecturas">,
): Promise<Doc<"reactivos">[]> {
  const bloque = await ctx.db
    .query("reactivos")
    .withIndex("by_bloque", (q) => q.eq("bloque.lecturaId", lecturaId))
    .collect();
  // El índice ya los entrega por `orden`, pero se reordena con el desempate estable: el
  // `orden` persistido puede traer empates si alguien editó a mano la base.
  return [...bloque].sort((a, b) =>
    porOrdenDeBloque(comoOrdenable(a), comoOrdenable(b)),
  );
}

/**
 * Carga los mapas que los helpers puros necesitan.
 *
 * ⚠️ Resuelve el DOCUMENTO de cada lectura, no solo sus preguntas: el índice `by_bloque`
 * encuentra las huérfanas de una lectura borrada, así que sin `ctx.db.get` la frontera vería
 * un bloque no vacío y aceptaría una lectura fantasma. Y carga la disponibilidad conjuntiva
 * de la clasificación, que es parte de la elegibilidad.
 */
async function mapasDeBloque(ctx: Ctx, ids: Id<"reactivos">[]) {
  const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
  const porId = new Map<string, ReactivoDeExamen>();
  const lecturas = new Set<Id<"lecturas">>();
  for (const r of docs) {
    if (!r) continue;
    porId.set(r._id, { _id: r._id, bloque: r.bloque });
    if (r.bloque) lecturas.add(r.bloque.lecturaId);
  }
  const idsLectura = [...lecturas];
  const [docsLectura, bloques] = await Promise.all([
    Promise.all(idsLectura.map((id) => ctx.db.get(id))),
    Promise.all(idsLectura.map((id) => reactivosDeLectura(ctx, id))),
  ]);
  const disponibles = await Promise.all(
    docsLectura.map(async (l) => {
      if (!l?.seccionId || !l.areaId || !l.subtemaId) return false;
      const [s, a, sub] = await Promise.all([
        ctx.db.get(l.seccionId),
        ctx.db.get(l.areaId),
        ctx.db.get(l.subtemaId),
      ]);
      return Boolean(s?.activo && a?.activo && sub?.activo);
    }),
  );

  const bloquePorLectura = new Map<string, BloqueDeLectura>();
  idsLectura.forEach((id, i) => {
    const l = docsLectura[i];
    bloquePorLectura.set(id, {
      existe: l !== null,
      preguntas: bloques[i].map(comoOrdenable),
      activas: bloques[i].filter((r) => r.activo).length,
      lecturaActiva: l?.activo ?? false,
      clasificacionDisponible: disponibles[i],
    });
  });
  return { porId, bloquePorLectura };
}

/** Expande los ids para que cada bloque entre COMPLETO y en orden, conservando el orden
 *  relativo del examen. Lo llama el constructor al AGREGAR. */
export async function expandirBloques(
  ctx: Ctx,
  ids: Id<"reactivos">[],
): Promise<Id<"reactivos">[]> {
  const { porId, bloquePorLectura } = await mapasDeBloque(ctx, ids);
  return expandirBloquesPuro(ids, porId, bloquePorLectura) as Id<"reactivos">[];
}

/** La frontera de publicación: lanza si algún bloque quedaría partido, repetido, desordenado
 *  o con el `orden` corrupto en la base. */
export async function validarBloquesCompletos(
  ctx: Ctx,
  ids: Id<"reactivos">[],
): Promise<void> {
  const { porId, bloquePorLectura } = await mapasDeBloque(ctx, ids);
  const problema = validarBloquesCompletosPuro(ids, porId, bloquePorLectura);
  if (problema) throw new ConvexError(problema);
}

// ─────────────────────────────────────────────────────────────────────────────
// La frontera COMPARTIDA de guardado (los tres escritores)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida una escritura de contenido del examen y devuelve lo que se persiste: los ids (tal
 * como llegaron — ver abajo) y el `tipo` calculado de la estructura. La atraviesan los TRES
 * escritores: `examenes.crear`, `examenes.actualizar` y el crear-directo de
 * `reactivos.crear` (que construye el arreglo CANDIDATO con el reactivo nuevo ya insertado
 * en su posición y lo valida completo).
 *
 * Orden DELIBERADO:
 *  1. Sobre la entrada CRUDA, antes de leer un solo reactivo: tope, unicidad, estructura.
 *     Un examen no puede costarle a la base más de `MAX_REACTIVOS` gets por culpa de un
 *     cliente que manda miles de ids.
 *  2. Secciones declaradas EXISTEN. Una retirada (inactiva) YA presente se TOLERA: el autor
 *     debe poder abrir y reorganizar un borrador cuya sección retiraron; el selector del
 *     cliente solo ofrece disponibles + la ya elegida, y `validarPublicable` sí la rechaza.
 *  3. Docs de reactivos (≤ MAX_REACTIVOS gets) + `validarAgrupacion` sobre la entrada
 *     cruda: fantasma, repetido, sección no declarada, intercalado, rachas fuera de orden.
 *  4. **La expansión de bloques como VALIDADOR, nunca como normalizador**: si
 *     `expandirBloques` produce algo distinto de la entrada (longitud u orden), se RECHAZA
 *     con el mensaje de `bloque.ts` — normalizar en silencio escondería un bug del cliente.
 *     El cliente honesto jamás lo ve: su estado maneja bloques como unidad y los
 *     reconstruye de datos vivos al hidratar (si la lectura ganó una hermana, el
 *     constructor ya la muestra y la manda). Aquí NO se exige que el bloque sea
 *     *publicable* (MIN/MAX/activas) — «mínimo para PUBLICAR, no para editar» (`bloque.ts`).
 *  5. `tipo = tipoDeEstructura(...)` — el tipo JAMÁS viaja del cliente; se calcula de la
 *     estructura declarada y el llamador lo escribe EXPLÍCITO (nunca `undefined`).
 */
export async function validarGuardado(
  ctx: Ctx,
  entrada: {
    secciones: SeccionDeExamen[];
    reactivoIds: Id<"reactivos">[];
  },
): Promise<{ ids: Id<"reactivos">[]; tipo: TipoExamen }> {
  // 1 · Entrada CRUDA.
  if (entrada.reactivoIds.length > MAX_REACTIVOS)
    throw new ConvexError(
      `El examen admite hasta ${MAX_REACTIVOS} reactivos.`,
    );
  if (new Set(entrada.reactivoIds).size !== entrada.reactivoIds.length)
    throw new ConvexError("El examen tiene un reactivo repetido.");
  validarEstructura(entrada.secciones);

  // 2 · Secciones declaradas existen (retirada presente = tolerada, ver docblock).
  const docsSecciones = await Promise.all(
    entrada.secciones.map((s) => ctx.db.get(s.seccionId)),
  );
  const estructura: {
    seccionId: Id<"secciones">;
    tipoSeccion: "nucleo" | "modulo";
  }[] = [];
  entrada.secciones.forEach((s, i) => {
    const doc = docsSecciones[i];
    if (!doc)
      throw new ConvexError(
        "Una sección de la estructura ya no existe en el temario.",
      );
    estructura.push({ seccionId: s.seccionId, tipoSeccion: doc.tipo });
  });

  // 3 · Docs de reactivos + agrupación sobre la entrada cruda.
  const docs = await Promise.all(
    entrada.reactivoIds.map((id) => ctx.db.get(id)),
  );
  const seccionDe = new Map<string, string>();
  for (const r of docs) if (r) seccionDe.set(r._id, r.seccionId);
  const problema = validarAgrupacion(
    entrada.reactivoIds,
    seccionDe,
    entrada.secciones.map((s) => s.seccionId),
  );
  if (problema) throw new ConvexError(problema);

  // 4 · Expansión como validador.
  const expandido = await expandirBloques(ctx, entrada.reactivoIds);
  if (expandido.length !== entrada.reactivoIds.length)
    throw new ConvexError(MSG_BLOQUE_PARCIAL);
  if (expandido.some((id, i) => id !== entrada.reactivoIds[i]))
    throw new ConvexError(MSG_BLOQUE_DESORDENADO);

  // 5 · El tipo, de la estructura.
  return { ids: entrada.reactivoIds, tipo: tipoDeEstructura(estructura) };
}

// ─────────────────────────────────────────────────────────────────────────────
// La frontera de PUBLICACIÓN (y de ASIGNACIÓN, LUI-22)
// ─────────────────────────────────────────────────────────────────────────────

/** Etiqueta corta de un reactivo para mensajes de error (texto plano, truncado). */
function etiquetaDe(r: Doc<"reactivos">): string {
  const texto =
    r.contenidoFormato === "html" ? aTextoPlano(r.enunciado) : r.enunciado;
  const plano = texto.trim();
  return plano.length > 60 ? `${plano.slice(0, 57)}…` : plano;
}

/**
 * Las guardas de CONTENIDO de `examenes.publicar`, con mensajes nombrados y en orden. Se
 * exporta para que **LUI-22 las re-ejecute en `asignar`**: nada de lo que se valida aquí
 * está garantizado DESPUÉS de publicar (un publicado sin compromisos no congela —
 * reclasificaciones, desactivaciones y retiros del temario pueden degradarlo antes de la
 * primera asignación; asignar crea el compromiso y el candado entra).
 *
 * Título y duración se RE-validan completos aunque el guardado ya los validó: defensa, no
 * confianza. Las METAS no se miran: son convención de armado, la confirmación de faltantes
 * es exclusiva del cliente.
 */
export async function validarPublicable(
  ctx: Ctx,
  examen: Doc<"examenes">,
): Promise<void> {
  // 1 · Título y duración, validación COMPLETA.
  const titulo = examen.titulo.trim();
  if (!titulo)
    throw new ConvexError("El examen necesita un nombre antes de publicarse.");
  if (titulo.length > MAX_TITULO)
    throw new ConvexError(
      `El nombre del examen supera los ${MAX_TITULO} caracteres.`,
    );
  if (
    !Number.isInteger(examen.duracionMin) ||
    examen.duracionMin <= 0 ||
    examen.duracionMin > MAX_DURACION_MIN
  )
    throw new ConvexError("El tiempo límite del examen no es válido.");

  // 2 · Reactivos: 1..MAX, sin repetidos.
  if (examen.reactivoIds.length === 0)
    throw new ConvexError(
      "El examen no tiene reactivos; necesita al menos una sección con reactivos antes de publicarse.",
    );
  if (examen.reactivoIds.length > MAX_REACTIVOS)
    throw new ConvexError(
      `El examen admite hasta ${MAX_REACTIVOS} reactivos.`,
    );
  if (new Set(examen.reactivoIds).size !== examen.reactivoIds.length)
    throw new ConvexError("El examen tiene un reactivo repetido.");

  const docs = await Promise.all(
    examen.reactivoIds.map((id) => ctx.db.get(id)),
  );

  // 3 · Estructura, si la hay (AUSENTE = legado: se tolera, no se exige).
  if (examen.secciones) {
    validarEstructura(examen.secciones);
    const docsSecciones = await Promise.all(
      examen.secciones.map((s) => ctx.db.get(s.seccionId)),
    );
    for (const doc of docsSecciones) {
      if (!doc)
        throw new ConvexError(
          "Una sección de la estructura ya no existe en el temario.",
        );
      // A diferencia del guardado, aquí una sección retirada SÍ bloquea — aunque esté
      // vacía: publicar un examen cuya estructura anuncia una sección que el temario
      // retiró es publicar un índice que miente.
      if (!doc.activo)
        throw new ConvexError(
          `La sección «${doc.nombre}» está retirada del temario; quítala de la estructura o reactívala antes de publicar.`,
        );
    }
    const seccionDe = new Map<string, string>();
    for (const r of docs) if (r) seccionDe.set(r._id, r.seccionId);
    const problema = validarAgrupacion(
      examen.reactivoIds,
      seccionDe,
      examen.secciones.map((s) => s.seccionId),
    );
    if (problema) throw new ConvexError(problema);
  }

  // 4 · Cada reactivo: existe, activo, clasificación DISPONIBLE (conjuntiva) — simetría
  // exacta con `lecturaPublicable` para los sueltos. Las 3 tablas del temario son chicas:
  // se coleccionan una vez y se consulta en memoria.
  const [secciones, areas, subtemas] = await Promise.all([
    ctx.db.query("secciones").collect(),
    ctx.db.query("areasTematicas").collect(),
    ctx.db.query("subtemas").collect(),
  ]);
  const activoSeccion = new Map(secciones.map((s) => [s._id, s.activo]));
  const activoArea = new Map(areas.map((a) => [a._id, a.activo]));
  const activoSubtema = new Map(subtemas.map((s) => [s._id, s.activo]));
  for (let i = 0; i < examen.reactivoIds.length; i++) {
    const r = docs[i];
    if (!r)
      throw new ConvexError(
        "El examen referencia un reactivo que ya no existe.",
      );
    if (!r.activo)
      throw new ConvexError(
        `El reactivo «${etiquetaDe(r)}» está desactivado; actívalo o quítalo antes de publicar.`,
      );
    const disponible =
      (activoSeccion.get(r.seccionId) ?? false) &&
      (activoArea.get(r.areaId) ?? false) &&
      (activoSubtema.get(r.subtemaId) ?? false);
    if (!disponible)
      throw new ConvexError(
        `El reactivo «${etiquetaDe(r)}» cuelga de una rama retirada del temario; reclasifícalo o quítalo antes de publicar.`,
      );
  }

  // 5 · Bloques de lectura: completos, contiguos, en orden y PUBLICABLES.
  await validarBloquesCompletos(ctx, examen.reactivoIds);
}
