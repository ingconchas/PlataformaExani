import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Modelo de datos inicial — Plataforma Exani II (UNX Simuladores).
 *
 * Punto de partida derivado del PRD v2 y del UNX Design System v1.2. Refínalo
 * conforme construyas cada pantalla (añade/ajusta campos e índices).
 *
 * Incluye `authTables` de Convex Auth (acceso por correo + contraseña —
 * LUI-8 login, LUI-103 invitación y recuperación). authTables aporta las
 * tablas `users`, `authAccounts`, `authSessions`, etc.
 *
 * Roles: `admin` e `instructor` usan el panel institucional; `alumno` usa la
 * app de la alumna. El rol vive en `perfiles`, ligado a `users`.
 */
export default defineSchema({
  // ── Autenticación (Convex Auth) ──────────────────────────────────────────
  ...authTables,

  // Perfil y rol de cada usuario. Extiende la tabla `users` de authTables.
  perfiles: defineTable({
    userId: v.id("users"),
    rol: v.union(
      v.literal("admin"),
      v.literal("instructor"),
      v.literal("alumno"),
    ),
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    telefono: v.optional(v.string()),
    grupoId: v.optional(v.id("grupos")), // alumno: grupo al que pertenece
    activo: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_rol", ["rol"])
    .index("by_grupo", ["grupoId"]),

  // Grupos de la institución (un instructor a cargo).
  grupos: defineTable({
    nombre: v.string(),
    ciclo: v.optional(v.string()),
    instructorId: v.optional(v.id("users")),
    activo: v.boolean(),
  }).index("by_instructor", ["instructorId"]),

  // Temario canónico del EXANI II (jerárquico: área → tema).
  temas: defineTable({
    nombre: v.string(),
    area: v.string(),
    parentId: v.optional(v.id("temas")),
    orden: v.number(),
  })
    .index("by_area", ["area"])
    .index("by_parent", ["parentId"]),

  // Lecturas: pasajes que agrupan varios reactivos.
  lecturas: defineTable({
    titulo: v.string(),
    contenido: v.string(),
    autorId: v.id("users"),
  }).index("by_autor", ["autorId"]),

  // Banco de reactivos (preguntas de opción múltiple).
  reactivos: defineTable({
    enunciado: v.string(),
    opciones: v.array(v.object({ id: v.string(), texto: v.string() })),
    opcionCorrecta: v.string(), // id de la opción correcta
    temaId: v.id("temas"),
    dificultad: v.union(
      v.literal("facil"),
      v.literal("medio"),
      v.literal("dificil"),
    ),
    lecturaId: v.optional(v.id("lecturas")),
    imagenId: v.optional(v.id("_storage")), // imagen opcional (Convex file storage)
    retroalimentacion: v.optional(v.string()),
    autorId: v.id("users"),
    activo: v.boolean(),
  })
    .index("by_tema", ["temaId"])
    .index("by_lectura", ["lecturaId"])
    .index("by_autor", ["autorId"]),

  // Exámenes armados con el constructor (conjunto ordenado de reactivos).
  examenes: defineTable({
    titulo: v.string(),
    descripcion: v.optional(v.string()),
    reactivoIds: v.array(v.id("reactivos")),
    duracionMin: v.number(),
    estado: v.union(v.literal("borrador"), v.literal("publicado")),
    autorId: v.id("users"),
  })
    .index("by_autor", ["autorId"])
    .index("by_estado", ["estado"]),

  // Asignación de un examen a un grupo, con ventana de aplicación.
  asignaciones: defineTable({
    examenId: v.id("examenes"),
    grupoId: v.id("grupos"),
    abreEn: v.number(), // epoch ms
    cierraEn: v.number(),
    creadoPor: v.id("users"),
  })
    .index("by_grupo", ["grupoId"])
    .index("by_examen", ["examenId"]),

  // Intento / simulacro de una alumna sobre un examen.
  intentos: defineTable({
    examenId: v.id("examenes"),
    alumnoId: v.id("users"),
    asignacionId: v.optional(v.id("asignaciones")),
    estado: v.union(v.literal("en_curso"), v.literal("enviado")),
    iniciadoEn: v.number(),
    enviadoEn: v.optional(v.number()),
    puntaje: v.optional(v.number()), // puntaje EXANI (protagonista de resultados)
  })
    .index("by_alumno", ["alumnoId"])
    .index("by_examen", ["examenId"])
    .index("by_asignacion", ["asignacionId"]),

  // Respuesta por reactivo dentro de un intento.
  respuestas: defineTable({
    intentoId: v.id("intentos"),
    reactivoId: v.id("reactivos"),
    opcionElegida: v.optional(v.string()),
    correcta: v.optional(v.boolean()),
    segundos: v.optional(v.number()),
  }).index("by_intento", ["intentoId"]),
});
