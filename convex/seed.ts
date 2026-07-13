import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Datos de PRUEBA (ficticios) para desarrollo local.
 * Ejecutar con:  npx convex run seed:cargarDatosDePrueba
 *
 * Idempotente POR ENTIDAD: cada grupo se busca por nombre, cada persona por
 * correo, cada reactivo por enunciado. Volver a correrlo solo inserta lo que
 * falte (nunca duplica ni corta al primer registro existente).
 *
 * ⚠️ Datos ficticios a propósito: las queries siguen abiertas hasta LUI-7.
 * NO usar con datos reales ni desplegar.
 *
 * Es `internalMutation`: NO forma parte de la API pública (no se puede llamar
 * desde el cliente/HTTP); solo se ejecuta con el CLI de confianza
 * (`npx convex run seed:cargarDatosDePrueba`).
 */

const DIA = 24 * 60 * 60 * 1000;
const norm = (correo: string) => correo.trim().toLowerCase();
const nombreCompleto = (nombre: string, apellidos: string) =>
  [nombre, apellidos].filter(Boolean).join(" ");

const INSTRUCTOR_EMAIL = "cristian.instructor@demo.unx.mx";
const GRUPOS = ["Matutino A", "Vespertino B", "Sabatino C"];

type AlumnoSeed = {
  nombre: string;
  apellidos: string;
  correo: string;
  grupo: string;
  activo: boolean;
  /** Días atrás del último acceso; null = "Nunca" (nunca ha entrado). */
  ultimoAccesoDias: number | null;
};

const ALUMNOS: AlumnoSeed[] = [
  { nombre: "Ana", apellidos: "López Ramírez", correo: "ana.lopez@correo.com", grupo: "Matutino A", activo: true, ultimoAccesoDias: 2 },
  { nombre: "Diego", apellidos: "Martín Soto", correo: "diego.soto@correo.com", grupo: "Matutino A", activo: true, ultimoAccesoDias: 3 },
  { nombre: "Valeria", apellidos: "Cruz Núñez", correo: "valeria.cruz@correo.com", grupo: "Vespertino B", activo: true, ultimoAccesoDias: 1 },
  { nombre: "Emiliano", apellidos: "Ríos Paz", correo: "emiliano.rios@correo.com", grupo: "Sabatino C", activo: true, ultimoAccesoDias: 5 },
  { nombre: "Regina", apellidos: "Ávila Mora", correo: "regina.avila@correo.com", grupo: "Vespertino B", activo: true, ultimoAccesoDias: 4 },
  { nombre: "Santiago", apellidos: "Herrera Luna", correo: "santiago.herrera@correo.com", grupo: "Matutino A", activo: false, ultimoAccesoDias: 21 },
  { nombre: "Fernanda", apellidos: "Gutiérrez Peña", correo: "fernanda.gtz@correo.com", grupo: "Sabatino C", activo: true, ultimoAccesoDias: null },
  { nombre: "Ximena", apellidos: "Salazar Ortiz", correo: "ximena.salazar@correo.com", grupo: "Matutino A", activo: true, ultimoAccesoDias: 6 },
  // Alumna demo de la app de la alumna (heredada del primer seed): se incluye en
  // el fixture para que el seed le repare el grupo y todo converja.
  { nombre: "Fernanda", apellidos: "López", correo: "fernanda.alumna@demo.unx.mx", grupo: "Matutino A", activo: true, ultimoAccesoDias: 7 },
];

const REACTIVOS: Array<{
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  dificultad: "facil" | "medio" | "dificil";
  retroalimentacion: string;
}> = [
  {
    enunciado: "¿Cuál es el valor de x en la ecuación 2x + 6 = 14?",
    opciones: [
      { id: "a", texto: "x = 2" },
      { id: "b", texto: "x = 4" },
      { id: "c", texto: "x = 6" },
      { id: "d", texto: "x = 8" },
    ],
    opcionCorrecta: "b",
    dificultad: "facil",
    retroalimentacion: "2x = 14 − 6 = 8, por lo tanto x = 4.",
  },
  {
    enunciado: "Si 3x − 9 = 0, ¿cuánto vale x?",
    opciones: [
      { id: "a", texto: "x = 1" },
      { id: "b", texto: "x = 3" },
      { id: "c", texto: "x = 6" },
      { id: "d", texto: "x = 9" },
    ],
    opcionCorrecta: "b",
    dificultad: "facil",
    retroalimentacion: "3x = 9, entonces x = 3.",
  },
  {
    enunciado: "Resuelve para x: 5x + 2 = 3x + 10",
    opciones: [
      { id: "a", texto: "x = 2" },
      { id: "b", texto: "x = 4" },
      { id: "c", texto: "x = 6" },
      { id: "d", texto: "x = 8" },
    ],
    opcionCorrecta: "b",
    dificultad: "medio",
    retroalimentacion: "5x − 3x = 10 − 2 → 2x = 8 → x = 4.",
  },
  {
    enunciado: "Una recta pasa por los puntos (0, 2) y (2, 6). ¿Cuál es su pendiente?",
    opciones: [
      { id: "a", texto: "1" },
      { id: "b", texto: "2" },
      { id: "c", texto: "3" },
      { id: "d", texto: "4" },
    ],
    opcionCorrecta: "b",
    dificultad: "medio",
    retroalimentacion: "m = (6 − 2) / (2 − 0) = 4 / 2 = 2.",
  },
  {
    enunciado: "Si 2(x − 3) = x + 5, ¿cuánto vale x?",
    opciones: [
      { id: "a", texto: "x = 8" },
      { id: "b", texto: "x = 9" },
      { id: "c", texto: "x = 11" },
      { id: "d", texto: "x = 14" },
    ],
    opcionCorrecta: "c",
    dificultad: "dificil",
    retroalimentacion: "2x − 6 = x + 5 → x = 11.",
  },
];

