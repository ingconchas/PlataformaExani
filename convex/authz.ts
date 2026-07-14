import { type MutationCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

/**
 * Punto ÚNICO de autorización para las escrituras de la app.
 *
 * ⚠️ Autenticación diferida (LUI-7). Hoy este seam NO valida una sesión de
 * usuario: permite escribir SOLO si el deployment tiene la variable de entorno
 * `PERMITIR_ESCRITURA_DEMO=true`. Se activa a mano en el deployment de
 * desarrollo:
 *
 *     npx convex env set PERMITIR_ESCRITURA_DEMO true
 *
 * Así, un deploy accidental a un entorno compartido / producción —sin esa
 * flag— rechaza toda escritura. GO solo para demo local.
 *
 * CONTRATO LUI-7: reemplazar el cuerpo por leer `getAuthUserId(ctx)`, buscar su
 * `perfiles.rol` y exigir `=== "admin"`. Es el único lugar a tocar.
 */
export async function requireAdmin(ctx: MutationCtx): Promise<void> {
  void ctx; // se usará al conectar la sesión real (LUI-7)
  if (process.env.PERMITIR_ESCRITURA_DEMO === "true") return;
  throw new ConvexError(
    "Escritura no autorizada: la autenticación aún no está activa (LUI-7). " +
      "En desarrollo, habilita el modo demo con: " +
      "npx convex env set PERMITIR_ESCRITURA_DEMO true",
  );
}

/**
 * «Cuenta propia» del demo (auth diferida, LUI-7). Mientras no hay sesión, se
 * designa al admin sembrado como el usuario actual: su fila no muestra acciones y
 * no puede editarse ni desactivarse a sí mismo. Se identifica por correo, que se
 * mantiene estable porque esta cuenta no es editable.
 *
 * CONTRATO LUI-7: sustituir por `getAuthUserId(ctx)` y comparar por userId de la
 * sesión (único lugar a cambiar).
 */
export const EMAIL_CUENTA_PROPIA_DEMO = "mayra.admin@demo.unx.mx";

export function esCuentaPropiaDemo(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === EMAIL_CUENTA_PROPIA_DEMO;
}
