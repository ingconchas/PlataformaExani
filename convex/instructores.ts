import {
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import {
  MAX_GRUPOS_POR_INSTRUCTOR,
  validarMembresias,
} from "./participacion";

/**
 * El conjunto autorizado del INSTRUCTOR: sus grupos por
 * `grupoInstructores.by_instructor`, filtrados a existentes y ACTIVOS. Frontera
 * ÚNICA con tres consumidores en `asignaciones.ts` (`asignar`, `paraAsignar`,
 * `existentesDe` — EL MISMO conjunto en la mutation y en la hidratación: sin el
 * filtro de `activo`, una llamada directa asignaría a un alumno activo de un
 * grupo cerrado aunque la UI no lo ofrezca). Vive aquí —el módulo del dominio
 * instructores— desde LUI-19, que además lo ACOTÓ.
 *
 * Lectura ACOTADA: `take(MAX_GRUPOS_POR_INSTRUCTOR + 1)` en vez de `collect` —
 * con la frontera de `asegurarCapacidadMembresias` en TODOS los escritores de
 * `grupoInstructores`, esa sonda ES el conjunto completo. Si devuelve MAX+1
 * filas, hay un legado pre-frontera de tamaño DESCONOCIDO: `membresiaDesbordada`
 * viene `true` y `grupos` viene VACÍO (inutilizable a propósito — los
 * consumidores de asignación LANZAN y el panel lo convierte en estado de
 * problema; nadie opera sobre un subconjunto que fingiría ser el todo).
 *
 * ⚠️ El panel del instructor (LUI-19) NO consume este helper: su contrato de
 * bytes exige resolver los grupos con un scan paginado con `maximumBytesRead`
 * (Q1) y un `get` único por query (Q2) — hasta 101 `ctx.db.get` de documentos
 * sin cota de bytes no caben en su presupuesto. Los flujos de asignación
 * (mutations y queries chicas) conservan los gets.
 */
export async function gruposActivosDelInstructor(
  ctx: QueryCtx | MutationCtx,
  instructorId: Id<"users">,
): Promise<{
  grupos: Map<Id<"grupos">, Doc<"grupos">>;
  membresiaDesbordada: boolean;
}> {
  const unions = await ctx.db
    .query("grupoInstructores")
    .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId))
    .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
  if (unions.length > MAX_GRUPOS_POR_INSTRUCTOR) {
    return { grupos: new Map(), membresiaDesbordada: true };
  }
  const grupos = new Map<Id<"grupos">, Doc<"grupos">>();
  for (const u of unions) {
    const g = await ctx.db.get(u.grupoId);
    if (g && g.activo) grupos.set(g._id, g);
  }
  return { grupos, membresiaDesbordada: false };
}

/**
 * Frontera ÚNICA del techo de membresías (`MAX_GRUPOS_POR_INSTRUCTOR`). La
 * llaman los CUATRO escritores productivos de `grupoInstructores` — enumeración
 * exhaustiva; un escritor nuevo DEBE sumarse:
 *   · `grupos.crear`        (una unión nueva por instructor del grupo)
 *   · `grupos.actualizar`   (una unión por instructor AÑADIDO)
 *   · `usuarios.crear`      (una unión por grupo del instructor nuevo)
 *   · `usuarios.actualizar` (reconciliación: añadidas y removidas)
 * (El seed siembra sus ≤4 uniones por instructor directamente — fixture bajo la
 * frontera, documentado en `seed.ts`.)
 *
 * Valida el TAMAÑO FINAL (`existentes − removidas + añadidas`), que es el que
 * cada escritor computa tras su dedupe/reconciliación — no `existentes + 1`,
 * porque hay escritores multi-alta. La sonda es `take(MAX + 1)`: saturada
 * significa legado de tamaño desconocido y `validarMembresias` rechaza toda
 * alta sin fingir aritmética. Las bajas puras no validan nada (solo encogen) y
 * ni siquiera sondean.
 */
export async function asegurarCapacidadMembresias(
  ctx: MutationCtx,
  instructorId: Id<"users">,
  delta: { añadidas: number; removidas: number },
): Promise<void> {
  if (delta.añadidas === 0) return;
  const existentes = await ctx.db
    .query("grupoInstructores")
    .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId))
    .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
  const perfil = await ctx.db
    .query("perfiles")
    .withIndex("by_user", (q) => q.eq("userId", instructorId))
    .first();
  const nombre = perfil
    ? [perfil.nombre, perfil.apellidos].filter(Boolean).join(" ")
    : "El instructor";
  validarMembresias(nombre, existentes.length, delta.añadidas, delta.removidas);
}

/**
 * Instructores activos, ordenados por nombre. Alimenta el <MultiSelect> de la
 * pantalla de grupos (LUI-12); `id` es el userId del instructor. `materia` puede
 * ser `null` (campo opcional del perfil). Solo administradores.
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const perfiles = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "instructor"))
      .collect();

    return perfiles
      .filter((p) => p.activo)
      .map((p) => ({
        id: p.userId,
        nombre: [p.nombre, p.apellidos].filter(Boolean).join(" "),
        materia: p.materia ?? null,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  },
});
