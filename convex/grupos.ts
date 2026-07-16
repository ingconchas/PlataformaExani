import {
  query,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./authz";
import { fueAplicada } from "./metricas";

// ── Helpers ────────────────────────────────────────────────────────────────

function nombreCompleto(nombre: string, apellidos?: string): string {
  return [nombre, apellidos].filter(Boolean).join(" ");
}

/** Forma canónica para comparar identidad: sin espacios extremos ni dobles, en
 *  minúsculas locales. Así "Matutino A", "matutino a" y "Matutino  A" colisionan. */
function canonizar(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

/** Deduplica preservando el orden. */
function dedupeUsuarios(ids: Id<"users">[]): Id<"users">[] {
  const vistos = new Set<string>();
  const unicos: Id<"users">[] = [];
  for (const id of ids) {
    if (!vistos.has(id)) {
      vistos.add(id);
      unicos.push(id);
    }
  }
  return unicos;
}

/** Valida que un id sea un instructor existente y ACTIVO. */
async function validarInstructorActivo(
  ctx: MutationCtx,
  id: Id<"users">,
): Promise<void> {
  const perfil = await ctx.db
    .query("perfiles")
    .withIndex("by_user", (q) => q.eq("userId", id))
    .first();
  if (!perfil || perfil.rol !== "instructor" || !perfil.activo) {
    throw new ConvexError(
      "Uno de los instructores seleccionados no existe o está inactivo.",
    );
  }
}

/** Alta: deduplica, exige ≥1 y valida que TODOS estén activos. */
async function validarInstructores(
  ctx: MutationCtx,
  ids: Id<"users">[],
): Promise<Id<"users">[]> {
  const unicos = dedupeUsuarios(ids);
  if (unicos.length === 0) {
    throw new ConvexError("Asigna al menos un instructor al grupo.");
  }
  for (const id of unicos) await validarInstructorActivo(ctx, id);
  return unicos;
}

/** Unicidad de (nombre, ciclo) por comparación canónica. Convex no ofrece índice
 *  único; se refuerza aquí (pocos grupos → `.collect()` es suficiente). */
async function validarNombreCicloUnico(
  ctx: MutationCtx,
  nombre: string,
  ciclo: string,
  exceptId?: Id<"grupos">,
): Promise<void> {
  const nombreC = canonizar(nombre);
  const cicloC = canonizar(ciclo);
  const grupos = await ctx.db.query("grupos").collect();
  const choca = grupos.some(
    (g) =>
      g._id !== exceptId &&
      canonizar(g.nombre) === nombreC &&
      canonizar(g.ciclo ?? "") === cicloC,
  );
  if (choca) {
    throw new ConvexError(
      `Ya existe un grupo "${nombre.trim()}" en el ciclo ${ciclo.trim()}.`,
    );
  }
}

const turnoValidator = v.union(
  v.literal("matutino"),
  v.literal("vespertino"),
  v.literal("sabatino"),
);

/**
 * Instructores de un grupo (vía la unión), con nombre, materia y `activo`.
 * `activo` permite marcar «(inactivo)» sin romper la edición (política tolerante
 * LUI-13): un instructor desactivado sigue apareciendo en sus grupos.
 */
async function instructoresDeGrupo(
  ctx: QueryCtx,
  grupoId: Id<"grupos">,
): Promise<
  { id: Id<"users">; nombre: string; materia: string | null; activo: boolean }[]
> {
  const unions = await ctx.db
    .query("grupoInstructores")
    .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
    .collect();
  const out: {
    id: Id<"users">;
    nombre: string;
    materia: string | null;
    activo: boolean;
  }[] = [];
  for (const u of unions) {
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", u.instructorId))
      .first();
    if (perfil) {
      out.push({
        id: u.instructorId,
        nombre: nombreCompleto(perfil.nombre, perfil.apellidos),
        materia: perfil.materia ?? null,
        activo: perfil.activo,
      });
    }
  }
  out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return out;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Grupos activos, ordenados por nombre. Alimenta el <Select> de grupo de la
 * pantalla de alumnos (filtro y alta de alumnos → solo grupos activos). La
 * gestión completa de grupos usa `listarGestion` (incluye cerrados).
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const grupos = await ctx.db.query("grupos").collect();
    return grupos
      .filter((g) => g.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((g) => ({
        id: g._id,
        nombre: g.nombre,
        ciclo: g.ciclo ?? null,
        turno: g.turno ?? null,
      }));
  },
});

/**
 * Todos los grupos (activos y cerrados) con instructores resueltos y el conteo
 * de alumnos. Alimenta la lista de gestión (LUI-12). Tolera `turno`/`materia`
 * ausentes (grupos previos a la migración → `null`). Solo administradores.
 */
export const listarGestion = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const grupos = await ctx.db.query("grupos").collect();

    const filas = await Promise.all(
      grupos.map(async (g) => {
        const instructores = await instructoresDeGrupo(ctx, g._id);

        const perfilesGrupo = await ctx.db
          .query("perfiles")
          .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
          .collect();
        const alumnosCount = perfilesGrupo.filter(
          (p) => p.rol === "alumno",
        ).length;

        return {
          id: g._id,
          nombre: g.nombre,
          ciclo: g.ciclo ?? null,
          turno: g.turno ?? null,
          instructores,
          alumnosCount,
          activo: g.activo,
        };
      }),
    );

    filas.sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre, "es") ||
        (a.ciclo ?? "").localeCompare(b.ciclo ?? "", "es"),
    );
    return filas;
  },
});

