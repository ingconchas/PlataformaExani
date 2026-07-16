import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { inicioDeMesMx } from "./fechas";

/**
 * Datos de PRUEBA (ficticios) para desarrollo local.
 * Ejecutar con:  npx convex run seed:cargarDatosDePrueba
 *
 * Idempotente POR ENTIDAD: cada grupo se busca por nombre, cada persona por
 * correo, cada reactivo por enunciado. Volver a correrlo solo inserta lo que
 * falte (nunca duplica ni corta al primer registro existente).
 *
 * ⚠️ Datos ficticios a propósito (demo local). Las lecturas/escrituras de la app
 * ya exigen sesión de admin (LUI-7); este seed corre por CLI como
 * `internalMutation` (fuera del gate). NO usar con datos reales.
 *
 * Es `internalMutation`: NO forma parte de la API pública (no se puede llamar
 * desde el cliente/HTTP); solo se ejecuta con el CLI de confianza
 * (`npx convex run seed:cargarDatosDePrueba`).
 */

const DIA = 24 * 60 * 60 * 1000;
const norm = (correo: string) => correo.trim().toLowerCase();
const nombreCompleto = (nombre: string, apellidos: string) =>
  [nombre, apellidos].filter(Boolean).join(" ");

type Turno = "matutino" | "vespertino" | "sabatino";
const GRUPOS: { nombre: string; turno: Turno }[] = [
  { nombre: "Matutino A", turno: "matutino" },
  { nombre: "Vespertino B", turno: "vespertino" },
  { nombre: "Sabatino C", turno: "sabatino" },
];

// Instructores demo con materia (LUI-12). El primero es autor de los reactivos.
const INSTRUCTORES: {
  nombre: string;
  apellidos: string;
  correo: string;
  materia: string;
  activo?: boolean; // default true; Rubén queda inactivo (LUI-13: estado + tolerancia)
}[] = [
  { nombre: "Cristian", apellidos: "Martínez", correo: "cristian.instructor@demo.unx.mx", materia: "Matemáticas" },
  { nombre: "Carlos", apellidos: "Lora", correo: "carlos.instructor@demo.unx.mx", materia: "Español" },
  { nombre: "Diana", apellidos: "Peña", correo: "diana.instructor@demo.unx.mx", materia: "Física" },
  { nombre: "Rubén", apellidos: "Cano", correo: "ruben.instructor@demo.unx.mx", materia: "Historia", activo: false },
];

// Administradores demo. Al iniciar sesión como Mayra, ella es la «cuenta propia»
// (por userId de sesión): no puede editarse ni desactivarse a sí misma.
const ADMINS: { nombre: string; apellidos: string; correo: string }[] = [
  { nombre: "Mayra", apellidos: "Torres", correo: "mayra.admin@demo.unx.mx" },
];

// Qué instructores imparten en cada grupo (por correo) — ejercita 1, 2 y 3 por grupo.
const GRUPO_INSTRUCTORES: Record<string, string[]> = {
  "Matutino A": ["cristian.instructor@demo.unx.mx", "carlos.instructor@demo.unx.mx"],
  "Vespertino B": ["diana.instructor@demo.unx.mx", "ruben.instructor@demo.unx.mx"],
  "Sabatino C": [
    "cristian.instructor@demo.unx.mx",
    "carlos.instructor@demo.unx.mx",
    "diana.instructor@demo.unx.mx",
  ],
};

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

// ── Exámenes, asignaciones e intentos (LUI-9) ───────────────────────────────
// Existen para que el panel de la administradora sea VERIFICABLE: sin ellos,
// «Exámenes aplicados este mes» siempre da 0 y la tabla siempre sale vacía.
//
// El fixture es DISCRIMINANTE, no decorativo: cada dato está puesto para que una
// implementación mal hecha falle de forma VISIBLE. Ver el comentario de cada uno.

type Cuando = "esteMes" | "mesPasado" | "futura";

