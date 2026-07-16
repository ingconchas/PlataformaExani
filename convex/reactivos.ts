import { query, type QueryCtx } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireStaff } from "./authz";

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
  ctx: QueryCtx,
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
