import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import { type Id } from "./_generated/dataModel";
import { validarContrasena } from "./politica";

/**
 * Autenticación (Convex Auth · LUI-7, Entrega 1). Provider de correo+contraseña.
 *
 * - `profile` normaliza el correo (canónico) para casar con
 *   `authAccounts.providerAccountId`.
 * - `createOrUpdateUser` **bloquea el auto-registro público**: solo se permite
 *   ENGANCHAR una cuenta a un usuario ya sembrado/invitado (con correo
 *   verificado); si no existe, se rechaza. Reemplaza la lógica por defecto de
 *   Convex Auth, por eso el enganche por correo verificado se hace aquí mismo
 *   (equivale a su `uniqueUserWithVerifiedEmail`). Hasta LUI-103 no hay alta de
 *   credenciales pública; las cuentas nacen desde el staff/importación.
 */
/**
 * Marca de ORIGEN CONFIABLE de servidor: distingue un `createAccount` hecho por
 * un flujo interno de confianza (seed de demo o invitación LUI-103) de un signUp
 * público. NO es inyectable desde /api/auth: el `profile` del provider Password
 * descarta cualquier param extra (solo devuelve `{ email }`), así que el flujo
 * público no puede fijar `origen`.
 */
export const ORIGEN_CONFIABLE = "servidor-confiable";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => ({
        email: String(params.email ?? "").trim().toLowerCase(),
      }),
      // Defensa: cualquier alta de credencial por el provider valida la política.
      // (El alta real la hacen las actions de LUI-103 vía createAccount, que
      // también llaman a `validarContrasena` antes.)
      validatePasswordRequirements: validarContrasena,
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;
      const perfilLike = args.profile as
        | { email?: string; origen?: string }
        | undefined;
      // Solo un flujo de servidor CONFIABLE (seed o invitación LUI-103) puede
      // enganchar una cuenta a un usuario ya verificado (marca `origen`, no
      // inyectable desde /api/auth). Así, un signUp público contra un correo
      // verificado que AÚN NO tiene credencial —la ventana peligrosa— también
      // queda bloqueado.
      if (perfilLike?.origen === ORIGEN_CONFIABLE) {
        const email =
          typeof perfilLike.email === "string" ? perfilLike.email : undefined;
        if (email) {
          // ctx.db aquí es AnyDataModel (no conoce el índice "email"); se filtra
          // (escaneo pequeño; solo ocurre al CREAR cuenta, no en cada login).
          const verificados = await ctx.db
            .query("users")
            .filter((q) =>
              q.and(
                q.eq(q.field("email"), email),
                q.neq(q.field("emailVerificationTime"), undefined),
              ),
            )
            .take(2);
          if (verificados.length === 1) {
            return verificados[0]._id as Id<"users">;
          }
        }
      }
      throw new ConvexError(
        "El registro no está disponible. Ingresa con la cuenta que te asignó tu institución.",
      );
    },
    /**
     * Corre en CADA login, justo antes de crear la sesión (único callback con esa
     * garantía). Bloquea el ingreso de cuentas sin perfil o desactivadas —lanza,
     * así NO se persiste la sesión— y registra el último acceso. El `ctx` es
     * AnyDataModel (no conoce índices tipados) → se filtra por `userId`. El error
     * lleva un `code` distinguible para que el login muestre el motivo (solo se
     * revela tras credenciales correctas → no filtra existencia del correo).
     */
    async beforeSessionCreation(ctx, { userId }) {
      const perfil = await ctx.db
        .query("perfiles")
        .filter((q) => q.eq(q.field("userId"), userId))
        .first();
      if (!perfil) {
        throw new ConvexError({
          code: "CUENTA_SIN_PERFIL",
          message: "Tu cuenta no está habilitada. Contacta a tu institución.",
        });
      }
      if (perfil.activo === false) {
        throw new ConvexError({
          code: "CUENTA_INACTIVA",
          message: "Tu cuenta está desactivada. Contacta a tu institución.",
        });
      }
      await ctx.db.patch(perfil._id, { ultimoAccesoEn: Date.now() });
    },
  },
});
