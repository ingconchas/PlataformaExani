import { query, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./authz";
import { credencialExiste } from "./credenciales";
import { asegurarCapacidadMembresias } from "./instructores";
import { MAX_GRUPOS_POR_INSTRUCTOR } from "./participacion";

// ── Helpers ────────────────────────────────────────────────────────────────

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

function dedupeGrupos(ids: Id<"grupos">[]): Id<"grupos">[] {
  const vistos = new Set<string>();
  const unicos: Id<"grupos">[] = [];
  for (const id of ids) {
    if (!vistos.has(id)) {
      vistos.add(id);
      unicos.push(id);
    }
  }
  return unicos;
}

/** Valida que un grupo exista y esté ACTIVO (solo para asignaciones NUEVAS). */
async function validarGrupoActivo(
  ctx: MutationCtx,
  grupoId: Id<"grupos">,
): Promise<void> {
  const grupo = await ctx.db.get(grupoId);
  if (!grupo || !grupo.activo) {
    throw new ConvexError(
      "Uno de los grupos seleccionados no existe o está cerrado.",
    );
  }
}

const rolStaffValidator = v.union(v.literal("admin"), v.literal("instructor"));

// ── Query ─────────────────────────────────────────────────────────────────

/**
 * Cuentas de staff (administradores + instructores) para «Usuarios y permisos».
 * Para cada instructor resuelve sus grupos con acceso `{id, nombre, ciclo, activo}`
 * (ciclo desambigua homónimos; `activo` permite marcar «(cerrado)»). Admin ⇒
 * `accesoTodos:true`. Marca `esCuentaPropia` (la fila del admin autenticado, por
 * `userId` de sesión). Solo administradores.
 */
export const listarStaff = query({
  args: {},
  handler: async (ctx) => {
    const { userId: yo } = await requireAdmin(ctx);
    const fila = async (p: Doc<"perfiles">) => {
      const user = await ctx.db.get(p.userId);
      const grupos: {
        id: Id<"grupos">;
        nombre: string;
        ciclo: string | null;
        activo: boolean;
      }[] = [];
      if (p.rol === "instructor") {
        const unions = await ctx.db
          .query("grupoInstructores")
          .withIndex("by_instructor", (q) => q.eq("instructorId", p.userId))
          .collect();
        for (const u of unions) {
          const g = await ctx.db.get(u.grupoId);
          if (g) {
            grupos.push({
              id: g._id,
              nombre: g.nombre,
              ciclo: g.ciclo ?? null,
              activo: g.activo,
            });
          }
        }
        grupos.sort(
          (a, b) =>
            a.nombre.localeCompare(b.nombre, "es") ||
            (a.ciclo ?? "").localeCompare(b.ciclo ?? "", "es"),
        );
      }
      const correo = user?.email ?? "";
      return {
        id: p._id,
        userId: p.userId,
        nombre: nombreCompleto(p.nombre, p.apellidos),
        correo,
        rol: p.rol as "admin" | "instructor",
        materia: p.materia ?? null,
        accesoTodos: p.rol === "admin",
        grupos,
        activo: p.activo,
        ultimoAccesoEn: p.ultimoAccesoEn ?? null,
        esCuentaPropia: p.userId === yo,
        // Aún no ha activado su acceso (sin credencial) → se puede reenviar invitación.
        accesoPendiente: correo ? !(await credencialExiste(ctx, correo)) : true,
      };
    };

    const admins = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "admin"))
      .collect();
    const instructores = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "instructor"))
      .collect();

    const filasAdmin = (await Promise.all(admins.map(fila))).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es"),
    );
    const filasInstr = (await Promise.all(instructores.map(fila))).sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es"),
    );
    return [...filasAdmin, ...filasInstr]; // admins primero, luego instructores
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────
// Toda escritura exige sesión de administrador vía `requireAdmin` (LUI-7).