/**
 * Detalle de un grupo para la ficha `/admin/grupos/[id]`. Recibe el id como
 * `string` y lo normaliza: si es malformado o no existe → `null` (la ficha
 * muestra «no encontrado»), evitando el error de validación de Convex ante una
 * URL como `/admin/grupos/foo`.
 */
export const obtener = query({
  args: { grupoId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const id = ctx.db.normalizeId("grupos", args.grupoId);
    if (!id) return null;
    const grupo = await ctx.db.get(id);
    if (!grupo) return null;

    const instructores = await instructoresDeGrupo(ctx, id);

    const perfilesAlumnos = (
      await ctx.db
        .query("perfiles")
        .withIndex("by_grupo", (q) => q.eq("grupoId", id))
        .collect()
    ).filter((p) => p.rol === "alumno");
    const alumnos = await Promise.all(
      perfilesAlumnos.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          id: p._id,
          nombre: nombreCompleto(p.nombre, p.apellidos),
          correo: user?.email ?? "",
          activo: p.activo,
          ultimoAccesoEn: p.ultimoAccesoEn ?? null,
        };
      }),
    );
    alumnos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    // «Exámenes aplicados»: los que ya ABRIERON su ventana. Regla compartida con
    // el panel de la administradora (LUI-9) — ver `convex/metricas.ts`. Antes esto
    // contaba `cierraEn <= ahora`, lo que hacía que esta ficha y `/admin`
    // mostraran la MISMA etiqueta con dos números distintos. Sigue siendo un proxy
    // hasta que existan resultados reales (LUI-20).
    const asignaciones = await ctx.db
      .query("asignaciones")
      .withIndex("by_grupo", (q) => q.eq("grupoId", id))
      .collect();
    const ahora = Date.now();
    const examenesAplicados = asignaciones.filter((a) =>
      fueAplicada(a, ahora),
    ).length;

    return {
      id: grupo._id,
      nombre: grupo.nombre,
      ciclo: grupo.ciclo ?? null,
      turno: grupo.turno ?? null,
      activo: grupo.activo,
      instructores,
      alumnos,
      metricas: { alumnosCount: alumnos.length, examenesAplicados },
    };
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────
// Toda escritura exige sesión de administrador vía `requireAdmin` (LUI-7).

