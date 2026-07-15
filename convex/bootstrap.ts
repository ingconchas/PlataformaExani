import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { normalizarCorreo } from "./credenciales";

const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Crea el PRIMER administrador de un deployment (bootstrap de producción).
 * CLI-only (`internalMutation`): p. ej.
 *   npx convex run bootstrap:crearAdminInicial '{"nombre":"…","correo":"…"}' --prod
 *
 * - **NO acepta `rol` como argumento** (fija `rol:"admin"` internamente).
 * - **Rechaza si YA EXISTE cualquier administrador** (activo o inactivo) → el
 *   arranque es único e irrepetible; en un entorno ya poblado no hace nada.
 * - **Rechaza si el correo ya está registrado.**
 * - No fija contraseña: agenda la invitación (LUI-103). El enlace para crear la
 *   contraseña aparece en los logs de Convex (transporte dev) y el admin la define
 *   en `/crear-contrasena?token=…`.
 */
export const crearAdminInicial = internalMutation({
  args: {
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    correo: v.string(),
  },
  handler: async (ctx, args) => {
    const nombre = args.nombre.trim();
    const apellidos = args.apellidos?.trim() || undefined;
    const correo = normalizarCorreo(args.correo);
    if (!nombre) throw new ConvexError("El nombre es obligatorio.");
    if (!correo) throw new ConvexError("El correo es obligatorio.");
    if (!FORMATO_CORREO.test(correo)) {
      throw new ConvexError("El correo no tiene un formato válido.");
    }

    // Arranque único: si ya hay CUALQUIER admin (activo o inactivo), no se repite.
    const adminExistente = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "admin"))
      .first();
    if (adminExistente) {
      throw new ConvexError(
        "Ya existe un administrador; el bootstrap inicial no se repite.",
      );
    }

    // El correo no debe estar registrado.
    const existente = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", correo))
      .first();
    if (existente) throw new ConvexError("Ese correo ya está registrado.");

    const userId = await ctx.db.insert("users", {
      name: [nombre, apellidos].filter(Boolean).join(" "),
      email: correo,
    });
    const perfilId = await ctx.db.insert("perfiles", {
      userId,
      rol: "admin",
      nombre,
      apellidos,
      activo: true,
    });
    // Invitación (LUI-103): el enlace para crear la contraseña queda en los logs.
    await ctx.scheduler.runAfter(0, internal.invitaciones.enviarInvitacion, {
      userId,
    });
    return { perfilId };
  },
});