/** Alta de cuenta de staff. Si es instructor, asigna grupos (activos). */
export const crear = mutation({
  args: {
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    correo: v.string(),
    rol: rolStaffValidator,
    materia: v.optional(v.string()),
    grupoIds: v.optional(v.array(v.id("grupos"))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const nombre = args.nombre.trim();
    const apellidos = args.apellidos?.trim() || undefined;
    const correo = normalizarCorreo(args.correo);
    if (!nombre) throw new ConvexError("El nombre es obligatorio.");
    if (!correo) throw new ConvexError("El correo es obligatorio.");
    validarFormatoCorreo(correo);

    const existente = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", correo))
      .first();
    if (existente) throw new ConvexError("Ese correo ya está registrado.");

    const esInstructor = args.rol === "instructor";
    const materia = esInstructor ? args.materia?.trim() || undefined : undefined;
    const grupoIds = esInstructor ? dedupeGrupos(args.grupoIds ?? []) : [];
    // Cota sobre la entrada DEDUPLICADA, antes de resolver cada grupo (LUI-19):
    // rechazar aquí evita lecturas inútiles y errores genéricos de límites.
    if (grupoIds.length > MAX_GRUPOS_POR_INSTRUCTOR) {
      throw new ConvexError(
        `Un instructor no puede tener más de ${MAX_GRUPOS_POR_INSTRUCTOR} grupos.`,
      );
    }
    for (const gid of grupoIds) await validarGrupoActivo(ctx, gid);

    const userId = await ctx.db.insert("users", {
      name: nombreCompleto(nombre, apellidos),
      email: correo,
    });
    const perfilId = await ctx.db.insert("perfiles", {
      userId,
      rol: args.rol,
      nombre,
      apellidos,
      materia,
      activo: true,
    });
    // Frontera de membresías (LUI-19): la cuenta es NUEVA (0 uniones), así que
    // la sonda valida `0 + grupoIds.length` — el wiring centralizado es el mismo
    // de los otros tres escritores, no una aritmética local.
    await asegurarCapacidadMembresias(ctx, userId, {
      añadidas: grupoIds.length,
      removidas: 0,
    });
    for (const grupoId of grupoIds) {
      await ctx.db.insert("grupoInstructores", { grupoId, instructorId: userId });
    }
    // Invitación (LUI-103): agenda el correo con el enlace para crear contraseña.
    await ctx.scheduler.runAfter(0, internal.invitaciones.enviarInvitacion, {
      userId,
    });
    return { perfilId };
  },
});

/**
 * Edición de una cuenta de staff. `rol` NO es editable (evita transiciones
 * admin↔instructor). La cuenta propia demo no puede editarse. Reconcilia los
 * grupos del instructor validando solo los NUEVOS (conserva los cerrados ya
 * asignados — política tolerante, LUI-13).
 */
export const actualizar = mutation({
  args: {
    perfilId: v.id("perfiles"),
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    correo: v.optional(v.string()),
    materia: v.optional(v.string()),
    grupoIds: v.optional(v.array(v.id("grupos"))),
  },
  handler: async (ctx, args) => {
    const { userId: yo } = await requireAdmin(ctx);

    const perfil = await ctx.db.get(args.perfilId);
    if (!perfil) throw new ConvexError("Cuenta no encontrada.");
    if (perfil.rol === "alumno") {
      throw new ConvexError("Esta cuenta no es de staff.");
    }
    // Cuenta propia = el perfil OBJETIVO es el del admin autenticado (`yo`).
    if (perfil.userId === yo) {
      throw new ConvexError("No puedes editar tu propia cuenta.");
    }

    const nombre = args.nombre.trim();
    const apellidos = args.apellidos?.trim() || undefined;
    if (!nombre) throw new ConvexError("El nombre es obligatorio.");

    // Correo: valida formato + duplicado (ignorando el propio) ANTES de escribir.
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

    const esInstructor = perfil.rol === "instructor";
    const materia = esInstructor ? args.materia?.trim() || undefined : undefined;

    // Solo se reconcilian los grupos si `grupoIds` viene EXPLÍCITO (aunque sea []).
    // Si es `undefined` (llamada parcial que no toca grupos), se PRESERVAN las
    // asignaciones actuales para no revocar accesos en silencio. El formulario de
    // instructor siempre envía el arreglo.
    if (esInstructor && args.grupoIds !== undefined) {
      const grupoIds = dedupeGrupos(args.grupoIds);
      // Cota sobre la entrada DEDUPLICADA, antes de resolver cada grupo (LUI-19).
      if (grupoIds.length > MAX_GRUPOS_POR_INSTRUCTOR) {
        throw new ConvexError(
          `Un instructor no puede tener más de ${MAX_GRUPOS_POR_INSTRUCTOR} grupos.`,
        );
      }
      const existentes = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_instructor", (q) => q.eq("instructorId", perfil.userId))
        .collect();
      const yaAsignados = new Set(existentes.map((r) => r.grupoId as string));
      // Valida activos SOLO los grupos nuevos; los ya asignados se conservan
      // aunque estén cerrados.
      for (const gid of grupoIds) {
        if (!yaAsignados.has(gid as string)) await validarGrupoActivo(ctx, gid);
      }
      // Frontera de membresías (LUI-19), con el delta que ESTA reconciliación
      // computa: añadidas = deseados que no estaban; removidas = filas que van a
      // borrarse (las no deseadas y los duplicados). Ante un legado saturado, la
      // frontera rechaza toda ALTA (el tamaño real es desconocido) — depurar
      // primero (solo bajas) y añadir después.
      {
        const deseadosPrevio = new Set(grupoIds.map((g) => g as string));
        const vistosPrevio = new Set<string>();
        let mantenidos = 0;
        for (const row of existentes) {
          const key = row.grupoId as string;
          if (deseadosPrevio.has(key) && !vistosPrevio.has(key)) {
            vistosPrevio.add(key);
            mantenidos++;
          }
        }
        await asegurarCapacidadMembresias(ctx, perfil.userId, {
          añadidas: grupoIds.filter((g) => !yaAsignados.has(g as string)).length,
          removidas: existentes.length - mantenidos,
        });
      }
      const deseados = new Set(grupoIds.map((g) => g as string));
      const mantenidos = new Set<string>();
      for (const row of existentes) {
        const key = row.grupoId as string;
        if (deseados.has(key) && !mantenidos.has(key)) mantenidos.add(key);
        else await ctx.db.delete(row._id);
      }
      for (const grupoId of grupoIds) {
        if (!mantenidos.has(grupoId as string)) {
          await ctx.db.insert("grupoInstructores", {
            grupoId,
            instructorId: perfil.userId,
          });
        }
      }
    }

    await ctx.db.patch(args.perfilId, { nombre, apellidos, materia });
    const nombreDoc = nombreCompleto(nombre, apellidos);
    await ctx.db.patch(
      perfil.userId,
      correoNuevo !== undefined
        ? { email: correoNuevo, name: nombreDoc }
        : { name: nombreDoc },
    );
    return { perfilId: args.perfilId };
  },
});

/**
 * Activa/desactiva una cuenta de staff (baja lógica; conserva su contenido y sus
 * filas `grupoInstructores`). Rechaza desactivar la cuenta propia demo o al
 * último administrador activo (evita el bloqueo total del sistema).
 */
export const cambiarEstado = mutation({
  args: { perfilId: v.id("perfiles"), activo: v.boolean() },
  handler: async (ctx, args) => {
    const { userId: yo } = await requireAdmin(ctx);

    const perfil = await ctx.db.get(args.perfilId);
    if (!perfil) throw new ConvexError("Cuenta no encontrada.");
    if (perfil.rol === "alumno") {
      throw new ConvexError("Esta cuenta no es de staff.");
    }
    // Cuenta propia = el perfil OBJETIVO es el del admin autenticado (`yo`).
    if (perfil.userId === yo) {
      throw new ConvexError("No puedes desactivar tu propia cuenta.");
    }

    if (perfil.rol === "admin" && args.activo === false) {
      const admins = await ctx.db
        .query("perfiles")
        .withIndex("by_rol", (q) => q.eq("rol", "admin"))
        .collect();
      const otrosActivos = admins.filter(
        (a) => a.activo && a._id !== perfil._id,
      );
      if (otrosActivos.length === 0) {
        throw new ConvexError("Debe quedar al menos un administrador activo.");
      }
    }

    await ctx.db.patch(args.perfilId, { activo: args.activo });
    // El login (Convex Auth · `beforeSessionCreation`) rechaza activo:false y
    // `requireSesion` bloquea sus lecturas/escrituras. Política tolerante: NO se
    // borran las filas grupoInstructores (baja lógica).
    return { perfilId: args.perfilId, activo: args.activo };
  },
});
