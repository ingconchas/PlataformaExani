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

type Ctx = QueryCtx | MutationCtx;

/**
 * Banco de reactivos (LUI-14) — la lista institucional. Todo el staff (admin e
 * instructor) ve el banco COMPLETO; cada reactivo muestra su autor. El filtrado,
 * el orden y la paginación viven en el CLIENTE (molde uniforme del repo, ver
 * `app/admin/alumnos/alumnos-client.tsx`): estas queries entregan los datos crudos
 * enriquecidos y el cliente los recorta.
 *
 * Por qué el candado va en `enUso` y no dentro de `listar`: son dos presupuestos de
 * lectura INDEPENDIENTES (cada query ≤ 8 MiB). `listar` lee `reactivos`; `enUso` lee
 * los exámenes publicados. Además `enUso` no depende del usuario → misma respuesta
 * para todos, más cacheable.
 */

/** Nombre visible de un perfil (mismo formato que `sesion.actual`). */
function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/**
 * Los reactivos con edición BLOQUEADA: los que pertenecen a un examen **publicado
 * con al menos una asignación**. Regla del AC («publicado con asignaciones»,
 * congelamiento por compromiso del examen). NO se filtra por `abreEn`: una
 * asignación futura ya compromete el examen, así que basta su EXISTENCIA por
 * `by_examen` (distinto del `metricas.fueAplicada = abreEn <= ahora`, que es
 * «aplicado», no «comprometido»). Acotado por el número de exámenes publicados.
 */
async function reactivosBloqueados(
  ctx: Ctx,
): Promise<Set<Id<"reactivos">>> {
  const publicados = await ctx.db
    .query("examenes")
    .withIndex("by_estado", (q) => q.eq("estado", "publicado"))
    .collect();
  const bloqueados = new Set<Id<"reactivos">>();
  for (const examen of publicados) {
    const asignacion = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen", (q) => q.eq("examenId", examen._id))
      .first();
    if (!asignacion) continue; // publicado SIN asignaciones → no bloquea
    for (const rid of examen.reactivoIds) bloqueados.add(rid);
  }
  return bloqueados;
}

/**
 * El banco completo, en filas LEAN para la lista. Se DEJAN FUERA
 * `opciones`/`opcionCorrecta`/`retroalimentacion`/`imagenId` (van en `obtener`, el
 * preview): aligera el payload al cliente. `esEditable` lo estampa el servidor
 * (admin edita todo; instructor solo lo propio) — el cliente no compara ids.
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const sesion = await requireStaff(ctx);
    const reactivos = await ctx.db.query("reactivos").collect();

    // Mapas id→nombre de la clasificación (3 tablas pequeñas del temario).
    const [secciones, areas, subtemas] = await Promise.all([
      ctx.db.query("secciones").collect(),
      ctx.db.query("areasTematicas").collect(),
      ctx.db.query("subtemas").collect(),
    ]);
    const nombreSeccion = new Map<Id<"secciones">, string>(
      secciones.map((s) => [s._id, s.nombre]),
    );
    const nombreArea = new Map<Id<"areasTematicas">, string>(
      areas.map((a) => [a._id, a.nombre]),
    );
    const nombreSubtema = new Map<Id<"subtemas">, string>(
      subtemas.map((s) => [s._id, s.nombre]),
    );

    // Autores: solo los DISTINTOS presentes (staff, conjunto chico), no toda la
    // tabla `perfiles` (que incluye a los alumnos).
    const autorIds = [...new Set(reactivos.map((r) => r.autorId))];
    const autorPerfiles = await Promise.all(
      autorIds.map((id) =>
        ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first(),
      ),
    );
    const nombrePorAutor = new Map<Id<"users">, string>();
    autorIds.forEach((id, i) => {
      const p = autorPerfiles[i];
      nombrePorAutor.set(id, p ? nombreCompleto(p) : "Autor desconocido");
    });

    // Títulos de lectura (solo las referenciadas). El seed casi nunca las usa.
    const lecturaIds = [
      ...new Set(reactivos.flatMap((r) => (r.lecturaId ? [r.lecturaId] : []))),
    ];
    const lecturas = await Promise.all(lecturaIds.map((id) => ctx.db.get(id)));
    const tituloPorLectura = new Map<Id<"lecturas">, string>();
    lecturaIds.forEach((id, i) => {
      const l = lecturas[i];
      if (l) tituloPorLectura.set(id, l.titulo);
    });

    const esAdmin = sesion.perfil.rol === "admin";
    return reactivos.map((r) => ({
      id: r._id,
      enunciado: r.enunciado,
      dificultad: r.dificultad,
      // Ids de clasificación para el filtro EN CASCADA del cliente (compara por id,
      // no por nombre → inmune a homónimos bajo padres distintos).
      seccionId: r.seccionId,
      areaId: r.areaId,
      subtemaId: r.subtemaId,
      seccionNombre: nombreSeccion.get(r.seccionId) ?? "—",
      areaNombre: nombreArea.get(r.areaId) ?? "—",
      subtemaNombre: nombreSubtema.get(r.subtemaId) ?? "—",
      autorId: r.autorId,
      autorNombre: nombrePorAutor.get(r.autorId) ?? "Autor desconocido",
      tieneLectura: r.lecturaId != null,
      lecturaTitulo: r.lecturaId
        ? (tituloPorLectura.get(r.lecturaId) ?? null)
        : null,
      activo: r.activo,
      esEditable: esAdmin || r.autorId === sesion.userId,
    }));
  },
});

/**
 * Los ids de reactivos con edición bloqueada (§`reactivosBloqueados`). El cliente
 * arma un `Set` y consulta pertenencia por fila. Query aparte a propósito.
 */
