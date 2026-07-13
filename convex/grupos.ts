import { query } from "./_generated/server";

/**
 * Grupos activos, ordenados por nombre. Alimenta el <Select> de grupo de la
 * pantalla de alumnos (filtro y alta). La gestión completa de grupos es LUI-12.
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const grupos = await ctx.db.query("grupos").collect();
    return grupos
      .filter((g) => g.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((g) => ({ id: g._id, nombre: g.nombre }));
  },
});
