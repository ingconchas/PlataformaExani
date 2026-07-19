import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { inicioDeMesMx } from "./fechas";
import { CONFIRMACION_SOLO_DEV, exigirDeploymentDeDesarrollo } from "./entorno";
import { canonizar } from "./texto";
import { construirTemario, recalcular, resolverClasificacion } from "./temario";

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

// ── Temario demo (LUI-18) ──────────────────────────────────────────────────
// SOLO dev. Producción recibe únicamente las 3 secciones del núcleo, por
// `bootstrap:sembrarTemarioNucleo`; las áreas y subtemas los captura Mayra.
//
// DISCRIMINANTE, no decorativo. Cada pieza está puesta para que una
// implementación mal hecha falle de forma VISIBLE:
//
//  · «Productos notables» — subtema INACTIVO **con reactivos**: el contador de
//    Álgebra debe incluirlos (es la regla del mock: 32 = 14+10+8, y ese 8 es el
//    inactivo). Un elemento desactivado conserva sus reactivos.
//  · «Textos expositivos» — área INACTIVA con un subtema ACTIVO debajo: sin esto,
//    la cascada de escritura y el efectivo-en-lectura son INDISTINGUIBLES. Si
//    alguien cascadea `activo:false` a los hijos, «Idea principal» dejaría de
//    estar activo y la prueba lo caza.
//  · «Triángulos» — subtema con CERO reactivos: debe decir 0 (y es el único
//    borrable cuando llegue la Entrega 2).
//  · «Biología» — módulo CON áreas · «Matemáticas financieras» — módulo PLANO:
//    cazan el separador MÓDULOS y el chevron que promete algo que no existe.
//  · El `orden` NO es alfabético a propósito (Aritmética antes que Álgebra;
//    Pensamiento matemático antes que Comprensión lectora): caza ordenar por
//    `nombre` en vez de por `orden`.
const TEMARIO_DEMO: Array<{
  seccion: string;
  tipo: "nucleo" | "modulo";
  areas: Array<{
    nombre: string;
    activo?: boolean;
    subtemas: Array<{ nombre: string; activo?: boolean }>;
  }>;
}> = [
  {
    seccion: "Pensamiento matemático",
    tipo: "nucleo",
    areas: [
      { nombre: "Aritmética", subtemas: [{ nombre: "Operaciones con fracciones" }] },
      {
        nombre: "Álgebra",
        subtemas: [
          { nombre: "Ecuaciones lineales" },
          { nombre: "Sistemas de ecuaciones" },
          { nombre: "Productos notables", activo: false },
        ],
      },
      { nombre: "Geometría", subtemas: [{ nombre: "Triángulos" }] },
    ],
  },
  {
    seccion: "Comprensión lectora",
    tipo: "nucleo",
    areas: [
      {
        nombre: "Textos expositivos",
        activo: false,
        subtemas: [{ nombre: "Idea principal" }],
      },
      // ⚠️ Área ACTIVA en Comprensión lectora (LUI-17). Sin ella, la ÚNICA área de la
      // sección estaría retirada, ningún subtema suyo sería `disponible`, y la cascada de
      // clasificación —que solo ofrece disponibles— haría IMPOSIBLE crear una lectura de
      // comprensión lectora por la UI. Es lo que vuelve verificable la feature.
      {
        nombre: "Textos argumentativos",
        subtemas: [{ nombre: "Tesis y argumentos" }],
      },
    ],
  },
  { seccion: "Redacción indirecta", tipo: "nucleo", areas: [] },
  {
    seccion: "Biología",
    tipo: "modulo",
    areas: [{ nombre: "Célula", subtemas: [{ nombre: "Membrana celular" }] }],
  },
  { seccion: "Matemáticas financieras", tipo: "modulo", areas: [] },
];

/** Ruta canónica de un subtema. La llave del upsert es el PATH, no el nombre:
 *  «Sucesiones» puede existir bajo Álgebra y bajo Geometría. */
const ruta = (seccion: string, area: string, subtema: string) =>
  [seccion, area, subtema].map(canonizar).join(" / ");