/** Alta de grupo con 1+ instructores. */
export const crear = mutation({
  args: {
    nombre: v.string(),
    ciclo: v.string(),
    turno: turnoValidator,
    instructorIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const nombre = args.nombre.trim();
    const ciclo = args.ciclo.trim();
    if (!nombre) throw new ConvexError("El nombre del grupo es obligatorio.");
    if (!ciclo) throw new ConvexError("El ciclo es obligatorio.");

    const instructorIds = await validarInstructores(ctx, args.instructorIds);
    await validarNombreCicloUnico(ctx, nombre, ciclo);

    const grupoId = await ctx.db.insert("grupos", {
      nombre,
      ciclo,
      turno: args.turno,
      activo: true,
    });
    for (const instructorId of instructorIds) {
      await ctx.db.insert("grupoInstructores", { grupoId, instructorId });
    }
    return { grupoId };
  },
});

/** Edición de datos del grupo + reconciliación de instructores. */
export const actualizar = mutation({
  args: {
    grupoId: v.id("grupos"),
    nombre: v.string(),
    ciclo: v.string(),
    turno: turnoValidator,
    instructorIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const grupo = await ctx.db.get(args.grupoId);
    if (!grupo) throw new ConvexError("Grupo no encontrado.");

    const nombre = args.nombre.trim();
    const ciclo = args.ciclo.trim();
    if (!nombre) throw new ConvexError("El nombre del grupo es obligatorio.");
    if (!ciclo) throw new ConvexError("El ciclo es obligatorio.");

    const instructorIds = dedupeUsuarios(args.instructorIds);
    if (instructorIds.length === 0) {
      throw new ConvexError("Asigna al menos un instructor al grupo.");
    }
    await validarNombreCicloUnico(ctx, nombre, ciclo, args.grupoId);

    // Reconciliar filas de unión (idempotente; no hay índice único). Política
    // TOLERANTE (LUI-13): se valida que estén ACTIVOS solo los instructores
    // NUEVOS; los ya asignados se conservan aunque estén inactivos (p. ej.
    // desactivados desde «Usuarios y permisos»).
    const existentes = await ctx.db
      .query("grupoInstructores")
      .withIndex("by_grupo", (q) => q.eq("grupoId", args.grupoId))
      .collect();
    const yaAsignados = new Set(existentes.map((r) => r.instructorId as string));
    for (const id of instructorIds) {
      if (!yaAsignados.has(id as string)) await validarInstructorActivo(ctx, id);
    }
    await ctx.db.patch(args.grupoId, { nombre, ciclo, turno: args.turno });
    const deseados = new Set(instructorIds.map((id) => id as string));
    const mantenidos = new Set<string>();
    for (const row of existentes) {
      const key = row.instructorId as string;
      if (deseados.has(key) && !mantenidos.has(key)) {
        mantenidos.add(key);
      } else {
        await ctx.db.delete(row._id);
      }
    }
    for (const instructorId of instructorIds) {
      if (!mantenidos.has(instructorId as string)) {
        await ctx.db.insert("grupoInstructores", {
          grupoId: args.grupoId,
          instructorId,
        });
      }
    }
    return { grupoId: args.grupoId };
  },
});

/**
 * Cierra o reabre un grupo (baja lógica). Cerrar CONSERVA `alumnos.grupoId` e
 * historial (asignaciones/intentos): un grupo cerrado solo desaparece de
 * `listar` (solo-activos), por lo que no se le asignan alumnos ni exámenes nuevos.
 */
export const cambiarEstado = mutation({
  args: { grupoId: v.id("grupos"), activo: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const grupo = await ctx.db.get(args.grupoId);
    if (!grupo) throw new ConvexError("Grupo no encontrado.");
    await ctx.db.patch(args.grupoId, { activo: args.activo });
    return { grupoId: args.grupoId, activo: args.activo };
  },
});
