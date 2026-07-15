import { type QueryCtx, type MutationCtx } from "./_generated/server";

/** Correo canónico (sin espacios, minúsculas) — casa con `authAccounts.providerAccountId`. */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

/**
 * ¿Existe una credencial de contraseña para este correo? (= la cuenta ya activó
 * su acceso). Se usa para `accesoPendiente` en las listas y para decidir
 * create-vs-modify al fijar la contraseña. Helper compartido (queries/mutations);
 * las actions lo consultan vía la `internalQuery` `tieneCredencialPassword`.
 */
export async function credencialExiste(
  ctx: QueryCtx | MutationCtx,
  correo: string,
): Promise<boolean> {
  const cuenta = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q
        .eq("provider", "password")
        .eq("providerAccountId", normalizarCorreo(correo)),
    )
    .unique();
  return cuenta !== null;
}