const REACTIVOS: Array<{
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  dificultad: "facil" | "medio" | "dificil";
  retroalimentacion: string;
  /** Ruta al subtema. Los reactivos se AÑADEN con contenido coherente en vez de
   *  reclasificar los de ecuaciones bajo «Comprensión lectora»: un fixture que
   *  miente no prueba nada. */
  en: [seccion: string, area: string, subtema: string];
  /** Solo el reactivo desactivado lo declara. Cuenta igual para el contador: sigue
   *  teniendo la referencia, así que sigue impidiendo el borrado del nodo. */
  activo?: boolean;
  /** Banco INSTITUCIONAL (LUI-14): por defecto el autor es el primer instructor;
   *  algunos declaran otro autor por correo para ejercitar «cada quien edita lo
   *  suyo» y el filtro por autor —incluido uno INACTIVO (Rubén)—. */
  autorCorreo?: string;
  /** Título de la lectura a la que pertenece (LUI-17) → pinta el chip «▤ Lectura». */
  lectura?: string;
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
    en: ["Pensamiento matemático", "Álgebra", "Ecuaciones lineales"],
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
    en: ["Pensamiento matemático", "Álgebra", "Ecuaciones lineales"],
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
    en: ["Pensamiento matemático", "Álgebra", "Ecuaciones lineales"],
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
    en: ["Pensamiento matemático", "Álgebra", "Ecuaciones lineales"],
    // Autor INACTIVO (Rubén, LUI-13): el filtro por autor del banco se deriva de
    // las FILAS, así que debe seguir siendo filtrable pese a estar desactivado.
    autorCorreo: "ruben.instructor@demo.unx.mx",
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
    en: ["Pensamiento matemático", "Álgebra", "Ecuaciones lineales"],
  },

  // ── Reactivos que hacen DISCRIMINANTE al contador (LUI-18) ───────────────
  // Se AÑADEN con contenido coherente en vez de reclasificar los de arriba: un
  // reactivo de ecuaciones colgado de «Comprensión lectora» sería un fixture que
  // miente y no probaría nada.

  // Otra área de la MISMA sección → caza el roll-up de nivel 1 (si solo se cuenta
  // la primera área, Pensamiento matemático daría 8 en vez de 10).
  {
    enunciado: "¿Cuál es el resultado de 3/4 + 1/6?",
    opciones: [
      { id: "a", texto: "4/10" },
      { id: "b", texto: "11/12" },
      { id: "c", texto: "1/2" },
      { id: "d", texto: "7/12" },
    ],
    opcionCorrecta: "b",
    dificultad: "medio",
    retroalimentacion: "Común denominador 12: 9/12 + 2/12 = 11/12.",
    en: ["Pensamiento matemático", "Aritmética", "Operaciones con fracciones"],
  },
  {
    enunciado: "¿Qué fracción es equivalente a 0.375?",
    opciones: [
      { id: "a", texto: "3/8" },
      { id: "b", texto: "3/5" },
      { id: "c", texto: "1/4" },
      { id: "d", texto: "5/8" },
    ],
    opcionCorrecta: "a",
    dificultad: "facil",
    // El `<` literal es a propósito (LUI-15 E2): reactivo LEGADO libre que el E2E edita
    // para probar que `textoPlanoAHtml` lo escapa y TipTap no lo interpreta como tag.
    retroalimentacion: "0.375 = 375/1000 = 3/8, y 3/8 < 1/2.",
    en: ["Pensamiento matemático", "Aritmética", "Operaciones con fracciones"],
  },

  // Segundo subtema de la MISMA área → caza contar solo el primero.
  {
    enunciado: "En el sistema x + y = 10 y x − y = 2, ¿cuánto vale x?",
    opciones: [
      { id: "a", texto: "4" },
      { id: "b", texto: "5" },
      { id: "c", texto: "6" },
      { id: "d", texto: "8" },
    ],
    opcionCorrecta: "c",
    dificultad: "medio",
    retroalimentacion: "Sumando ambas ecuaciones: 2x = 12 → x = 6.",
    en: ["Pensamiento matemático", "Álgebra", "Sistemas de ecuaciones"],
  },

  // CONTENIDO HISTÓRICO: cuelgan de un subtema RETIRADO. Es lo único que el seed
  // clasifica con `exigirDisponible:false`, y no es una puerta trasera: son
  // reactivos que nacieron cuando «Productos notables» estaba activo y
  // sobrevivieron a su retiro. El contador de Álgebra DEBE incluirlos.
  {
    enunciado: "¿Cuál es el desarrollo de (x + 3)²?",
    opciones: [
      { id: "a", texto: "x² + 9" },
      { id: "b", texto: "x² + 6x + 9" },
      { id: "c", texto: "x² + 3x + 9" },
      { id: "d", texto: "x² + 6x + 3" },
    ],
    opcionCorrecta: "b",
    dificultad: "facil",
    retroalimentacion: "(a+b)² = a² + 2ab + b² → x² + 6x + 9.",
    en: ["Pensamiento matemático", "Álgebra", "Productos notables"],
  },
  {
    // Además DESACTIVADO: si el contador filtrara por `reactivo.activo`, este
    // desaparecería del número y la pantalla diría un total que no cuadra con la
    // sonda del gate de borrado.
    enunciado: "¿Cuál es el resultado de (x + 5)(x − 5)?",
    opciones: [
      { id: "a", texto: "x² − 25" },
      { id: "b", texto: "x² + 25" },
      { id: "c", texto: "x² − 10x + 25" },
      { id: "d", texto: "x² − 5" },
    ],
    opcionCorrecta: "a",
    dificultad: "facil",
    retroalimentacion: "Binomios conjugados: (a+b)(a−b) = a² − b².",
    en: ["Pensamiento matemático", "Álgebra", "Productos notables"],
    activo: false,
  },

  // Bajo un área INACTIVA pero en un subtema ACTIVO → también histórico.
  {
    enunciado:
      "En un texto expositivo, ¿qué elemento expresa la idea principal de un párrafo?",
    opciones: [
      { id: "a", texto: "La oración temática" },
      { id: "b", texto: "El ejemplo final" },
      { id: "c", texto: "El conector inicial" },
      { id: "d", texto: "La cita de autoridad" },
    ],
    opcionCorrecta: "a",
    dificultad: "medio",
    retroalimentacion:
      "La oración temática enuncia la idea principal; el resto la desarrolla.",
    en: ["Comprensión lectora", "Textos expositivos", "Idea principal"],
    autorCorreo: "carlos.instructor@demo.unx.mx",
    lectura: "El calentamiento global",
  },

  // En un MÓDULO → prueba que un módulo con áreas sí admite reactivos.
  {
    enunciado: "¿Cuál es la función principal de la membrana celular?",
    opciones: [
      { id: "a", texto: "Sintetizar proteínas" },
      { id: "b", texto: "Regular el paso de sustancias" },
      { id: "c", texto: "Almacenar información genética" },
      { id: "d", texto: "Producir energía" },
    ],
    opcionCorrecta: "b",
    dificultad: "facil",
    retroalimentacion:
      "La membrana es semipermeable: controla qué entra y qué sale de la célula.",
    en: ["Biología", "Célula", "Membrana celular"],
    autorCorreo: "diana.instructor@demo.unx.mx",
  },
];