export const enUso = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    return [...(await reactivosBloqueados(ctx))];
  },
});

/**
 * Un reactivo COMPLETO para la vista de solo lectura (preview de LUI-14, «revisar
 * antes de usarlo en un examen»). Recibe el id como `string` y lo normaliza → `null`
 * si es malformado o no existe (misma gracia que `grupos.obtener`). Incluye opciones,
 * respuesta correcta, retroalimentación e imagen; y `esEditable`/`enUso` para que el
 * modal ofrezca un enlace a editar cuando aplique.
 */
export const obtener = query({
  args: { reactivoId: v.string() },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const id = ctx.db.normalizeId("reactivos", args.reactivoId);
    if (!id) return null;
    const r = await ctx.db.get(id);
    if (!r) return null;

    const [seccion, area, subtema, autorPerfil, lectura] = await Promise.all([
      ctx.db.get(r.seccionId),
      ctx.db.get(r.areaId),
      ctx.db.get(r.subtemaId),
      ctx.db
        .query("perfiles")
        .withIndex("by_user", (q) => q.eq("userId", r.autorId))
        .first(),
      r.lecturaId ? ctx.db.get(r.lecturaId) : Promise.resolve(null),
    ]);
    const imagenUrl = r.imagenId ? await ctx.storage.getUrl(r.imagenId) : null;
    const enUso = (await reactivosBloqueados(ctx)).has(id);

    return {
      id: r._id,
      enunciado: r.enunciado,
      opciones: r.opciones,
      opcionCorrecta: r.opcionCorrecta,
      retroalimentacion: r.retroalimentacion ?? null,
      dificultad: r.dificultad,
      // Ids para prellenar el formulario de edición (LUI-15); el preview los ignora.
      seccionId: r.seccionId,
      areaId: r.areaId,
      subtemaId: r.subtemaId,
      imagenId: r.imagenId ?? null,
      seccionNombre: seccion?.nombre ?? "—",
      areaNombre: area?.nombre ?? "—",
      subtemaNombre: subtema?.nombre ?? "—",
      autorNombre: autorPerfil ? nombreCompleto(autorPerfil) : "Autor desconocido",
      lecturaTitulo: lectura?.titulo ?? null,
      imagenUrl,
      activo: r.activo,
      esEditable: sesion.perfil.rol === "admin" || r.autorId === sesion.userId,
      enUso,
    };
  },
});

// ── Mutations (LUI-15 · Entrega 1) ───────────────────────────────────────────
// Primer escritor de `reactivos`. Toda escritura: `requireStaff` primero, propiedad
// (instructor solo lo suyo; admin todo) y mantenimiento INCREMENTAL de
// `reactivosCount` (el contrato que LUI-18 dejó para acá, temario.ts:141).

/** Suma `delta` (±1) al contador denormalizado de los 3 ancestros. Cada reactivo cae
 *  en EXACTAMENTE una hoja → preserva `count(sección)=Σcount(áreas)`. */
async function ajustarContadores(
  ctx: MutationCtx,
  clasif: {
    seccionId: Id<"secciones">;
    areaId: Id<"areasTematicas">;
    subtemaId: Id<"subtemas">;
  },
  delta: 1 | -1,
): Promise<void> {
  const seccion = await ctx.db.get(clasif.seccionId);
  if (seccion)
    await ctx.db.patch(clasif.seccionId, {
      reactivosCount: seccion.reactivosCount + delta,
    });
  const area = await ctx.db.get(clasif.areaId);
  if (area)
    await ctx.db.patch(clasif.areaId, {
      reactivosCount: area.reactivosCount + delta,
    });
  const subtema = await ctx.db.get(clasif.subtemaId);
  if (subtema)
    await ctx.db.patch(clasif.subtemaId, {
      reactivosCount: subtema.reactivosCount + delta,
    });
}

const LETRAS = ["a", "b", "c", "d"] as const;
const opcionValidator = v.object({ id: v.string(), texto: v.string() });
const dificultadValidator = v.union(
  v.literal("facil"),
  v.literal("medio"),
  v.literal("dificil"),
);

/**
 * Valida el contenido de un reactivo (opción múltiple) y lo devuelve NORMALIZADO
 * (trims). El cliente refleja estas reglas, pero el servidor es la autoridad: un
 * cliente manipulado no las salta.
 */
