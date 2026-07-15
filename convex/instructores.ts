import { query } from "./_generated/server";
import { requireAdmin } from "./authz";

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
