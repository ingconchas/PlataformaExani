import { type QueryCtx, type MutationCtx } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

/**
 * Autorización de la app (LUI-7, Entrega 2). Punto ÚNICO para gatear queries y
 * mutations a partir de la sesión real de Convex Auth: `getAuthUserId` + el
 * perfil ligado por el índice `perfiles.by_user` (mismo patrón que
 * `sesion.actual`). Sirve en queries y mutations porque solo usa `ctx.auth` y
 * lecturas de `ctx.db`.
 */
type Ctx = QueryCtx | MutationCtx;

type Sesion = { userId: Id<"users">; perfil: Doc<"perfiles"> };

/**
 * Exige una sesión activa con perfil vigente. Rechaza si no hay sesión, si el
 * usuario autenticado no tiene perfil, o si el perfil está desactivado (así una
 * cuenta dada de baja no puede leer ni escribir aunque su token siga vivo).
 */
export async function requireSesion(ctx: Ctx): Promise<Sesion> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Debes iniciar sesión.");
  const perfil = await ctx.db
    .query("perfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!perfil) throw new ConvexError("Tu cuenta no tiene un perfil asociado.");
  if (!perfil.activo) throw new ConvexError("Tu cuenta está desactivada.");
  return { userId, perfil };
}

/**
 * Exige que la sesión sea de un administrador ACTIVO. Devuelve `{ userId, perfil }`
 * del admin autenticado — su `userId` sirve para «cuenta propia» (comparar el
 * registro OBJETIVO contra este `userId`, no contra este perfil).
 */
export async function requireAdmin(ctx: Ctx): Promise<Sesion> {
  const sesion = await requireSesion(ctx);
  if (sesion.perfil.rol !== "admin") {
    throw new ConvexError("Requiere permisos de administrador.");
  }
  return sesion;
}
