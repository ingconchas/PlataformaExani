import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireStaff } from "./authz";
import { resolverClasificacion } from "./temario";
import { sanear, aTextoPlano, textoPlanoAHtml } from "./sanitizar";
import {
  MAX_PREGUNTAS,
  expandirBloquesPuro,
  lecturaPublicable,
  porOrdenDeBloque,
  preguntaValidator,
  reordenar,
  validarBloquesCompletosPuro,
  validarTextoBase,
  validarTitulo,
  type BloqueDeLectura,
  type PreguntaOrdenable,
  type ReactivoDeExamen,
} from "./bloque";
import {
  ajustarContadores,
  calcularBloqueo,
  validarContenido,
} from "./reactivos";

/**
 * Lecturas con BLOQUE de preguntas (LUI-17).
 *
 * Reglas que sostienen todo el módulo:
 *  · La LECTURA es el único escritor de la clasificación; sus preguntas la COPIAN. Ninguna
 *    mutation de pregunta acepta `subtemaId`.
 *  · La AUTORÍA de una pregunta es la de su lectura, así que los permisos se comprueban
 *    siempre contra `lectura.autorId`, nunca contra el del reactivo.
 *  · El CANDADO es del bloque: si una pregunta está comprometida en un examen publicado con
 *    asignaciones, se congela la lectura entera. Lo único que sigue permitido es cambiar el
 *    estado (espejo de `reactivos.cambiarEstado`).
 *  · El alta es ATÓMICA (`crear` recibe el bloque completo); la edición es incremental.
 *
 * ⚠️ Ninguna mutation de aquí lleva un solo `v.optional`. Si algún día hace falta añadir un
 * argumento opcional a una mutation de ACTUALIZACIÓN, hereda el problema de LUI-16: `patch`
 * borra el campo al recibir `undefined` y `undefined` desaparece al serializar, así que un
 * cliente viejo borraría datos en silencio. Usa una intención discriminada.
 */

type Ctx = QueryCtx | MutationCtx;

/** Vista ordenable de una pregunta (el `orden` vive dentro de `bloque`). */
function comoOrdenable(r: Doc<"reactivos">): PreguntaOrdenable {
  return {
    _id: r._id,
    _creationTime: r._creationTime,
    orden: r.bloque?.orden ?? 0,
  };
}

/**
 * El bloque de una lectura, YA ORDENADO. **Es el helper que LUI-21 tendrá que llamar**: la
 * regla «la lectura entra completa» se decide con `bloque.ts`, no re-derivada en el
 * constructor.
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

/** ¿La rama de clasificación está DISPONIBLE? Conjuntivo: el nodo y todos sus ancestros. */
function ramaDisponible(
  l: Doc<"lecturas">,
  activos: {
    secciones: Map<Id<"secciones">, boolean>;
    areas: Map<Id<"areasTematicas">, boolean>;
    subtemas: Map<Id<"subtemas">, boolean>;
  },
): boolean {
  if (!l.seccionId || !l.areaId || !l.subtemaId) return false;
  return (
    (activos.secciones.get(l.seccionId) ?? false) &&
    (activos.areas.get(l.areaId) ?? false) &&
    (activos.subtemas.get(l.subtemaId) ?? false)
  );
}

/** La terna de una lectura, o un error claro si todavía no la tiene (dato sembrado antes de
 *  LUI-17: se arregla editándola una vez). */
function ternaDe(l: Doc<"lecturas">) {
  if (!l.seccionId || !l.areaId || !l.subtemaId)
    throw new ConvexError(
      "Esta lectura no tiene clasificación; edítala y elige sección, área y subtema.",
    );
  return { seccionId: l.seccionId, areaId: l.areaId, subtemaId: l.subtemaId };
}

/** Propiedad + existencia de la lectura. La autoridad de TODO el bloque. */
async function lecturaEditable(
  ctx: MutationCtx,
  lecturaId: Id<"lecturas">,
): Promise<Doc<"lecturas">> {
  const { userId, perfil } = await requireStaff(ctx);
  const l = await ctx.db.get(lecturaId);
  if (!l) throw new ConvexError("La lectura no existe.");
  if (perfil.rol !== "admin" && l.autorId !== userId)
    throw new ConvexError("Solo puedes editar tus propias lecturas.");
  return l;
}

/** Candado del bloque. Se consulta con `calcularBloqueo` UNA vez (encadenar los envoltorios
 *  de `reactivos.ts` recorrería la base dos veces). */