// ── Lecturas (LUI-17) ───────────────────────────────────────────────────────
// La única lectura del fixture queda como BLOQUE DE UNA sola pregunta, es decir
// «Incompleta» (publicar exige ≥ 2): fixture discriminante del gate de LUI-21 sin añadir
// reactivos nuevos —lo que habría roto los tres conteos absolutos de `e2e-lui14`—.
// Su clasificación es la misma rama RETIRADA donde vive su pregunta, así que también ejercita
// el camino histórico: se puede editar manteniendo la hoja, pero no admite preguntas nuevas.
// ⚠️ `autorCorreo` es el de su pregunta A PROPÓSITO: la autoría de una pregunta de bloque es
// la de su lectura, y si divergieran, `e2e-lui14` §7 (filtro por «Carlos Lora» = 1 fila) y §8
// dejarían de pasar.
const LECTURAS: {
  titulo: string;
  contenido: string;
  autorCorreo: string;
  en: [string, string, string];
  dificultad: "facil" | "medio" | "dificil";
}[] = [
  {
    titulo: "El calentamiento global",
    autorCorreo: "carlos.instructor@demo.unx.mx",
    en: ["Comprensión lectora", "Textos expositivos", "Idea principal"],
    dificultad: "medio",
    contenido:
      "El calentamiento global es el aumento sostenido de la temperatura media de la " +
      "Tierra, impulsado por la acumulación de gases de efecto invernadero de origen " +
      "humano. Sus efectos —deshielo, aumento del nivel del mar y clima extremo— ya son medibles.",
  },
];