const EXAMENES: {
  titulo: string;
  descripcion: string;
  duracionMin: number;
  estado: "borrador" | "publicado";
}[] = [
  { titulo: "Diagnóstico por áreas", descripcion: "Evaluación inicial de las cuatro áreas del EXANI II.", duracionMin: 90, estado: "publicado" },
  { titulo: "Simulacro General 1", descripcion: "Primer simulacro completo.", duracionMin: 180, estado: "publicado" },
  { titulo: "Simulacro General 2", descripcion: "Segundo simulacro completo.", duracionMin: 180, estado: "publicado" },
  { titulo: "Simulacro General 3", descripcion: "Tercer simulacro completo.", duracionMin: 180, estado: "publicado" },
  // Sin asignar y en borrador: ejercita `estado` y el índice `by_estado`.
  { titulo: "Simulacro Final", descripcion: "En construcción.", duracionMin: 180, estado: "borrador" },
];

/** La identidad de una asignación en el fixture es el par (examen, grupo). */
const ASIGNACIONES: {
  examen: string;
  grupo: string;
  cuando: Cuando;
  /** "activasDelGrupo" = todas las alumnas activas del grupo; [] = nadie la presentó. */
  presentan: "activasDelGrupo" | string[];
  /** Correo de quien REINTENTÓ: 2º intento con +150 pts (caza promediar todos). */
  reintenta?: string;
  /** Correo de quien tiene un intento `en_curso` SIN puntaje (caza el NaN). */
  enCurso?: string;
}[] = [
  // Mes pasado (2): historia. NO cuentan en «este mes» — si falta el filtro de
  // mes, la métrica sale 9 en vez de 7.
  { examen: "Diagnóstico por áreas", grupo: "Matutino A", cuando: "mesPasado", presentan: "activasDelGrupo" },
  { examen: "Diagnóstico por áreas", grupo: "Vespertino B", cuando: "mesPasado", presentan: "activasDelGrupo" },
  // Este mes (7), del MÁS ANTIGUO al MÁS RECIENTE. La métrica debe decir 7 y la
  // tabla mostrar solo las 5 últimas → si alguien calcula la métrica como
  // `ultimosExamenes.length`, sale 5 y se caza.
  { examen: "Simulacro General 1", grupo: "Matutino A", cuando: "esteMes", presentan: "activasDelGrupo" },
  { examen: "Simulacro General 1", grupo: "Vespertino B", cuando: "esteMes", presentan: "activasDelGrupo" },
  { examen: "Simulacro General 1", grupo: "Sabatino C", cuando: "esteMes", presentan: "activasDelGrupo" },
  { examen: "Simulacro General 2", grupo: "Matutino A", cuando: "esteMes", presentan: "activasDelGrupo", reintenta: "ana.lopez@correo.com" },
  { examen: "Simulacro General 2", grupo: "Vespertino B", cuando: "esteMes", presentan: "activasDelGrupo" },
  { examen: "Simulacro General 2", grupo: "Sabatino C", cuando: "esteMes", presentan: "activasDelGrupo", enCurso: "emiliano.rios@correo.com" },
  // Sin intentos: la celda de puntaje debe decir «—», nunca 0.
  { examen: "Diagnóstico por áreas", grupo: "Sabatino C", cuando: "esteMes", presentan: [] },
  // Futura: la ventana aún no abre → ni métrica ni tabla. Si falta
  // `abreEn <= ahora`, ESTE encabeza «Últimos exámenes APLICADOS».
  { examen: "Simulacro General 3", grupo: "Matutino A", cuando: "futura", presentan: [] },
];

/**
 * Puntaje EXANI ficticio pero ESTABLE: hash determinista de (examen, grupo,
 * alumna) en la escala 700–1300. Nada de `Math.random()`: reescribiría puntajes
 * distintos en cada corrida y volvería ruidoso el demo — este archivo CONVERGE,
 * no aleatoriza.
 *
 * ⚠️ NO implementa la fórmula real del PRD (`700 + aciertos × 600 ÷ N`): eso es de
 * la Fase 5 (LUI-26/27/28). Aquí solo hacen falta números plausibles en rango.
 */
function puntajeDemo(clave: string): number {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return 700 + (h % 601);
}