async function exigirSinCandado(ctx: MutationCtx, lecturaId: Id<"lecturas">) {
  const { lecturas } = await calcularBloqueo(ctx);
  if (lecturas.has(lecturaId))
    throw new ConvexError(
      "Esta lectura está en uso en un examen; no se puede editar, solo desactivar.",
    );
}

/** La lectura de una pregunta de bloque, o error si el reactivo no pertenece a ninguna. */
async function lecturaDePregunta(
  ctx: MutationCtx,
  reactivoId: Id<"reactivos">,
): Promise<{ reactivo: Doc<"reactivos">; lectura: Doc<"lecturas"> }> {
  const r = await ctx.db.get(reactivoId);
  if (!r) throw new ConvexError("La pregunta no existe.");
  if (!r.bloque)
    throw new ConvexError("Este reactivo no pertenece a una lectura.");
  const lectura = await lecturaEditable(ctx, r.bloque.lecturaId);
  return { reactivo: r, lectura };
}

/** Renumera el bloque a 0..n-1 escribiendo solo lo que cambia. `patch` es superficial y no
 *  admite rutas punteadas, así que se reescribe el objeto `bloque` entero. */
async function renumerar(
  ctx: MutationCtx,
  lecturaId: Id<"lecturas">,
  preguntas: Doc<"reactivos">[],
) {
  const ordenadas = [...preguntas].sort((a, b) =>
    porOrdenDeBloque(comoOrdenable(a), comoOrdenable(b)),
  );
  for (let k = 0; k < ordenadas.length; k++) {
    if (ordenadas[k].bloque?.orden === k) continue;
    await ctx.db.patch(ordenadas[k]._id, { bloque: { lecturaId, orden: k } });
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Listado de lecturas para el staff. Institucional completo, con `esEditable` estampado por
 *  el servidor (mismo molde que el banco: el cliente no compara ids). */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const sesion = await requireStaff(ctx);
    const lecturas = await ctx.db.query("lecturas").collect();

    const [secciones, areas, subtemas] = await Promise.all([
      ctx.db.query("secciones").collect(),
      ctx.db.query("areasTematicas").collect(),
      ctx.db.query("subtemas").collect(),
    ]);
    const activos = {
      secciones: new Map(secciones.map((s) => [s._id, s.activo])),
      areas: new Map(areas.map((a) => [a._id, a.activo])),
      subtemas: new Map(subtemas.map((s) => [s._id, s.activo])),
    };
    const nombre = {
      secciones: new Map(secciones.map((s) => [s._id, s.nombre])),
      areas: new Map(areas.map((a) => [a._id, a.nombre])),
      subtemas: new Map(subtemas.map((s) => [s._id, s.nombre])),
    };

    const bloques = await Promise.all(
      lecturas.map((l) => reactivosDeLectura(ctx, l._id)),
    );
    const { lecturas: congeladas } = await calcularBloqueo(ctx);

    const autorIds = [...new Set(lecturas.map((l) => l.autorId))];
    const perfiles = await Promise.all(
      autorIds.map((id) =>
        ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first(),
      ),
    );
    const nombrePorAutor = new Map(
      autorIds.map((id, i) => {
        const p = perfiles[i];
        return [
          id,
          p ? [p.nombre, p.apellidos].filter(Boolean).join(" ") : "Autor desconocido",
        ];
      }),
    );

    const esAdmin = sesion.perfil.rol === "admin";
    return lecturas.map((l, i) => {
      const bloque = bloques[i];
      const activas = bloque.filter((r) => r.activo).length;
      return {
        id: l._id,
        titulo: l.titulo,
        // Extracto en TEXTO PLANO para la celda: el listado no pinta HTML.
        extracto: (l.contenidoFormato === "html"
          ? aTextoPlano(l.contenido)
          : l.contenido
        ).slice(0, 160),
        seccionNombre: l.seccionId
          ? (nombre.secciones.get(l.seccionId) ?? "—")
          : "—",
        areaNombre: l.areaId ? (nombre.areas.get(l.areaId) ?? "—") : "—",
        subtemaNombre: l.subtemaId
          ? (nombre.subtemas.get(l.subtemaId) ?? "—")
          : "—",
        seccionId: l.seccionId ?? null,
        areaId: l.areaId ?? null,
        subtemaId: l.subtemaId ?? null,
        dificultad: l.dificultad ?? null,
        preguntas: bloque.length,
        publicable: lecturaPublicable({
          preguntas: bloque.length,
          activas,
          lecturaActiva: l.activo ?? true,
          clasificacionDisponible: ramaDisponible(l, activos),
        }),
        activo: l.activo ?? true,
        enUso: congeladas.has(l._id),
        autorNombre: nombrePorAutor.get(l.autorId) ?? "Autor desconocido",
        esEditable: esAdmin || l.autorId === sesion.userId,
      };
    });
  },
});