export const cargarDatosDePrueba = internalMutation({
  args: {},
  handler: async (ctx) => {
    const insertado: string[] = [];
    const reparado: string[] = [];
    const ahora = Date.now();

    // ── 1. Grupos (upsert por nombre) ──────────────────────────────────────
    const gruposExistentes = await ctx.db.query("grupos").collect();
    const grupoIdPorNombre = new Map<string, Id<"grupos">>();
    for (const nombre of GRUPOS) {
      const encontrado = gruposExistentes.find((g) => g.nombre === nombre);
      if (encontrado) {
        grupoIdPorNombre.set(nombre, encontrado._id);
        continue;
      }
      const id = await ctx.db.insert("grupos", { nombre, ciclo: "2026-A", activo: true });
      grupoIdPorNombre.set(nombre, id);
      insertado.push(`grupo:${nombre}`);
    }

    // ── 2. Instructor autor (upsert por correo) ────────────────────────────
    const instructorEmail = norm(INSTRUCTOR_EMAIL);
    const instructorExistente = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", instructorEmail))
      .first();
    let instructorUserId: Id<"users">;
    if (instructorExistente) {
      instructorUserId = instructorExistente._id;
    } else {
      instructorUserId = await ctx.db.insert("users", {
        name: "Cristian Martínez",
        email: instructorEmail,
      });
      await ctx.db.insert("perfiles", {
        userId: instructorUserId,
        rol: "instructor",
        nombre: "Cristian",
        apellidos: "Martínez",
        activo: true,
      });
      insertado.push("instructor");
    }

    // ── 3. Tema (upsert por nombre) ────────────────────────────────────────
    const temasExistentes = await ctx.db.query("temas").collect();
    const temaExistente = temasExistentes.find((t) => t.nombre === "Ecuaciones lineales");
    let temaId: Id<"temas">;
    if (temaExistente) {
      temaId = temaExistente._id;
    } else {
      temaId = await ctx.db.insert("temas", {
        nombre: "Ecuaciones lineales",
        area: "Pensamiento matemático",
        orden: 1,
      });
      insertado.push("tema");
    }

    // ── 4. Reactivos (upsert por enunciado) ────────────────────────────────
    const reactivosExistentes = await ctx.db.query("reactivos").collect();
    for (const r of REACTIVOS) {
      if (reactivosExistentes.some((x) => x.enunciado === r.enunciado)) continue;
      await ctx.db.insert("reactivos", {
        enunciado: r.enunciado,
        opciones: r.opciones,
        opcionCorrecta: r.opcionCorrecta,
        temaId,
        dificultad: r.dificultad,
        retroalimentacion: r.retroalimentacion,
        autorId: instructorUserId,
        activo: true,
      });
      insertado.push("reactivo");
    }

    // ── 5. Alumnos (upsert por correo + REPARA el perfil al estado del fixture) ──
    for (const a of ALUMNOS) {
      const correo = norm(a.correo);
      const datosPerfil = {
        rol: "alumno" as const,
        nombre: a.nombre,
        apellidos: a.apellidos,
        grupoId: grupoIdPorNombre.get(a.grupo),
        activo: a.activo,
        ultimoAccesoEn:
          a.ultimoAccesoDias === null ? undefined : ahora - a.ultimoAccesoDias * DIA,
      };
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", correo))
        .first();
      if (user) {
        // Converger: reparar el perfil existente (grupo/estado/último acceso).
        const perfil = await ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();
        if (perfil) await ctx.db.patch(perfil._id, datosPerfil);
        else await ctx.db.insert("perfiles", { userId: user._id, ...datosPerfil });
        await ctx.db.patch(user._id, { name: nombreCompleto(a.nombre, a.apellidos) });
        reparado.push(a.nombre);
      } else {
        const userId = await ctx.db.insert("users", {
          name: nombreCompleto(a.nombre, a.apellidos),
          email: correo,
        });
        await ctx.db.insert("perfiles", { userId, ...datosPerfil });
        insertado.push(`alumno:${a.nombre}`);
      }
    }

    return {
      insertado,
      reparado,
      mensaje:
        insertado.length || reparado.length
          ? `Seed OK — insertado: ${insertado.length ? insertado.join(", ") : "nada"} · reparado: ${reparado.length ? reparado.join(", ") : "nada"}`
          : "Todo ya existía y estaba al día.",
    };
  },
});
