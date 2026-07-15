import { query, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./authz";
import { credencialExiste } from "./credenciales";

/** Correo canónico: sin espacios y en minúsculas (users.email NO impone unicidad). */
function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

function nombreCompleto(nombre: string, apellidos?: string): string {
  return [nombre, apellidos].filter(Boolean).join(" ");
}

const FORMATO_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validarFormatoCorreo(correo: string): void {
  if (!FORMATO_CORREO.test(correo)) {
    throw new ConvexError("El correo no tiene un formato válido.");
  }
}

/** Si se especifica grupo, debe existir y estar activo. */
async function validarGrupoActivo(
  ctx: MutationCtx,
  grupoId: Id<"grupos"> | undefined,
): Promise<void> {
  if (!grupoId) return;
  const grupo = await ctx.db.get(grupoId);
  if (!grupo || !grupo.activo) {
    throw new ConvexError("El grupo seleccionado no existe o está inactivo.");
  }
}

/**
 * Lista de alumnos con su correo (tabla `users`) y el nombre de su grupo
 * (tabla `grupos`) ya resueltos. `id` es el `perfilId` — clave estable de fila.
 * Solo para administradores (pantalla `/admin/alumnos`).
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const perfiles = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .collect();

    const filas = await Promise.all(
      perfiles.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        const grupo = p.grupoId ? await ctx.db.get(p.grupoId) : null;
        const correo = user?.email ?? "";
        return {
          id: p._id,
          userId: p.userId,
          nombre: p.nombre,
          apellidos: p.apellidos ?? "",
          correo,
          grupoId: p.grupoId ?? null,
          grupoNombre: grupo?.nombre ?? null,
          activo: p.activo,
          ultimoAccesoEn: p.ultimoAccesoEn ?? null,
          // Aún no ha activado su acceso (sin credencial) → se puede reenviar invitación.
          accesoPendiente: correo ? !(await credencialExiste(ctx, correo)) : true,
        };
      }),
    );

    filas.sort((a, b) =>
      nombreCompleto(a.nombre, a.apellidos).localeCompare(
        nombreCompleto(b.nombre, b.apellidos),
        "es",
      ),
    );
    return filas;
  },
});

/** Alta de alumno: crea `users` + `perfiles`. El correo de invitación es LUI-103. */
export const crear = mutation({
  args: {
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    correo: v.string(),
    grupoId: v.optional(v.id("grupos")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const nombre = args.nombre.trim();
    const apellidos = args.apellidos?.trim() || undefined;
    const correo = normalizarCorreo(args.correo);
    if (!nombre) throw new ConvexError("El nombre es obligatorio.");
    if (!correo) throw new ConvexError("El correo es obligatorio.");
    validarFormatoCorreo(correo);
    await validarGrupoActivo(ctx, args.grupoId);

    const existente = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", correo))
      .first();
    if (existente) throw new ConvexError("Ese correo ya está registrado.");

    const userId = await ctx.db.insert("users", {
      name: nombreCompleto(nombre, apellidos),
      email: correo,
    });
    const perfilId = await ctx.db.insert("perfiles", {
      userId,
      rol: "alumno",
      nombre,
      apellidos,
      grupoId: args.grupoId,
      activo: true,
    });
    // Invitación (LUI-103): agenda el correo con el enlace para crear contraseña.
    await ctx.scheduler.runAfter(0, internal.invitaciones.enviarInvitacion, {
      userId,
    });
    return { perfilId };
  },
});

/** Edición de datos del alumno. El correo se revalida ignorando su propio registro. */
export const actualizar = mutation({
  args: {
    perfilId: v.id("perfiles"),
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    correo: v.optional(v.string()),
    grupoId: v.optional(v.id("grupos")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const perfil = await ctx.db.get(args.perfilId);
    if (!perfil) throw new ConvexError("Alumno no encontrado.");
    if (perfil.rol !== "alumno") {
      throw new ConvexError("Solo se pueden editar alumnos.");
    }

    const nombre = args.nombre.trim();
    const apellidos = args.apellidos?.trim() || undefined;
    if (!nombre) throw new ConvexError("El nombre es obligatorio.");
    // Política tolerante (LUI-12): validar el grupo SOLO si cambió respecto al
    // actual. Así, conservar el grupo del alumno —aunque haya sido cerrado— es
    // válido; reasignar a OTRO grupo inactivo sigue prohibido.
    if (args.grupoId !== perfil.grupoId) {
      await validarGrupoActivo(ctx, args.grupoId);
    }

    // Valida el correo (formato + duplicado ignorando el propio) ANTES de escribir.
    let correoNuevo: string | undefined;
    if (args.correo !== undefined) {
      correoNuevo = normalizarCorreo(args.correo);
      if (!correoNuevo) throw new ConvexError("El correo es obligatorio.");
      validarFormatoCorreo(correoNuevo);
      const existente = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", correoNuevo))
        .first();
      if (existente && existente._id !== perfil.userId) {
        throw new ConvexError("Ese correo ya está registrado.");
      }
    }

    await ctx.db.patch(args.perfilId, { nombre, apellidos, grupoId: args.grupoId });
    const nombreDoc = nombreCompleto(nombre, apellidos);
    await ctx.db.patch(
      perfil.userId,
      correoNuevo !== undefined ? { email: correoNuevo, name: nombreDoc } : { name: nombreDoc },
    );
    return { perfilId: args.perfilId };
  },
});

/** Activa o desactiva a un alumno (baja lógica; conserva su historial). */
export const cambiarEstado = mutation({
  args: { perfilId: v.id("perfiles"), activo: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const perfil = await ctx.db.get(args.perfilId);
    if (!perfil) throw new ConvexError("Alumno no encontrado.");
    if (perfil.rol !== "alumno") {
      throw new ConvexError("Solo se pueden activar o desactivar alumnos.");
    }
    await ctx.db.patch(args.perfilId, { activo: args.activo });
    // El login (Convex Auth · `beforeSessionCreation`) rechaza a un alumno con
    // activo=false; `requireSesion` también bloquea sus lecturas/escrituras.
    return { perfilId: args.perfilId, activo: args.activo };
  },
});