/**
 * Desactiva TODO alumno del namespace de pruebas `e2e.*@example.com`.
 *
 * Existe porque `scripts/e2e-lui103.mjs` crea alumnos y, sin esto, **contaminaba
 * la base que prueba**: cualquier métrica de «alumnos activos» (p. ej. el panel de
 * LUI-9) quedaba envenenada y sus pruebas fallaban con el código correcto.
 *
 * Va aquí y no por la UI a propósito: barrer con Playwright dependía de
 * re-renders, modales y timings — se colgaba, barría de a uno y perdía la
 * limpieza en silencio. La limpieza de un fixture es una operación de datos, no
 * un flujo de usuario.
 *
 * Desactiva en vez de borrar: es la única baja que el modelo permite (la app no
 * tiene borrado) y basta, porque las métricas cuentan activos. `internalMutation`
 * ⇒ CLI-only, fuera de la API pública. Solo toca `@example.com` (RFC 2606: un
 * dominio reservado que no puede pertenecer a nadie real).
 */
export const limpiarAlumnosE2E = internalMutation({
  args: {},
  handler: async (ctx) => {
    const perfiles = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .collect();
    const barridos: string[] = [];
    for (const p of perfiles) {
      if (!p.activo) continue;
      const user = await ctx.db.get(p.userId);
      const correo = user?.email ?? "";
      if (!correo.startsWith("e2e.") || !correo.endsWith("@example.com")) continue;
      await ctx.db.patch(p._id, { activo: false });
      barridos.push(correo);
    }
    return { barridos: barridos.length, correos: barridos };
  },
});

