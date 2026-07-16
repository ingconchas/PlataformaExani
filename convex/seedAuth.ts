import {
  internalMutation,
  internalQuery,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import { ORIGEN_CONFIABLE } from "./auth";
import { CONFIRMACION_SOLO_DEV, exigirDeploymentDeDesarrollo } from "./entorno";

/**
 * Credenciales de PRUEBA (dev-only) para poder iniciar sesión sin el flujo de
 * correos (LUI-103). ⚠️ En PRODUCCIÓN las credenciales nacen de la invitación
 * (LUI-103), NUNCA de este seed. Requiere haber corrido antes el seed base
 * (`seed:cargarDatosDePrueba`), que crea los `users`+`perfiles`.
 *
 * Ejecutar:  npx convex run seedAuth:credencialesDemo
 */

const norm = (c: string) => c.trim().toLowerCase();

// Contraseña demo compartida (cumple ≥8 + mayúscula + número).
const PASSWORD_DEMO = "Demo1234";

// Cuentas demo con acceso (1 admin, 4 instructores, 2 alumnos → cubre los 3 roles).
const CORREOS_DEMO = [
  "mayra.admin@demo.unx.mx",
  "cristian.instructor@demo.unx.mx",
  "carlos.instructor@demo.unx.mx",
  "diana.instructor@demo.unx.mx",
  "ruben.instructor@demo.unx.mx",
  "ana.lopez@correo.com",
  "fernanda.alumna@demo.unx.mx",
].map(norm);

/**
 * Marca `emailVerificationTime` en los users demo para habilitar el enganche por
 * correo verificado de Convex Auth. **Exige EXACTAMENTE 1 user por correo**
 * (Convex Auth solo enlaza con un único user verificado); si hay 0 o >1, aborta.
 */
export const verificarCorreosDemo = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const ahora = Date.now();
    let marcados = 0;
    for (const correo of CORREOS_DEMO) {
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", correo))
        .take(2);
      if (users.length !== 1) {
        throw new ConvexError(
          `Se esperaba exactamente 1 usuario para ${correo}, se encontraron ${users.length}. ` +
            `Corre primero el seed base (seed:cargarDatosDePrueba).`,
        );
      }
      if (users[0].emailVerificationTime === undefined) {
        await ctx.db.patch(users[0]._id, { emailVerificationTime: ahora });
        marcados++;
      }
    }
    return { correos: CORREOS_DEMO.length, marcados };
  },
});

/** ¿Ya existe una credencial password para este correo? (idempotencia del action). */
export const authCredencialExiste = internalQuery({
  args: { correo: v.string() },
  handler: async (ctx, { correo }) => {
    const cuenta = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", norm(correo)),
      )
      .unique();
    return cuenta !== null;
  },
});

/**
 * Siembra las credenciales demo. Es `internalAction` porque `createAccount`
 * requiere `ActionCtx`. `createAccount` hashea la contraseña y engancha al user
 * sembrado (vía el callback `createOrUpdateUser` de `auth.ts`, que solo acepta el
 * enganche cuando el `profile` trae la marca `origen`). Idempotente: salta las
 * cuentas que ya tienen credencial.
 */
export const credencialesDemo = internalAction({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    // El guard va ANTES de cualquier escritura. `verificarCorreosDemo` trae el
    // suyo, pero esta action no debe siquiera empezar fuera de desarrollo.
    exigirDeploymentDeDesarrollo();
    await ctx.runMutation(internal.seedAuth.verificarCorreosDemo, {
      confirmar: CONFIRMACION_SOLO_DEV,
    });
    const creadas: string[] = [];
    for (const correo of CORREOS_DEMO) {
      const existe = await ctx.runQuery(internal.seedAuth.authCredencialExiste, {
        correo,
      });
      if (existe) continue;
      await createAccount(ctx, {
        provider: "password",
        account: { id: correo, secret: PASSWORD_DEMO },
        // La marca `origen` viaja en runtime (la lee createOrUpdateUser, que NO
        // patchea userData); el tipo de `profile` solo admite campos de `users`,
        // por eso se castea.
        profile: { email: correo, origen: ORIGEN_CONFIABLE } as { email: string },
        shouldLinkViaEmail: true,
      });
      creadas.push(correo);
    }
    return {
      creadas,
      mensaje: creadas.length
        ? `Credenciales demo creadas (${creadas.length}) — contraseña: ${PASSWORD_DEMO} · ${creadas.join(", ")}`
        : "Todas las credenciales demo ya existían.",
    };
  },
});