/** Una lectura COMPLETA con su bloque, para la pantalla de edición. Recibe el id como
 *  `string` y lo normaliza → `null` si es malformado o no existe (misma gracia que
 *  `reactivos.obtener`). */
export const obtener = query({
  args: { lecturaId: v.string() },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const id = ctx.db.normalizeId("lecturas", args.lecturaId);
    if (!id) return null;
    const l = await ctx.db.get(id);
    if (!l) return null;

    const bloque = await reactivosDeLectura(ctx, id);
    const { lecturas: congeladas } = await calcularBloqueo(ctx);
    const [seccion, area, subtema] = await Promise.all([
      l.seccionId ? ctx.db.get(l.seccionId) : Promise.resolve(null),
      l.areaId ? ctx.db.get(l.areaId) : Promise.resolve(null),
      l.subtemaId ? ctx.db.get(l.subtemaId) : Promise.resolve(null),
    ]);

    return {
      id: l._id,
      titulo: l.titulo,
      // SIEMPRE HTML seguro: si ya es HTML → `sanear` (defensa en profundidad ante edición
      // manual de la base); si es legado → `textoPlanoAHtml`, que escapa el `<` literal.
      contenido:
        l.contenidoFormato === "html"
          ? sanear(l.contenido)
          : textoPlanoAHtml(l.contenido),
      seccionId: l.seccionId ?? null,
      areaId: l.areaId ?? null,
      subtemaId: l.subtemaId ?? null,
      dificultad: l.dificultad ?? null,
      activo: l.activo ?? true,
      enUso: congeladas.has(id),
      esEditable:
        sesion.perfil.rol === "admin" || l.autorId === sesion.userId,
      clasificacionDisponible: Boolean(
        seccion?.activo && area?.activo && subtema?.activo,
      ),
      preguntas: bloque.map((r) => ({
        id: r._id,
        orden: r.bloque?.orden ?? 0,
        // Mismo contrato que `reactivos.obtener`: el editor y la vista previa nunca ven un
        // `<` literal como tag.
        enunciado:
          r.contenidoFormato === "html"
            ? sanear(r.enunciado)
            : textoPlanoAHtml(r.enunciado),
        opciones: r.opciones,
        opcionCorrecta: r.opcionCorrecta,
        retroalimentacion:
          r.retroalimentacion == null
            ? null
            : r.contenidoFormato === "html"
              ? sanear(r.retroalimentacion)
              : textoPlanoAHtml(r.retroalimentacion),
        dificultad: r.dificultad,
        activo: r.activo,
      })),
    };
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Alta ATÓMICA: la lectura y su bloque entran en una sola transacción. En el alta el bloque
 * vive en el estado del formulario y se persiste entero — así cancelar no deja borradores
 * involuntarios y un fallo parcial no pierde preguntas.
 *
 * TODA la validación ocurre ANTES de la primera escritura; lo demás lo garantiza la
 * transacción de Convex.
 */
export const crear = mutation({
  args: {
    titulo: v.string(),
    contenido: v.string(),
    subtemaId: v.id("subtemas"),
    dificultad: v.union(
      v.literal("facil"),
      v.literal("medio"),
      v.literal("dificil"),
    ),
    preguntas: v.array(preguntaValidator),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStaff(ctx);
    const titulo = validarTitulo(args.titulo);
    const contenido = validarTextoBase(args.contenido);
    if (args.preguntas.length > MAX_PREGUNTAS)
      throw new ConvexError(
        `Una lectura admite como máximo ${MAX_PREGUNTAS} preguntas.`,
      );
    const limpias = args.preguntas.map((p) => validarContenido(p));
    // Camino ESTRICTO: crear contenido en una rama retirada no se permite (la excepción del
    // repo es EDITAR contenido histórico manteniendo su hoja, no crear).
    const clasificacion = await resolverClasificacion(ctx, args.subtemaId);

    const lecturaId = await ctx.db.insert("lecturas", {
      titulo,
      contenido,
      contenidoFormato: "html",
      ...clasificacion,
      dificultad: args.dificultad,
      autorId: userId,
      activo: true,
    });
    for (let i = 0; i < limpias.length; i++) {
      await ctx.db.insert("reactivos", {
        enunciado: limpias[i].enunciado,
        opciones: limpias[i].opciones,
        opcionCorrecta: limpias[i].opcionCorrecta,
        ...clasificacion,
        dificultad: args.preguntas[i].dificultad,
        retroalimentacion: limpias[i].retroalimentacion,
        contenidoFormato: "html",
        bloque: { lecturaId, orden: i },
        autorId: userId, // = autor de la lectura
        activo: true,
      });
    }
    if (limpias.length)
      await ajustarContadores(ctx, clasificacion, limpias.length);
    return { id: lecturaId };
  },
});

/** Edita la lectura. Si cambia de subtema, MUEVE el bloque entero y ajusta los contadores con
 *  ±n en una sola operación por nivel. */
export const actualizar = mutation({
  args: {
    id: v.id("lecturas"),
    titulo: v.string(),
    contenido: v.string(),
    subtemaId: v.id("subtemas"),
    dificultad: v.union(
      v.literal("facil"),
      v.literal("medio"),
      v.literal("dificil"),
    ),
  },
  handler: async (ctx, args) => {
    const l = await lecturaEditable(ctx, args.id);
    await exigirSinCandado(ctx, args.id);
    const titulo = validarTitulo(args.titulo);
    const contenido = validarTextoBase(args.contenido);

    // Mantener una hoja retirada se TOLERA; mover a otra exige que sea disponible — mismo
    // matiz que `reactivos.actualizar`. Sin él, una lectura histórica sería inmutable.
    const cambiaSubtema = args.subtemaId !== l.subtemaId;
    const nueva = await resolverClasificacion(ctx, args.subtemaId, {
      exigirDisponible: cambiaSubtema,
    });

    await ctx.db.patch(args.id, {
      titulo,
      contenido,
      contenidoFormato: "html",
      ...nueva,
      dificultad: args.dificultad,
    });

    if (cambiaSubtema) {
      const bloque = await reactivosDeLectura(ctx, args.id);
      for (const r of bloque) await ctx.db.patch(r._id, nueva);
      if (bloque.length) {
        if (l.seccionId && l.areaId && l.subtemaId)
          await ajustarContadores(
            ctx,
            { seccionId: l.seccionId, areaId: l.areaId, subtemaId: l.subtemaId },
            -bloque.length,
          );
        await ajustarContadores(ctx, nueva, bloque.length);
      }
    }
    return { id: args.id };
  },
});

/** Baja/alta lógica de la lectura. SIN candado, espejo de `reactivos.cambiarEstado`: una
 *  lectura en uso «solo se puede desactivar». NO cascadea a sus preguntas — la cascada de
 *  escritura es irreversible (el repo ya la rechazó en el temario); la disponibilidad
 *  efectiva del bloque se calcula al leer, en `lecturaPublicable`. */
export const cambiarEstado = mutation({
  args: { id: v.id("lecturas"), activo: v.boolean() },
  handler: async (ctx, args) => {
    await lecturaEditable(ctx, args.id);
    await ctx.db.patch(args.id, { activo: args.activo });
    return { id: args.id, activo: args.activo };
  },
});

/** Añade una pregunta al final del bloque. Copia la clasificación de la lectura y hereda su
 *  autor. NO acepta `subtemaId`: el argumento no existe. */
export const agregarPregunta = mutation({
  args: { lecturaId: v.id("lecturas"), ...preguntaValidator.fields },
  handler: async (ctx, args) => {
    const l = await lecturaEditable(ctx, args.lecturaId);
    await exigirSinCandado(ctx, args.lecturaId);
    const bloque = await reactivosDeLectura(ctx, args.lecturaId);
    if (bloque.length >= MAX_PREGUNTAS)
      throw new ConvexError(
        `Una lectura admite como máximo ${MAX_PREGUNTAS} preguntas.`,
      );
    const limpio = validarContenido(args);
    // Agregar es CREAR, no editar: camino estricto. Si la rama se retiró, hay que mover la
    // lectura antes de seguir añadiéndole preguntas.
    const clasificacion = await resolverClasificacion(ctx, ternaDe(l).subtemaId);

    const id = await ctx.db.insert("reactivos", {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      ...clasificacion,
      dificultad: args.dificultad,
      retroalimentacion: limpio.retroalimentacion,
      contenidoFormato: "html",
      // `bloque.length` es la posición TENTATIVA; la renumeración de abajo la corrige.
      bloque: { lecturaId: args.lecturaId, orden: bloque.length },
      autorId: l.autorId, // la autoría es la de la LECTURA
      activo: true,
    });
    await ajustarContadores(ctx, clasificacion, 1);
    // ⚠️ Renumerar TAMBIÉN al agregar: si el `orden` persistido venía corrupto (p. ej.
    // `[0,0,5]` por edición manual), `bloque.length` daría 2 y la banda seguiría sin ser
    // densa ni la nueva pregunta quedaría al final visual. «Renumerar en cada escritura» es
    // la disciplina que sustituye al constraint único que un `.index()` NO da.
    await renumerar(ctx, args.lecturaId, await reactivosDeLectura(ctx, args.lecturaId));
    return { id };
  },
});

/** Edita una pregunta del bloque. CONSERVA su clasificación (editar contenido histórico sí
 *  vale) y no admite moverla de subtema. */
export const actualizarPregunta = mutation({
  args: { reactivoId: v.id("reactivos"), ...preguntaValidator.fields },
  handler: async (ctx, args) => {
    const { lectura } = await lecturaDePregunta(ctx, args.reactivoId);
    await exigirSinCandado(ctx, lectura._id);
    const limpio = validarContenido(args);
    await ctx.db.patch(args.reactivoId, {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      retroalimentacion: limpio.retroalimentacion,
      dificultad: args.dificultad,
      contenidoFormato: "html",
    });
    return { id: args.reactivoId };
  },
});

/** Quita una pregunta del bloque y renumera. Se permite dejar la lectura en 0 o 1: el mínimo
 *  de 2 es invariante de PUBLICACIÓN, no de edición. */
export const quitarPregunta = mutation({
  args: { reactivoId: v.id("reactivos") },
  handler: async (ctx, args) => {
    const { reactivo, lectura } = await lecturaDePregunta(ctx, args.reactivoId);
    await exigirSinCandado(ctx, lectura._id);
    const clasificacion = {
      seccionId: reactivo.seccionId,
      areaId: reactivo.areaId,
      subtemaId: reactivo.subtemaId,
    };
    await ctx.db.delete(args.reactivoId);
    await ajustarContadores(ctx, clasificacion, -1);
    await renumerar(ctx, lectura._id, await reactivosDeLectura(ctx, lectura._id));
    return { id: lectura._id };
  },
});

/** Sube o baja una pregunta dentro del bloque y renumera densamente 0..n-1. */
export const moverPregunta = mutation({
  args: {
    reactivoId: v.id("reactivos"),
    direccion: v.union(v.literal("arriba"), v.literal("abajo")),
  },
  handler: async (ctx, args) => {
    const { lectura } = await lecturaDePregunta(ctx, args.reactivoId);
    await exigirSinCandado(ctx, lectura._id);
    // La banda COMPLETA se lee dentro de la transacción y el cliente no manda posiciones
    // calculadas: así el OCC de Convex resuelve dos reordenamientos simultáneos reintentando
    // el segundo sobre el estado nuevo, sin corromper.
    const bloque = await reactivosDeLectura(ctx, lectura._id);
    const nuevo = reordenar(
      bloque.map(comoOrdenable),
      args.reactivoId,
      args.direccion,
    );
    if (!nuevo) return { movido: false };
    for (const { _id, orden } of nuevo) {
      const actual = bloque.find((r) => r._id === _id);
      if (actual?.bloque?.orden === orden) continue;
      await ctx.db.patch(_id as Id<"reactivos">, {
        bloque: { lecturaId: lectura._id, orden },
      });
    }
    return { movido: true };
  },
});

/** Baja/alta lógica de una pregunta del bloque. Autorizada contra la LECTURA, no contra el
 *  autor del reactivo — es la puerta que `reactivos.cambiarEstado` cerró. SIN candado: bajo
 *  candado es la ÚNICA operación permitida sobre el bloque. */
export const cambiarEstadoPregunta = mutation({
  args: { reactivoId: v.id("reactivos"), activo: v.boolean() },
  handler: async (ctx, args) => {
    await lecturaDePregunta(ctx, args.reactivoId);
    await ctx.db.patch(args.reactivoId, { activo: args.activo });
    return { id: args.reactivoId, activo: args.activo };
  },
});

// ── Helpers que hereda el constructor de exámenes (LUI-21) ───────────────────

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