// Reactivos que hacen DISCRIMINANTE el candado «En uso en un examen activo» (LUI-14),
// por enunciado. El resto de reactivos va a los exámenes publicados ABIERTOS.
const REACTIVO_SIN_EXAMEN = "¿Qué fracción es equivalente a 0.375?"; // (D) en ningún examen → LIBRE
const REACTIVO_SOLO_BORRADOR = "¿Cuál es el resultado de 3/4 + 1/6?"; // (A) solo en el borrador → LIBRE
const REACTIVO_SOLO_FUTURO =
  "En el sistema x + y = 10 y x − y = 2, ¿cuánto vale x?"; // (C) solo en SG3 (futura) → BLOQUEADO
// (LUI-15) Reactivo en rama RETIRADA («Productos notables») pero LIBRE (en ningún
// examen) → editable: fixture para probar «mantener una clasificación retirada al editar».
const REACTIVO_RETIRADO_LIBRE = "¿Cuál es el desarrollo de (x + 3)²?";

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
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
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

/**
 * Reset del fixture de contenido: temario, reactivos y todo el grafo que cuelga
 * de ellos.
 *
 * El upsert del seed CONVERGE pero no retira: si se renombra un subtema del
 * fixture o se le quita un reactivo, el viejo se queda ahí para siempre. Esta es
 * la salida — el precedente exacto es `limpiarAlumnosE2E`.
 *
 * Cascada deliberada: Convex no valida integridad referencial, así que borrar
 * solo `reactivos` no rompería nada de inmediato, pero dejaría
 * `examenes.reactivoIds` apuntando a fantasmas — y el upsert-por-nombre del seed
 * encontraría los exámenes existentes y conservaría las refs muertas para
 * siempre.
 *
 * ⚠️ Destructiva y amplia: por eso lleva los dos guards. Es 100 % dato demo
 * regenerable con `seed:cargarDatosDePrueba`.
 *
 * Ejecutar:
 *   npx convex run seed:limpiarContenidoDemo '{"confirmar":"SOLO_DEV"}'
 */
export const limpiarContenidoDemo = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const borrado: Record<string, number> = {};

    // Blobs de imagen (LUI-15 E3): borrar ANTES que los reactivos. Si no, el blob del
    // reactivo referenciado sobrevive (el sweeper lo conserva) y al desaparecer el doc
    // queda huérfano → el E2E fugaría storage entre corridas. Set = dedup, tolera datos
    // manuales/históricos que violen la exclusividad (sin doble-borrado).
    const reactivosConImagen = await ctx.db.query("reactivos").collect();
    const blobs = new Set(
      reactivosConImagen.flatMap((r) => (r.imagenId ? [r.imagenId] : [])),
    );
    for (const blob of blobs) await ctx.storage.delete(blob);
    borrado.imagenes = blobs.size;

    // Orden: de las hojas hacia la raíz del grafo de contenido.
    const tablas = [
      "respuestas",
      "intentos",
      "asignaciones",
      "examenes",
      "reactivos",
      "lecturas",
      "subtemas",
      "areasTematicas",
      "secciones",
    ] as const;
    for (const tabla of tablas) {
      const docs = await ctx.db.query(tabla).collect();
      for (const d of docs) await ctx.db.delete(d._id);
      borrado[tabla] = docs.length;
    }

    // Cuotas de subida (`subida_imagen:<userId>`): sin esto, cada corrida del E2E consume
    // tokens que se acumularían hasta gatillar el rate limit aunque el código esté bien.
    // La tabla `cuotas` es de decenas de filas (clave por usuario).
    const cuotas = await ctx.db.query("cuotas").collect();
    let cuotasSubida = 0;
    for (const c of cuotas)
      if (c.clave.startsWith("subida_imagen:")) {
        await ctx.db.delete(c._id);
        cuotasSubida++;
      }
    borrado.cuotasSubida = cuotasSubida;

    return { borrado };
  },
});

