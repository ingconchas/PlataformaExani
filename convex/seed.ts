import { mutation } from "./_generated/server";

/**
 * Datos de PRUEBA para verificar la conexión con la base de datos.
 * Ejecutar con:  npx convex run seed:cargarDatosDePrueba
 *
 * Crea: 1 tema + 1 instructor (autor) + 1 alumno + 5 reactivos.
 * Es idempotente: si el alumno de prueba ya existe, no vuelve a insertar.
 *
 * NO es un seed de producción — bórralo o reemplázalo cuando existan los
 * flujos reales de alta (importación CSV, invitación, constructor, etc.).
 */

const ALUMNO_EMAIL = "fernanda.alumna@demo.unx.mx";
const INSTRUCTOR_EMAIL = "cristian.instructor@demo.unx.mx";

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

export const cargarDatosDePrueba = mutation({
  args: {},
  handler: async (ctx) => {
    // Idempotencia: si ya existe el alumno de prueba, no duplicar.
    const yaExiste = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", ALUMNO_EMAIL))
      .first();
    if (yaExiste) {
      return {
        yaExistia: true,
        mensaje:
          "Los datos de prueba ya estaban cargados; no se insertó nada nuevo.",
      };
    }

    // Instructor (autor de los reactivos)
    const instructorUserId = await ctx.db.insert("users", {
      name: "Cristian Martínez",
      email: INSTRUCTOR_EMAIL,
    });
    await ctx.db.insert("perfiles", {
      userId: instructorUserId,
      rol: "instructor",
      nombre: "Cristian",
      apellidos: "Martínez",
      activo: true,
    });

    // Alumno de prueba (lo que pediste ver)
    const alumnoUserId = await ctx.db.insert("users", {
      name: "Fernanda López",
      email: ALUMNO_EMAIL,
    });
    const alumnoPerfilId = await ctx.db.insert("perfiles", {
      userId: alumnoUserId,
      rol: "alumno",
      nombre: "Fernanda",
      apellidos: "López",
      telefono: "5512345678",
      activo: true,
    });

    // Tema requerido por los reactivos
    const temaId = await ctx.db.insert("temas", {
      nombre: "Ecuaciones lineales",
      area: "Pensamiento matemático",
      orden: 1,
    });

    // 5 reactivos
    const reactivoIds = [];
    for (const r of REACTIVOS) {
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
    }

    return {
      yaExistia: false,
      alumno: { perfilId: alumnoPerfilId, userId: alumnoUserId },
      instructor: instructorUserId,
      temaId,
      reactivos: reactivoIds,
      mensaje: `Alta correcta: 1 alumno, 1 instructor, 1 tema y ${reactivoIds.length} reactivos.`,
    };
  },
});
