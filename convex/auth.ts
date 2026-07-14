import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import { type Id } from "./_generated/dataModel";

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
 * Marca que distingue el `createAccount` del SEED INTERNO de un signUp público.
 * NO es inyectable desde /api/auth: el `profile` del provider Password descarta
 * cualquier param extra (solo devuelve `{ email }`), así que el flujo público no
 * puede fijar `origen`.
 */
export const ORIGEN_SEED = "seed-interno-dev";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => ({
        email: String(params.email ?? "").trim().toLowerCase(),
      }),
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId) return args.existingUserId;
      const perfilLike = args.profile as
        | { email?: string; origen?: string }
        | undefined;
      // Solo el SEED INTERNO puede enganchar una cuenta a un usuario ya
      // verificado (marca `origen`, no inyectable desde /api/auth). Así, un
      // signUp público contra un correo verificado que AÚN NO tiene credencial
      // —la ventana peligrosa— también queda bloqueado.
      if (perfilLike?.origen === ORIGEN_SEED) {
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
  },
});