function validarContenido(args: {
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  retroalimentacion: string;
}) {
  const enunciado = args.enunciado.trim();
  if (!enunciado) throw new ConvexError("El enunciado es obligatorio.");

  if (args.opciones.length < 3 || args.opciones.length > 4)
    throw new ConvexError("Un reactivo debe tener entre 3 y 4 opciones.");
  const opciones = args.opciones.map((o) => ({ id: o.id, texto: o.texto.trim() }));
  const ids = new Set<string>();
  for (const o of opciones) {
    if (!o.texto) throw new ConvexError("Cada opción debe tener texto.");
    // Ids canónicos a|b|c|d: son la referencia de las respuestas (LUI-104), no se
    // aceptan vacíos ni arbitrarios de un cliente manipulado.
    if (!(LETRAS as readonly string[]).includes(o.id))
      throw new ConvexError("Id de opción inválido.");
    if (ids.has(o.id)) throw new ConvexError("Ids de opción duplicados.");
    ids.add(o.id);
  }
  if (!ids.has(args.opcionCorrecta))
    throw new ConvexError("Debes marcar cuál es la opción correcta.");

  const retroalimentacion = args.retroalimentacion.trim();
  if (!retroalimentacion)
    throw new ConvexError(
      "La explicación de la respuesta correcta es obligatoria.",
    );

  return { enunciado, opciones, opcionCorrecta: args.opcionCorrecta, retroalimentacion };
}

export const crear = mutation({
  args: {
    subtemaId: v.id("subtemas"),
    enunciado: v.string(),
    opciones: v.array(opcionValidator),
    opcionCorrecta: v.string(),
    dificultad: dificultadValidator,
    retroalimentacion: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStaff(ctx);
    const limpio = validarContenido(args);
    // Camino ESTRICTO (default `exigirDisponible:true`): no se clasifica contenido
    // NUEVO en una rama retirada. La clasificación se DERIVA de `subtemaId`.
    const clasificacion = await resolverClasificacion(ctx, args.subtemaId);
    const id = await ctx.db.insert("reactivos", {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      ...clasificacion,
      dificultad: args.dificultad,
      retroalimentacion: limpio.retroalimentacion,
      autorId: userId, // el autor sale de la sesión, nunca del cliente
      activo: true,
    });
    await ajustarContadores(ctx, clasificacion, 1);
    return { id };
  },
});

export const actualizar = mutation({
  args: {
    id: v.id("reactivos"),
    subtemaId: v.id("subtemas"),
    enunciado: v.string(),
    opciones: v.array(opcionValidator),
    opcionCorrecta: v.string(),
    dificultad: dificultadValidator,
    retroalimentacion: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, perfil } = await requireStaff(ctx);
    const r = await ctx.db.get(args.id);
    if (!r) throw new ConvexError("El reactivo no existe.");
    if (perfil.rol !== "admin" && r.autorId !== userId)
      throw new ConvexError("Solo puedes editar tus propios reactivos.");
    // Candado: no se edita el CONTENIDO de un reactivo en un examen vivo (lo
    // corrompería). Desactivarlo sí se permite — eso es `cambiarEstado`.
    if ((await reactivosBloqueados(ctx)).has(args.id))
      throw new ConvexError(
        "Este reactivo está en uso en un examen; no se puede editar, solo desactivar.",
      );
    const limpio = validarContenido(args);

    // Mantener la hoja actual se TOLERA aunque esté retirada; MOVER a otra exige que
    // sea disponible → `exigirDisponible = cambiaSubtema`.
    const cambiaSubtema = args.subtemaId !== r.subtemaId;
    const nueva = await resolverClasificacion(ctx, args.subtemaId, {
      exigirDisponible: cambiaSubtema,
    });
    if (cambiaSubtema) {
      await ajustarContadores(
        ctx,
        { seccionId: r.seccionId, areaId: r.areaId, subtemaId: r.subtemaId },
        -1,
      );
      await ajustarContadores(ctx, nueva, 1);
    }

    await ctx.db.patch(args.id, {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      ...nueva,
      dificultad: args.dificultad,
      retroalimentacion: limpio.retroalimentacion,
    });
    return { id: args.id };
  },
});

/** Baja/alta lógica del reactivo. SIN candado (un reactivo en uso «solo se puede
 *  desactivar», AC) y SIN cambio de contadores (`recalcular` cuenta activos e
 *  inactivos → `activo` es ortogonal al conteo). */
export const cambiarEstado = mutation({
  args: { id: v.id("reactivos"), activo: v.boolean() },
  handler: async (ctx, args) => {
    const { userId, perfil } = await requireStaff(ctx);
    const r = await ctx.db.get(args.id);
    if (!r) throw new ConvexError("El reactivo no existe.");
    if (perfil.rol !== "admin" && r.autorId !== userId)
      throw new ConvexError(
        "Solo puedes cambiar el estado de tus propios reactivos.",
      );
    await ctx.db.patch(args.id, { activo: args.activo });
    return { id: args.id, activo: args.activo };
  },
});
