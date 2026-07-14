import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Datos de la sesión actual (LUI-7, Entrega 1): `null` si no hay sesión; si la
 * hay, `{ userId, rol, nombre, activo }` del perfil ligado. Alimenta la
 * redirección por rol tras el login y la identidad en los layouts.
 *
 * Solo lee la PROPIA sesión (no expone a terceros ni gatea otras queries — eso
 * es la Entrega 2 de authz).
 */
export const actual = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!perfil) return null;
    return {
      userId,
      rol: perfil.rol,
      nombre: [perfil.nombre, perfil.apellidos].filter(Boolean).join(" "),
      activo: perfil.activo,
    };
  },
});
