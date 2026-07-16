import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { normalizarCorreo } from "./credenciales";
import { canonizar } from "./texto";
import { NUCLEO } from "./temario";

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

/**
 * Siembra las 3 secciones del NÚCLEO del temario (LUI-18).
 *
 * Vive en `bootstrap.ts` y no en `seed.ts` porque **no es dato demo**: las
 * secciones del núcleo son dato institucional real y producción las necesita. Por
 * eso tampoco lleva el guard solo-dev de `convex/entorno.ts`:
 *
 *   npx convex run bootstrap:sembrarTemarioNucleo --prod
 *
 * **Es CONVERGENTE (upsert), no rechazante** — a diferencia de
 * `crearAdminInicial`, que se niega a repetirse. El arranque de un admin es único
 * e irrepetible; el temario no: mañana puede aparecer una cuarta sección de
 * núcleo y hay que poder re-correrlo sin duplicar nada.
 *
 * Solo el nivel 1: las áreas temáticas y los subtemas los captura Mayra desde
 * `/admin/temario`. Los mocks no son fuente de verdad del temario canónico — el
 * Diseño 11 y el 14 ni siquiera coinciden en las áreas de Pensamiento matemático.
 *
 * Upsert por `canonizar(nombre)` en TODA la tabla, cruzando tipos: el modal de
 * alta tiene un único dropdown plano que mezcla núcleos y módulos, así que los
 * nombres deben ser inequívocos entre ambos.
 */
export const sembrarTemarioNucleo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existentes = await ctx.db.query("secciones").collect();
    const porNombre = new Map(existentes.map((s) => [canonizar(s.nombre), s]));

    const insertado: string[] = [];
    const reparado: string[] = [];
    for (const [i, nombre] of NUCLEO.entries()) {
      const previa = porNombre.get(canonizar(nombre));
      if (!previa) {
        await ctx.db.insert("secciones", {
          nombre,
          tipo: "nucleo",
          activo: true,
          orden: i,
          reactivosCount: 0,
        });
        insertado.push(nombre);
        continue;
      }
      // Convergencia acotada: si una sección del núcleo quedó marcada como módulo
      // (p. ej. creada a mano desde la pantalla antes de correr esto), se corrige
      // el tipo. `orden` y `activo` NO se tocan: son decisiones del admin, no del
      // seed, y pisarlas sería que el seed le deshiciera el trabajo.
      if (previa.tipo !== "nucleo") {
        await ctx.db.patch(previa._id, { tipo: "nucleo" });
        reparado.push(`${nombre} (era módulo)`);
      }
    }
    return {
      insertado,
      reparado,
      mensaje:
        insertado.length || reparado.length
          ? `Núcleo OK — insertado: ${insertado.length ? insertado.join(", ") : "nada"} · reparado: ${reparado.length ? reparado.join(", ") : "nada"}`
          : "Las 3 secciones del núcleo ya existían y estaban al día.",
    };
  },
});