export const cargarDatosDePrueba = internalMutation({
  args: {},
  handler: async (ctx) => {
    const insertado: string[] = [];
    const reparado: string[] = [];
    const ahora = Date.now();

    // ── 1. Grupos (upsert por nombre; converge turno) ──────────────────────
    const gruposExistentes = await ctx.db.query("grupos").collect();
    const grupoIdPorNombre = new Map<string, Id<"grupos">>();
    for (const g of GRUPOS) {
      const encontrado = gruposExistentes.find((x) => x.nombre === g.nombre);
      if (encontrado) {
        grupoIdPorNombre.set(g.nombre, encontrado._id);
        if (encontrado.turno !== g.turno) {
          await ctx.db.patch(encontrado._id, { turno: g.turno });
          reparado.push(`grupo:${g.nombre}(turno)`);
        }
        continue;
      }
      const id = await ctx.db.insert("grupos", {
        nombre: g.nombre,
        ciclo: "2026-A",
        turno: g.turno,
        activo: true,
      });
      grupoIdPorNombre.set(g.nombre, id);
      insertado.push(`grupo:${g.nombre}`);
    }

    // ── 2. Instructores (upsert por correo; converge materia) ──────────────
    const instructorUserIdPorCorreo = new Map<string, Id<"users">>();
    for (const inst of INSTRUCTORES) {
      const correo = norm(inst.correo);
      const datosPerfil = {
        rol: "instructor" as const,
        nombre: inst.nombre,
        apellidos: inst.apellidos,
        materia: inst.materia,
        activo: inst.activo ?? true,
      };
      const nombre = nombreCompleto(inst.nombre, inst.apellidos);
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", correo))
        .first();
      if (user) {
        instructorUserIdPorCorreo.set(correo, user._id);
        await ctx.db.patch(user._id, { name: nombre });
        const perfil = await ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();
        if (perfil) {
          await ctx.db.patch(perfil._id, datosPerfil);
          reparado.push(`instructor:${inst.nombre}`);
        } else {
          await ctx.db.insert("perfiles", { userId: user._id, ...datosPerfil });
          insertado.push(`instructor:${inst.nombre}`);
        }
      } else {
        const userId = await ctx.db.insert("users", { name: nombre, email: correo });
        await ctx.db.insert("perfiles", { userId, ...datosPerfil });
        instructorUserIdPorCorreo.set(correo, userId);
        insertado.push(`instructor:${inst.nombre}`);
      }
    }
    // Autor de los reactivos = primer instructor (Cristian, Matemáticas).
    const instructorUserId = instructorUserIdPorCorreo.get(
      norm(INSTRUCTORES[0].correo),
    )!;

    // ── 2b. Administradores (upsert por correo) ────────────────────────────
    for (const adm of ADMINS) {
      const correo = norm(adm.correo);
      const datosPerfil = {
        rol: "admin" as const,
        nombre: adm.nombre,
        apellidos: adm.apellidos,
        activo: true,
      };
      const nombre = nombreCompleto(adm.nombre, adm.apellidos);
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", correo))
        .first();
      if (user) {
        await ctx.db.patch(user._id, { name: nombre });
        const perfil = await ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first();
        if (perfil) {
          await ctx.db.patch(perfil._id, datosPerfil);
          reparado.push(`admin:${adm.nombre}`);
        } else {
          await ctx.db.insert("perfiles", { userId: user._id, ...datosPerfil });
          insertado.push(`admin:${adm.nombre}`);
        }
      } else {
        const userId = await ctx.db.insert("users", { name: nombre, email: correo });
        await ctx.db.insert("perfiles", { userId, ...datosPerfil });
        insertado.push(`admin:${adm.nombre}`);
      }
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
    // Se acumulan los ids: `examenes.reactivoIds` los necesita (LUI-9). Solo los
    // del fixture — nunca los que un instructor haya creado desde la UI.
    const reactivosExistentes = await ctx.db.query("reactivos").collect();
    const reactivoIds: Id<"reactivos">[] = [];
    for (const r of REACTIVOS) {
      const existente = reactivosExistentes.find(
        (x) => x.enunciado === r.enunciado,
      );
      if (existente) {
        reactivoIds.push(existente._id);
        continue;
      }
      const id = await ctx.db.insert("reactivos", {
        enunciado: r.enunciado,
        opciones: r.opciones,
        opcionCorrecta: r.opcionCorrecta,
        temaId,
        dificultad: r.dificultad,
        retroalimentacion: r.retroalimentacion,
        autorId: instructorUserId,
        activo: true,
      });
      reactivoIds.push(id);
      insertado.push("reactivo");
    }

    // ── 5. Alumnos (upsert por correo + REPARA el perfil al estado del fixture) ──
    // El mapa correo→userId lo consumen los intentos (paso 9, LUI-9).
    const alumnoUserIdPorCorreo = new Map<string, Id<"users">>();
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
        alumnoUserIdPorCorreo.set(correo, user._id);
        reparado.push(a.nombre);
      } else {
        const userId = await ctx.db.insert("users", {
          name: nombreCompleto(a.nombre, a.apellidos),
          email: correo,
        });
        await ctx.db.insert("perfiles", { userId, ...datosPerfil });
        alumnoUserIdPorCorreo.set(correo, userId);
        insertado.push(`alumno:${a.nombre}`);
      }
    }

    // ── 6. Grupo↔instructor (upsert por par, evita duplicados) ─────────────
    for (const [nombreGrupo, correos] of Object.entries(GRUPO_INSTRUCTORES)) {
      const grupoId = grupoIdPorNombre.get(nombreGrupo);
      if (!grupoId) continue;
      const existentes = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect();
      const yaLigados = new Set(existentes.map((r) => r.instructorId as string));
      for (const correo of correos) {
        const instructorId = instructorUserIdPorCorreo.get(norm(correo));
        if (!instructorId || yaLigados.has(instructorId as string)) continue;
        await ctx.db.insert("grupoInstructores", { grupoId, instructorId });
        yaLigados.add(instructorId as string);
        insertado.push(`grupo-instructor:${nombreGrupo}`);
      }
    }

    // ── 7. Exámenes (upsert por título; converge los campos) ───────────────
    const examenesExistentes = await ctx.db.query("examenes").collect();
    const examenIdPorTitulo = new Map<string, Id<"examenes">>();
    for (const e of EXAMENES) {
      const datos = {
        titulo: e.titulo,
        descripcion: e.descripcion,
        reactivoIds,
        duracionMin: e.duracionMin,
        estado: e.estado,
        autorId: instructorUserId,
      };
      const existente = examenesExistentes.find((x) => x.titulo === e.titulo);
      if (existente) {
        await ctx.db.patch(existente._id, datos);
        examenIdPorTitulo.set(e.titulo, existente._id);
        reparado.push(`examen:${e.titulo}`);
      } else {
        const id = await ctx.db.insert("examenes", datos);
        examenIdPorTitulo.set(e.titulo, id);
        insertado.push(`examen:${e.titulo}`);
      }
    }

    // ── 8. Asignaciones (upsert por el par examen+grupo) ───────────────────
    // ⚠️ Las fechas son RELATIVAS y se recalculan en cada corrida (igual que
    // `ultimoAccesoEn`): el seed CONVERGE, no congela. Una fecha fija tipo
    // 2026-07-06 se saldría de «este mes» el mes siguiente y rompería el AC para
    // el próximo que revise.
    //
    // Y se anclan al INICIO DE MES, no a «N días atrás»: si el seed corre el día 2,
    // un `ahora − 5 días` caería en el mes pasado y la métrica se desplomaría. Se
    // reparten en el hueco [inicioDeMes, ahora] con paso = (ahora−inicio)/(n+1):
    // el día 1 quedan a minutos de distancia y el día 28 a días — en ambos casos
    // dentro del mes y SIEMPRE en el pasado.
    const inicioMes = inicioDeMesMx(ahora);
    const delMes = ASIGNACIONES.filter((a) => a.cuando === "esteMes");
    const delMesPasado = ASIGNACIONES.filter((a) => a.cuando === "mesPasado");
    const paso = (ahora - inicioMes) / (delMes.length + 1);

    function abreEnDe(a: (typeof ASIGNACIONES)[number]): number {
      if (a.cuando === "futura") return ahora + 7 * DIA;
      if (a.cuando === "mesPasado") {
        // 10 y 3 días ANTES del día 1 → siempre caen en el mes anterior.
        return inicioMes - (10 - 7 * delMesPasado.indexOf(a)) * DIA;
      }
      return Math.round(inicioMes + (delMes.indexOf(a) + 1) * paso);
    }

    const asignacionesExistentes = await ctx.db.query("asignaciones").collect();
    const alumnosActivosPorGrupo = new Map<string, string[]>();
    for (const a of ALUMNOS) {
      if (!a.activo) continue;
      const lista = alumnosActivosPorGrupo.get(a.grupo) ?? [];
      lista.push(norm(a.correo));
      alumnosActivosPorGrupo.set(a.grupo, lista);
    }

    for (const asig of ASIGNACIONES) {
      const examenId = examenIdPorTitulo.get(asig.examen);
      const grupoId = grupoIdPorNombre.get(asig.grupo);
      if (!examenId || !grupoId) continue;

      const abreEn = abreEnDe(asig);
      const datos = {
        examenId,
        grupoId,
        abreEn,
        cierraEn: abreEn + 21 * DIA, // ventana larga: la mayoría siguen ABIERTAS
        creadoPor: instructorUserId,
      };
      const existente = asignacionesExistentes.find(
        (x) => x.examenId === examenId && x.grupoId === grupoId,
      );
      let asignacionId: Id<"asignaciones">;
      if (existente) {
        await ctx.db.patch(existente._id, datos);
        asignacionId = existente._id;
        reparado.push(`asignacion:${asig.examen}·${asig.grupo}`);
      } else {
        asignacionId = await ctx.db.insert("asignaciones", datos);
        insertado.push(`asignacion:${asig.examen}·${asig.grupo}`);
      }

      // ── 9. Intentos de esta asignación ──────────────────────────────────
      const correos =
        asig.presentan === "activasDelGrupo"
          ? (alumnosActivosPorGrupo.get(asig.grupo) ?? [])
          : asig.presentan.map(norm);

      for (const correo of correos) {
        const alumnoId = alumnoUserIdPorCorreo.get(correo);
        if (!alumnoId) continue;

        // Los instantes exactos no los muestra el panel; lo único que importa es
        // (a) que caigan en el pasado y (b) el ORDEN entre los intentos de una
        // misma alumna. Como fracción del tiempo transcurrido desde `abreEn`,
        // siempre quedan en el pasado por reciente que sea la ventana.
        const enVentana = (f: number) => Math.round(abreEn + (ahora - abreEn) * f);
        const base = puntajeDemo(`${asig.examen}|${asig.grupo}|${correo}`);

        type FixtureIntento = {
          estado: "en_curso" | "enviado";
          iniciadoEn: number;
          enviadoEn?: number;
          puntaje?: number;
        };
        const fixture: FixtureIntento[] = [];

        if (asig.enCurso === correo) {
          // Sin puntaje y sin enviar: si el promedio no filtra, sale NaN.
          fixture.push({ estado: "en_curso", iniciadoEn: enVentana(0.5) });
        } else {
          fixture.push({
            estado: "enviado",
            iniciadoEn: enVentana(0.2),
            enviadoEn: enVentana(0.3),
            puntaje: base,
          });
          if (asig.reintenta === correo) {
            // 2º intento MEJOR (+150): si se promedian todos los intentos, o se
            // toma el último, el número SUBE de forma detectable.
            fixture.push({
              estado: "enviado",
              iniciadoEn: enVentana(0.6),
              enviadoEn: enVentana(0.7),
              puntaje: Math.min(1300, base + 150),
            });
          }
        }

        // Convergen por (asignación, alumna) + POSICIÓN cronológica. El modelo no
        // tiene `numeroIntento` (LUI-104), así que el orden de los intentos de una
        // alumna solo existe como `iniciadoEn` — que cambia en cada corrida y por
        // tanto NO sirve de clave. Se reconcilia por posición: los existentes del
        // par, ordenados por `iniciadoEn`, se parchean contra el i-ésimo del
        // fixture; los que falten se insertan. Converge sin duplicar y sin borrar.
        const previos = (
          await ctx.db
            .query("intentos")
            .withIndex("by_asignacion", (q) => q.eq("asignacionId", asignacionId))
            .collect()
        )
          .filter((i) => i.alumnoId === alumnoId)
          .sort((a, b) => a.iniciadoEn - b.iniciadoEn);

        for (let k = 0; k < fixture.length; k++) {
          const datosIntento = { examenId, alumnoId, asignacionId, ...fixture[k] };
          const previo = previos[k];
          if (previo) {
            // `patch` con `puntaje: undefined` ELIMINA el campo — es justo lo que
            // necesita el intento `en_curso`. Mismo mecanismo que `ultimoAccesoEn`.
            await ctx.db.patch(previo._id, datosIntento);
          } else {
            await ctx.db.insert("intentos", datosIntento);
            insertado.push(`intento:${asig.examen}·${correo}`);
          }
        }
      }
    }

    // ── Oráculo del panel (LUI-9) ──────────────────────────────────────────
    // Lo que /admin DEBE mostrar. Se calcula con el código de conteo PROPIO del
    // seed —una reimplementación independiente de `panel.resumen`, así que un
    // error de conteo en la query se caza igual— pero **contra la BD REAL**, no
    // contra los arrays del fixture.
    //
    // Esto último importa: `scripts/e2e-lui103.mjs` crea alumnos y la BD de dev
    // puede tener habitantes que el fixture desconoce. Un oráculo que dijera
    // «8 alumnos» porque `ALUMNOS.length === 9` sería FALSO y haría fallar la
    // prueba con el código correcto.
    const gruposFinal = await ctx.db.query("grupos").collect();
    const alumnosFinal = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .collect();
    const asignacionesFinal = await ctx.db.query("asignaciones").collect();
    const examenPorId = new Map(
      (await ctx.db.query("examenes").collect()).map((e) => [e._id, e.titulo]),
    );
    const grupoPorId = new Map(gruposFinal.map((g) => [g._id, g.nombre]));

    const aplicadasDelMes = asignacionesFinal.filter(
      (a) => a.abreEn >= inicioMes && a.abreEn <= ahora,
    );
    const ultimas = asignacionesFinal
      .filter((a) => a.abreEn <= ahora)
      .sort((a, b) => b.abreEn - a.abreEn)
      .slice(0, 5);

    return {
      insertado,
      reparado,
      panelEsperado: {
        gruposActivos: gruposFinal.filter((g) => g.activo).length,
        alumnosRegistrados: alumnosFinal.filter((p) => p.activo).length,
        examenesAplicadosMes: aplicadasDelMes.length,
        ultimosExamenes: ultimas.map((a) => ({
          examen: examenPorId.get(a.examenId) ?? "?",
          grupo: grupoPorId.get(a.grupoId) ?? "?",
        })),
      },
      mensaje:
        insertado.length || reparado.length
          ? `Seed OK — insertado: ${insertado.length ? insertado.join(", ") : "nada"} · reparado: ${reparado.length ? reparado.join(", ") : "nada"}`
          : "Todo ya existía y estaba al día.",
    };
  },
});