export const cargarDatosDePrueba = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
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

    // ── 3. Temario (upsert por PATH, no por nombre) ─────────────────────────
    // La llave es la ruta y no el nombre suelto: con jerarquía, dos subtemas
    // homónimos bajo padres distintos («Sucesiones» en Álgebra y en Geometría)
    // colisionarían con el upsert plano que había aquí antes.
    //
    // El núcleo NO se duplica en este archivo: sale de `bootstrap:sembrarTemarioNucleo`,
    // que consume la misma constante `NUCLEO` de `temario.ts`. Así dev y prod no
    // pueden divergir en los nombres.
    await ctx.runMutation(internal.bootstrap.sembrarTemarioNucleo, {});

    const subtemaPorRuta = new Map<string, Id<"subtemas">>();
    {
      const seccionesExistentes = await ctx.db.query("secciones").collect();
      const seccionPorNombre = new Map(
        seccionesExistentes.map((s) => [canonizar(s.nombre), s]),
      );

      for (const [iSeccion, nodo] of TEMARIO_DEMO.entries()) {
        let seccion = seccionPorNombre.get(canonizar(nodo.seccion));
        if (!seccion) {
          const id = await ctx.db.insert("secciones", {
            nombre: nodo.seccion,
            tipo: nodo.tipo,
            activo: true,
            orden: iSeccion,
            reactivosCount: 0,
          });
          seccion = (await ctx.db.get(id))!;
          seccionPorNombre.set(canonizar(nodo.seccion), seccion);
          insertado.push(`seccion:${nodo.seccion}`);
        }

        const areasExistentes = await ctx.db
          .query("areasTematicas")
          .withIndex("by_seccion_orden", (q) => q.eq("seccionId", seccion!._id))
          .collect();
        const areaPorNombre = new Map(
          areasExistentes.map((a) => [canonizar(a.nombre), a]),
        );

        for (const [iArea, defArea] of nodo.areas.entries()) {
          let area = areaPorNombre.get(canonizar(defArea.nombre));
          if (!area) {
            const id = await ctx.db.insert("areasTematicas", {
              seccionId: seccion._id,
              nombre: defArea.nombre,
              activo: defArea.activo ?? true,
              orden: iArea,
              reactivosCount: 0,
            });
            area = (await ctx.db.get(id))!;
            areaPorNombre.set(canonizar(defArea.nombre), area);
            insertado.push(`area:${defArea.nombre}`);
          }

          const subtemasExistentes = await ctx.db
            .query("subtemas")
            .withIndex("by_area_orden", (q) => q.eq("areaId", area!._id))
            .collect();
          const subtemaPorNombre = new Map(
            subtemasExistentes.map((s) => [canonizar(s.nombre), s]),
          );

          for (const [iSub, defSub] of defArea.subtemas.entries()) {
            let subtema = subtemaPorNombre.get(canonizar(defSub.nombre));
            if (!subtema) {
              const id = await ctx.db.insert("subtemas", {
                areaId: area._id,
                nombre: defSub.nombre,
                activo: defSub.activo ?? true,
                orden: iSub,
                reactivosCount: 0,
              });
              subtema = (await ctx.db.get(id))!;
              insertado.push(`subtema:${defSub.nombre}`);
            }
            subtemaPorRuta.set(
              ruta(nodo.seccion, defArea.nombre, defSub.nombre),
              subtema._id,
            );
          }
        }
      }
    }

    // ── 3b. Lecturas (upsert por título) — LUI-14/17 ───────────────────────
    // Deben existir ANTES que los reactivos: un reactivo referencia su lectura por
    // `lecturaId`. El seed casi no las usa; basta una, ligada a un reactivo, para
    // ejercitar el chip «▤ Lectura» y `reactivos.obtener`.
    const lecturasExistentes = await ctx.db.query("lecturas").collect();
    const lecturaIdPorTitulo = new Map<string, Id<"lecturas">>();
    const lecturaAutorPorTitulo = new Map<string, Id<"users">>();
    for (const l of LECTURAS) {
      const subtemaLectura = subtemaPorRuta.get(ruta(...l.en));
      if (!subtemaLectura) {
        throw new Error(
          `El fixture manda la lectura «${l.titulo}» a «${l.en.join(" / ")}», que no existe en TEMARIO_DEMO.`,
        );
      }
      // Mismo escape que los reactivos: el contenido HISTÓRICO (rama retirada) no puede
      // exigir `disponible`, o el seed truena.
      const ramaL = await ctx.db.get(subtemaLectura);
      const areaL = ramaL ? await ctx.db.get(ramaL.areaId) : null;
      const seccionL = areaL ? await ctx.db.get(areaL.seccionId) : null;
      const clasifLectura = await resolverClasificacion(ctx, subtemaLectura, {
        exigirDisponible: Boolean(
          ramaL?.activo && areaL?.activo && seccionL?.activo,
        ),
      });
      const autorLectura =
        instructorUserIdPorCorreo.get(norm(l.autorCorreo)) ?? instructorUserId;
      lecturaAutorPorTitulo.set(l.titulo, autorLectura);
      // CONVERGE todo lo que el fixture fija (no solo contenido y autor): una BD dev
      // sembrada antes de LUI-17 tiene lecturas SIN clasificación ni estado, y quedarían a
      // medio migrar. `contenidoFormato` se fija explícitamente para que el contenido y su
      // bandera no puedan desincronizarse.
      const datosLectura = {
        contenido: l.contenido,
        contenidoFormato: undefined, // el fixture es texto plano LEGADO, a propósito
        ...clasifLectura,
        dificultad: l.dificultad,
        autorId: autorLectura,
        activo: true,
      };
      const existente = lecturasExistentes.find((x) => x.titulo === l.titulo);
      if (existente) {
        await ctx.db.patch(existente._id, datosLectura);
        lecturaIdPorTitulo.set(l.titulo, existente._id);
        reparado.push(`lectura:${l.titulo}`);
      } else {
        const id = await ctx.db.insert("lecturas", {
          titulo: l.titulo,
          ...datosLectura,
        });
        lecturaIdPorTitulo.set(l.titulo, id);
        insertado.push(`lectura:${l.titulo}`);
      }
    }

    // ── 4. Reactivos (upsert por enunciado; converge autor/lectura) ────────
    // La membresía en exámenes ya NO se acumula aquí (era la misma para todos);
    // se decide POR examen en el paso 7 vía `reactivoIdPorEnunciado`.
    //
    // La clasificación pasa por `resolverClasificacion` como CUALQUIER escritor:
    // se manda solo `subtemaId` y el helper deriva área y sección. Aquí no se
    // arman las ternas a mano, porque entonces el seed no probaría el camino que
    // LUI-15 va a heredar.
    const reactivosExistentes = await ctx.db.query("reactivos").collect();
    const reactivoIdPorEnunciado = new Map<string, Id<"reactivos">>();
    for (const r of REACTIVOS) {
      // Autor: por defecto el primer instructor; algunos declaran otro (banco
      // INSTITUCIONAL de LUI-14 → varios autores). La lectura, si la hay, ya está
      // sembrada (paso 3b).
      const lecturaId = r.lectura ? lecturaIdPorTitulo.get(r.lectura) : undefined;
      // La autoría de una pregunta de BLOQUE es la de su lectura (LUI-17): si divergieran,
      // `esEditable` de la pregunta y el de su lectura se contradirían y el autor de la
      // pregunta podría retirarla del bloque de otro.
      const autorId = r.lectura
        ? (lecturaAutorPorTitulo.get(r.lectura) ?? instructorUserId)
        : (r.autorCorreo && instructorUserIdPorCorreo.get(norm(r.autorCorreo))) ||
          instructorUserId;
      // Los reactivos con lectura se siembran como BLOQUE. El `orden` es la posición del
      // reactivo dentro de los que declaran esa misma lectura.
      const bloque = lecturaId
        ? {
            lecturaId,
            orden: REACTIVOS.filter((x) => x.lectura === r.lectura).indexOf(r),
          }
        : undefined;

      const existente = reactivosExistentes.find(
        (x) => x.enunciado === r.enunciado,
      );
      if (existente) {
        // CONVERGER (antes hacía `continue` a secas): el fixture ahora fija autor,
        // lectura, dificultad y estado; una BD dev ya sembrada debe adoptarlos. NO
        // se toca la clasificación (subtemaId/areaId/seccionId) → los contadores del
        // temario (LUI-18) no se mueven. `lecturaId: undefined` limpia el campo,
        // igual que `puntaje: undefined` en los intentos.
        await ctx.db.patch(existente._id, {
          autorId,
          lecturaId: undefined, // campo DEPRECADO: lo sustituye `bloque` (Fase A)
          bloque,
          dificultad: r.dificultad,
          activo: r.activo ?? true,
        });
        reactivoIdPorEnunciado.set(r.enunciado, existente._id);
        reparado.push("reactivo");
        continue;
      }
      const subtemaId = subtemaPorRuta.get(ruta(...r.en));
      if (!subtemaId) {
        throw new Error(
          `El fixture manda un reactivo a «${r.en.join(" / ")}», que no existe en TEMARIO_DEMO.`,
        );
      }
      // Los reactivos que van a ramas vivas usan el DEFAULT ESTRICTO: si el
      // camino estricto rechazara por error un nodo disponible, el seed truena
      // aquí. Solo el contenido histórico (ramas retiradas) pide el escape.
      const rama = await ctx.db.get(subtemaId);
      const area = rama ? await ctx.db.get(rama.areaId) : null;
      const seccion = area ? await ctx.db.get(area.seccionId) : null;
      const esHistorico =
        !rama?.activo || !area?.activo || !seccion?.activo;
      const clasificacion = await resolverClasificacion(ctx, subtemaId, {
        exigirDisponible: !esHistorico,
      });

      const id = await ctx.db.insert("reactivos", {
        enunciado: r.enunciado,
        opciones: r.opciones,
        opcionCorrecta: r.opcionCorrecta,
        ...clasificacion,
        dificultad: r.dificultad,
        retroalimentacion: r.retroalimentacion,
        bloque,
        autorId,
        activo: r.activo ?? true,
      });
      reactivoIdPorEnunciado.set(r.enunciado, id);
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
    // Membresía de reactivos POR examen (ya NO la misma para todos), para que el
    // candado de LUI-14 discrimine:
    //  · el resto de reactivos → a los publicados ABIERTOS → BLOQUEADOS.
    //  · REACTIVO_SOLO_BORRADOR → solo al borrador (Simulacro Final) → LIBRE (un
    //    borrador no bloquea, aunque contenga el reactivo).
    //  · REACTIVO_SOLO_FUTURO → solo a SG3 (publicado, asignación FUTURA) →
    //    BLOQUEADO: prueba que «publicado con asignaciones» NO filtra por `abreEn`.
    //  · REACTIVO_SIN_EXAMEN → a ninguno → LIBRE.
    const todosLosReactivoIds = [...reactivoIdPorEnunciado.values()];
    const idSinExamen = reactivoIdPorEnunciado.get(REACTIVO_SIN_EXAMEN);
    const idSoloBorrador = reactivoIdPorEnunciado.get(REACTIVO_SOLO_BORRADOR);
    const idSoloFuturo = reactivoIdPorEnunciado.get(REACTIVO_SOLO_FUTURO);
    const idRetiradoLibre = reactivoIdPorEnunciado.get(REACTIVO_RETIRADO_LIBRE);
    const apartados = new Set(
      [idSinExamen, idSoloBorrador, idSoloFuturo, idRetiradoLibre].filter(
        Boolean,
      ) as Id<"reactivos">[],
    );
    const restoReactivos = todosLosReactivoIds.filter((id) => !apartados.has(id));
    const tituloFuturo = ASIGNACIONES.find((a) => a.cuando === "futura")?.examen;
    const membresiaDe = (e: (typeof EXAMENES)[number]): Id<"reactivos">[] => {
      if (e.estado === "borrador")
        return idSoloBorrador
          ? [...restoReactivos, idSoloBorrador]
          : restoReactivos;
      if (e.titulo === tituloFuturo)
        return idSoloFuturo ? [...restoReactivos, idSoloFuturo] : restoReactivos;
      return restoReactivos;
    };

    const examenesExistentes = await ctx.db.query("examenes").collect();
    const examenIdPorTitulo = new Map<string, Id<"examenes">>();
    for (const e of EXAMENES) {
      const datos = {
        titulo: e.titulo,
        descripcion: e.descripcion,
        reactivoIds: membresiaDe(e),
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

    // ── Oráculo del temario (LUI-18) ───────────────────────────────────────
    // Mismo principio que el del panel: se calcula **contra la BD REAL**, y con
    // un conteo PROPIO —independiente de `temario.construirTemario`— para que un
    // error en la query se cace igual.
    //
    // El conteo se hace leyendo `reactivos` y agregando aquí, NO leyendo
    // `reactivosCount`: si el oráculo se sirviera del contador denormalizado, no
    // podría cazar que ese contador esté mal, que es justo lo que debe vigilar.
    //
    // Cuenta TODOS los reactivos, activos e inactivos, y sube por el ÁRBOL (no por
    // las refs denormalizadas del reactivo): así el oráculo tampoco puede heredar
    // una terna incoherente.
    await recalcular(ctx);

    const reactivosFinal = await ctx.db.query("reactivos").collect();
    const subtemasFinal = await ctx.db.query("subtemas").collect();
    const areasFinal = await ctx.db.query("areasTematicas").collect();
    const seccionesFinal = await ctx.db.query("secciones").collect();

    const porSubtema = new Map<string, number>();
    for (const r of reactivosFinal) {
      porSubtema.set(r.subtemaId, (porSubtema.get(r.subtemaId) ?? 0) + 1);
    }
    const areaDeSubtema = new Map(subtemasFinal.map((s) => [s._id, s.areaId]));
    const seccionDeArea = new Map(areasFinal.map((a) => [a._id, a.seccionId]));

    const porArea = new Map<string, number>();
    const porSeccion = new Map<string, number>();
    for (const [subtemaId, n] of porSubtema) {
      const areaId = areaDeSubtema.get(subtemaId as Id<"subtemas">)!;
      porArea.set(areaId, (porArea.get(areaId) ?? 0) + n);
      const seccionId = seccionDeArea.get(areaId)!;
      porSeccion.set(seccionId, (porSeccion.get(seccionId) ?? 0) + n);
    }

    const temarioEsperado = {
      // Las secciones, en el orden que la pantalla DEBE mostrar: núcleo primero.
      nucleo: seccionesFinal
        .filter((s) => s.tipo === "nucleo")
        .sort((a, b) => a.orden - b.orden || a._creationTime - b._creationTime)
        .map((s) => ({ nombre: s.nombre, reactivos: porSeccion.get(s._id) ?? 0 })),
      modulos: seccionesFinal
        .filter((s) => s.tipo === "modulo")
        .sort((a, b) => a.orden - b.orden || a._creationTime - b._creationTime)
        .map((s) => ({ nombre: s.nombre, reactivos: porSeccion.get(s._id) ?? 0 })),
      areas: areasFinal.map((a) => ({
        nombre: a.nombre,
        activo: a.activo,
        reactivos: porArea.get(a._id) ?? 0,
      })),
      subtemas: subtemasFinal.map((s) => ({
        nombre: s.nombre,
        activo: s.activo,
        reactivos: porSubtema.get(s._id) ?? 0,
      })),
      totalFilas: (await construirTemario(ctx)).length,
    };

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
      temarioEsperado,
      mensaje:
        insertado.length || reparado.length
          ? `Seed OK — insertado: ${insertado.length ? insertado.join(", ") : "nada"} · reparado: ${reparado.length ? reparado.join(", ") : "nada"}`
          : "Todo ya existía y estaba al día.",
    };
  },
});
