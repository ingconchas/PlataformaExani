import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { camposDestino, destinoDeFila } from "./asignacionDestino";
import { inicioDeMesMx } from "./fechas";
import { CONFIRMACION_SOLO_DEV, exigirDeploymentDeDesarrollo } from "./entorno";
import { canonizar } from "./texto";
import { construirTemario, recalcular, resolverClasificacion } from "./temario";
import { validarMaterial, type MaterialDeReactivo } from "./material";
import {
  normalizarTipo,
  type EstadoExamen,
  type TipoExamen,
} from "./examenEstado";
import {
  calcularPuntaje,
  desglosePorClasificacion,
  limiteDe,
  type ConteoPorArea,
  type ConteoPorSeccion,
} from "./simulacro";

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

/**
 * Prefijo de los grupos TEMPORALES del E2E de la frontera de membresías (LUI-19,
 * §5c). Es un NAMESPACE: la reconciliación estrecha del paso 6b y
 * `limpiarMembresiasParaCota` solo tocan grupos cuyo nombre empiece así — jamás
 * los del fixture ni asociaciones manuales de dev.
 */
const MARCA_COTA_LUI19 = "[Cota LUI-19]";

/**
 * Antigüedad de los intentos EN CURSO del fixture (LUI-26).
 *
 * Antes se anclaban a la mitad de la ventana («0.5») o a «hace 30 minutos»: con el
 * cronómetro real —`simulacro.limiteDe`, que recorta al cierre de la ventana— esos
 * instantes ya estaban VENCIDOS casi siempre (la mitad de una ventana de 21 días son días,
 * y «hace 30 min» con un examen de 30 min da límite = ahora), así que el fixture habría
 * nacido muerto: el cierre durable los entregaría al instante y las suites que esperan un
 * `en_curso` verían un `enviado`. 10 minutos de transcurso dejan margen cómodo hasta con el
 * examen más corto del fixture (30 min → 20 restantes).
 *
 * `MARGEN_ENCURSO_MS` es lo que el seed EXIGE que quede de vida a cada `en_curso` sembrado:
 * la aserción post-siembra lanza si no se cumple, para que el fixture jamás degrade en
 * silencio cuando alguien acorte una duración o mueva una ventana.
 */
const ENCURSO_TRANSCURRIDO_MS = 10 * 60_000;
const MARGEN_ENCURSO_MS = 15 * 60_000;

/** Namespace de los grupos TEMPORALES del E2E del player (§14, «solo futuras»). Igual que
 *  `MARCA_COTA_LUI19`: la limpieza solo toca lo que empieza así. */
const MARCA_E2E_PLAYER = "[E2E LUI-26]";

/** Namespace de TODO lo temporal del E2E de LUI-30 (grupos, perfiles, clasificaciones).
 *  Sus limpiezas (`limpiarGruposLui30` / `limpiarPerfilesLui30` /
 *  `limpiarClasificacionesMarcadas`) borran FÍSICAMENTE y solo dentro de este namespace. */
const MARCA_E2E_LUI30 = "[E2E LUI-30]";
/** Correos de los users SINTÉTICOS de `sembrarPerfilesParaCota`: UNO nuevo por perfil,
 *  jamás un userId real ni compartido. `@invalido.local` no puede pertenecer a nadie. */
const CORREO_E2E_LUI30 = (n: number) => `e2e-lui30-${n}@invalido.local`;
const CORREO_E2E_LUI30_RE = /^e2e-lui30-\d+@invalido\.local$/;
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
  /** Material de presentación (LUI-16). Solo `REACTIVO_SOLO_SG4` lo declara: sin al menos
   *  UN reactivo con material en el fixture, la aserción de geometría de la vista previa
   *  (LUI-20 B) no tendría cajas que medir. Al escribirse pasa por `validarMaterial`, así
   *  que respeta mínimos/máximos/no-vacío por construcción, no por inspección. */
  material?: MaterialDeReactivo;
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

  // ── Bloque de 2 preguntas (LUI-17). La primera entra a los exámenes publicados; la
  // segunda queda APARTADA, así que su candado solo puede venir de la expansión al bloque.
  {
    enunciado: "Segun el texto, ¿cual es el proposito principal de una objecion?",
    opciones: [
      { id: "a", texto: "Poner a prueba la solidez de una tesis" },
      { id: "b", texto: "Derrotar al adversario" },
      { id: "c", texto: "Alargar la discusion" },
      { id: "d", texto: "Cambiar de tema" },
    ],
    opcionCorrecta: "a",
    dificultad: "facil",
    retroalimentacion:
      "El texto dice que la objecion pone a prueba la solidez, no que busque derrotar.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
    lectura: "El valor de la objecion en un debate",
  },
  {
    enunciado: "Segun el texto, ¿que funcion cumple una objecion en un debate?",
    opciones: [
      { id: "a", texto: "Obliga a explicitar los supuestos del argumento" },
      { id: "b", texto: "Elimina la necesidad de pruebas" },
      { id: "c", texto: "Sustituye a la tesis" },
      { id: "d", texto: "Impide la replica" },
    ],
    opcionCorrecta: "a",
    dificultad: "medio",
    retroalimentacion:
      "Segun el texto, objetar con precision obliga a explicitar los supuestos.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
    lectura: "El valor de la objecion en un debate",
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
  // ── Los 4 exclusivos de LUI-20 B ──────────────────────────────────────────
  // Cada uno pertenece a UN SOLO examen (membresía mínima, ver `apartados` y
  // `membresiaDe`): la exclusividad es lo que vuelve DISCRIMINANTES las
  // aserciones del candado — un reactivo compartido seguiría congelado por otro
  // examen aunque la regla estuviera rota, y el verde no probaría nada.
  //
  // Restricciones de clasificación (no decorativas — cada una protege un oráculo):
  //  · «Tesis y argumentos»: la ÚNICA rama viva sin conteos absolutos en ninguna
  //    suite. `e2e-lui15` §7 fija «Ecuaciones lineales»=9 y «Productos notables»=1;
  //    lui14 fija «Operaciones con fracciones»=2 y Biología=1; «Triángulos» debe
  //    seguir en 0 (es el único nodo borrable de lui18).
  //  · dificultad facil/medio: lui14 fija Avanzado=1.
  //  · sin `autorCorreo` (→ Cristian): lui14 fija Rubén=1 y Carlos=1.
  //  · sin `lectura`: la expansión de bloque contagiaría el candado a hermanas.
  //  · enunciados sin los substrings que las suites localizan.
  {
    enunciado: "¿Qué papel juega la evidencia al sostener una tesis?",
    opciones: [
      { id: "a", texto: "Sustituye a la tesis" },
      { id: "b", texto: "La respalda con hechos verificables" },
      { id: "c", texto: "Solo adorna el discurso" },
      { id: "d", texto: "Debilita la conclusión" },
    ],
    opcionCorrecta: "b",
    dificultad: "facil",
    retroalimentacion:
      "La evidencia aporta los hechos verificables que hacen sostenible una tesis.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
  },
  {
    enunciado: "¿Qué distingue una opinión de un argumento?",
    opciones: [
      { id: "a", texto: "La opinión usa datos" },
      { id: "b", texto: "El argumento ofrece razones que lo sostienen" },
      { id: "c", texto: "No hay diferencia" },
      { id: "d", texto: "El argumento es más corto" },
    ],
    opcionCorrecta: "b",
    dificultad: "medio",
    retroalimentacion:
      "Un argumento se distingue por ofrecer razones verificables; la opinión no las exige.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
  },
  {
    enunciado: "¿Cuál es la diferencia entre tesis y conclusión?",
    opciones: [
      { id: "a", texto: "Son sinónimos" },
      { id: "b", texto: "La tesis se defiende; la conclusión cierra el razonamiento" },
      { id: "c", texto: "La conclusión va primero" },
      { id: "d", texto: "La tesis no necesita defensa" },
    ],
    opcionCorrecta: "b",
    dificultad: "medio",
    retroalimentacion:
      "La tesis es la postura que se defiende a lo largo del texto; la conclusión cierra el razonamiento.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
  },
  {
    enunciado: "¿Qué es una falacia de generalización apresurada?",
    opciones: [
      { id: "a", texto: "Concluir de casos insuficientes" },
      { id: "b", texto: "Citar a una autoridad" },
      { id: "c", texto: "Repetir la tesis" },
      { id: "d", texto: "Atacar a la persona" },
    ],
    opcionCorrecta: "a",
    dificultad: "facil",
    retroalimentacion:
      "Generalizar desde una muestra insuficiente produce conclusiones sin sustento.",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
    // El ÚNICO material del fixture (ver el docblock del campo).
    material: {
      tipo: "columnas",
      columna1: ["Generalización apresurada", "Falsa causa", "Ataque personal"],
      columna2: [
        "Concluir de casos insuficientes",
        "Confundir correlación con causa",
        "Descalificar a quien argumenta",
      ],
    },
  },
];

// ── Lecturas (LUI-17) ───────────────────────────────────────────────────────
// DOS lecturas, cada una discriminante de algo distinto:
//  · «El calentamiento global» — BLOQUE DE UNA sola pregunta, o sea «Incompleta» (publicar
//    exige ≥ 2): fixture del gate de LUI-21. Vive en rama RETIRADA, así que además ejercita
//    el camino histórico (editable manteniendo la hoja, sin admitir preguntas nuevas).
//  · «El valor de la objecion en un debate» — BLOQUE DE DOS preguntas en rama VIVA, con solo
//    la primera en un examen publicado y asignado: la hermana queda apartada de todos los
//    exámenes, así que su candado solo puede venir de la EXPANSIÓN al bloque.
// Con ellas el fixture pasa de 12 a 14 reactivos (`e2e-lui14` lo refleja); las tres trampas
// de conteo de esa suite se respetan: ninguna pregunta nueva es «Avanzado», ninguna es de
// Carlos y ninguna contiene «párrafo».
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
  // Bloque de DOS preguntas bajo la rama VIVA, y de otro autor que la primera lectura: es
  // el fixture del candado de bloque (una de sus preguntas entra a los exámenes publicados y
  // la otra no, así que la segunda solo puede congelarse por EXPANSIÓN).
  {
    titulo: "El valor de la objecion en un debate",
    autorCorreo: "cristian.instructor@demo.unx.mx",
    en: ["Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"],
    dificultad: "medio",
    contenido:
      "En un debate, la objecion no busca derrotar al adversario sino poner a prueba la " +
      "solidez de una tesis. Quien objeta con precision obliga a explicitar los supuestos " +
      "que sostienen el argumento y, con ello, mejora la discusion para ambas partes.",
  },
];

// Reactivos que hacen DISCRIMINANTE el candado «En uso en un examen» (LUI-14),
// por enunciado. El resto de reactivos va a los exámenes publicados ABIERTOS.
const REACTIVO_SIN_EXAMEN = "¿Qué fracción es equivalente a 0.375?"; // (D) en ningún examen → LIBRE
const REACTIVO_SOLO_BORRADOR = "¿Cuál es el resultado de 3/4 + 1/6?"; // (A) solo en el borrador → LIBRE
const REACTIVO_SOLO_FUTURO =
  "En el sistema x + y = 10 y x − y = 2, ¿cuánto vale x?"; // (C) solo en SG3 (futura) → BLOQUEADO
// (LUI-15) Reactivo en rama RETIRADA («Productos notables») pero LIBRE (en ningún
// examen) → editable: fixture para probar «mantener una clasificación retirada al editar».
const REACTIVO_RETIRADO_LIBRE = "¿Cuál es el desarrollo de (x + 3)²?";
// (LUI-17) HERMANA de un bloque cuya OTRA pregunta sí está en un examen publicado con
// asignación. No pertenece a ningún examen QUE CONGELE (desde LUI-20 B vive también en el
// borrador «Comprensión de lectura», y un borrador no congela), así que su candado viene
// EXCLUSIVAMENTE de la expansión al bloque: el fixture que hace discriminante «se congela
// la lectura entera».
const REACTIVO_HERMANA_LIBRE =
  "Segun el texto, ¿que funcion cumple una objecion en un debate?";
// (LUI-20 B) Los 4 exclusivos de la tabla de verdad del candado y del archivado.
// TODOS entran a `apartados`: si cayeran en `restoReactivos` entrarían a SG1/SG2 y
// el candado ajeno taparía el que cada aserción quiere medir (falso verde) — o
// peor, `ARCHIVADO_LIBRE` quedaría congelado por SG1 y su aserción «sin
// compromisos → sin candado» fallaría CON el código correcto (falso rojo).
const REACTIVO_SOLO_ARCHIVADO =
  "¿Qué papel juega la evidencia al sostener una tesis?"; // solo SG0 (archivado + asignación cerrada) → BLOQUEADO
const REACTIVO_INTENTO_DIRECTO =
  "¿Qué distingue una opinión de un argumento?"; // solo «Práctica libre» (publicado + intento directo) → BLOQUEADO
const REACTIVO_ARCHIVADO_LIBRE =
  "¿Cuál es la diferencia entre tesis y conclusión?"; // solo SG5 (archivado sin NADA) → LIBRE
const REACTIVO_SOLO_SG4 =
  "¿Qué es una falacia de generalización apresurada?"; // solo SG4 → candado ANTES y DESPUÉS de archivarlo

// ── Exámenes, asignaciones e intentos (LUI-9) ───────────────────────────────
// Existen para que el panel de la administradora sea VERIFICABLE: sin ellos,
// «Exámenes aplicados este mes» siempre da 0 y la tabla siempre sale vacía.
//
// El fixture es DISCRIMINANTE, no decorativo: cada dato está puesto para que una
// implementación mal hecha falle de forma VISIBLE. Ver el comentario de cada uno.

// «cerrada» (LUI-20 B): ventana concluida CUALQUIER día del mes. Con la fórmula de
// «mesPasado» (abre a −10d, cierra a +21d) la ventana sigue ABIERTA hasta el día 11
// del mes en curso — un fixture «archivable» construido así fallaría según el día en
// que corra la suite. Las cerradas abren a −(40+7i)d del día 1: cierran a −(19+7i)d,
// SIEMPRE antes de `ahora`, incluido el día 1 a las 00:05.
type Cuando = "esteMes" | "mesPasado" | "futura" | "cerrada";

/**
 * Fixture DECLARATIVO de exámenes (LUI-20 B).
 *  · `estado` usa `EstadoExamen` del módulo puro: el tercer estado entra solo.
 *  · `tipo` por NOMBRE de sección (se resuelve a id con el temario ya sembrado).
 *    AUSENTE = general legado (el campo NO se escribe); «Práctica libre» lo lleva
 *    EXPLÍCITO a propósito — el par ausente/explícito discrimina que la pantalla
 *    pase por `normalizarTipo` y no por la mera presencia del campo.
 *  · `miembros` reemplaza las ramas por estado/título que tenía `membresiaDe`: la
 *    rama `estado === "borrador"` habría llenado los borradores NUEVOS con el
 *    resto del banco (un examen de Redacción lleno de álgebra) y repartido
 *    `REACTIVO_SOLO_BORRADOR` en tres borradores distintos.
 */
const EXAMENES: {
  titulo: string;
  descripcion: string;
  duracionMin: number;
  estado: EstadoExamen;
  tipo?: { clase: "general" } | { clase: "modulo"; seccion: string };
  autorCorreo?: string;
  /** AUSENTE = «resto» (todos menos `apartados`). */
  miembros?:
    | { base: "resto"; extra?: string }
    | { base: "solo"; enunciados: readonly string[] }
    | { base: "fantasma" };
}[] = [
  // — Los 5 originales, con el MISMO resultado que producían las ramas viejas —
  { titulo: "Diagnóstico por áreas", descripcion: "Evaluación inicial de las cuatro áreas del EXANI II.", duracionMin: 90, estado: "publicado" },
  { titulo: "Simulacro General 1", descripcion: "Primer simulacro completo.", duracionMin: 180, estado: "publicado" },
  { titulo: "Simulacro General 2", descripcion: "Segundo simulacro completo.", duracionMin: 180, estado: "publicado" },
  { titulo: "Simulacro General 3", descripcion: "Tercer simulacro completo.", duracionMin: 180, estado: "publicado",
    miembros: { base: "resto", extra: REACTIVO_SOLO_FUTURO } },
  // Sin asignar y en borrador: ejercita `estado` y el índice `by_estado`.
  { titulo: "Simulacro Final", descripcion: "En construcción.", duracionMin: 180, estado: "borrador",
    miembros: { base: "resto", extra: REACTIVO_SOLO_BORRADOR } },
  // — LUI-20 B: la tabla de verdad del candado, fila por fila —
  // SG0 = asignación SÍ · intento NO (su asignación va con `presentan: []`). Si
  // tuviera intentos, esta fila y la de «Práctica libre» probarían la MISMA rama
  // del ∨ y quien borrara la rama de asignaciones quedaría verde.
  { titulo: "Simulacro General 0", descripcion: "Aplicado y retirado; conserva su historial.",
    duracionMin: 180, estado: "archivado",
    miembros: { base: "solo", enunciados: [REACTIVO_SOLO_ARCHIVADO] } },
  // Práctica libre = asignación NO · intento SÍ (intentos DIRECTOS, paso 9b).
  { titulo: "Práctica libre", descripcion: "Práctica sin asignación; intentos directos.",
    duracionMin: 30, estado: "publicado", tipo: { clase: "general" },
    miembros: { base: "solo", enunciados: [REACTIVO_INTENTO_DIRECTO] } },
  // SG5 = asignación NO · intento NO → su reactivo queda LIBRE.
  { titulo: "Simulacro General 5", descripcion: "Archivado sin compromisos.",
    duracionMin: 180, estado: "archivado",
    miembros: { base: "solo", enunciados: [REACTIVO_ARCHIVADO_LIBRE] } },
  // El que el E2E ARCHIVA: solo asignaciones cerradas (determinista) y CON
  // intentos — tras archivarlo es el caso «archivado con resultados» de la UI.
  { titulo: "Simulacro General 4", descripcion: "Concluido; candidato a archivar.",
    duracionMin: 180, estado: "publicado",
    miembros: { base: "solo", enunciados: [REACTIVO_SOLO_SG4] } },
  // Chip morado sobre PUBLICADO, sección con áreas.
  { titulo: "Módulo Biología 1", descripcion: "Examen del módulo de Biología.",
    duracionMin: 60, estado: "publicado", tipo: { clase: "modulo", seccion: "Biología" },
    miembros: { base: "solo", enunciados: ["¿Cuál es la función principal de la membrana celular?"] } },
  // Chip morado sobre BORRADOR y sección PLANA: caza acoplar el chip a `estado`
  // y resolver el nombre del módulo caminando áreas (esta no tiene ninguna).
  { titulo: "Módulo Matemáticas financieras", descripcion: "En construcción.",
    duracionMin: 60, estado: "borrador", tipo: { clase: "modulo", seccion: "Matemáticas financieras" },
    miembros: { base: "solo", enunciados: [] } },
  // Borrador AJENO (Carlos): sin él, todos los exámenes comparten autor y la
  // regla «solo su autor lo edita» no sería probable.
  { titulo: "Diagnóstico Redacción", descripcion: "Borrador de otro autor.",
    duracionMin: 45, estado: "borrador", autorCorreo: "carlos.instructor@demo.unx.mx",
    miembros: { base: "solo", enunciados: [] } },
  // `reactivoIds` con un id COLGANTE (el arreglo no tiene FK): la pantalla debe
  // tolerarlo, no encogerse en silencio.
  { titulo: "Simulacro legado (migración)", descripcion: "Referencia a un reactivo que ya no existe.",
    duracionMin: 90, estado: "publicado", miembros: { base: "fantasma" } },
  // BLOQUE COMPLETO (las 2 preguntas de la lectura) en un examen: sin él, ningún
  // examen contiene dos hermanas contiguas y la aserción «un pasaje por RACHA, no
  // por pregunta» de la vista previa no discriminaría — con una sola pregunta de
  // bloque, pintar el pasaje por racha o por pregunta da lo mismo. Es BORRADOR a
  // propósito: un borrador no congela, así que la hermana apartada conserva su
  // candado-solo-por-expansión (fixture de lui17) intacto.
  { titulo: "Comprensión de lectura (borrador)", descripcion: "Bloque completo para revisión.",
    duracionMin: 20, estado: "borrador",
    miembros: { base: "solo", enunciados: [
      "Segun el texto, ¿cual es el proposito principal de una objecion?",
      REACTIVO_HERMANA_LIBRE,
    ] } },
];

/** La identidad de una asignación en el fixture es el par (examen, grupo). */
const ASIGNACIONES: {
  examen: string;
  grupo: string;
  cuando: Cuando;
  /** "activasDelGrupo" = todas las alumnas activas del grupo; [] = nadie la presentó. */
  presentan: "activasDelGrupo" | string[];
  /** Correo de quien REINTENTÓ: 2º intento estrictamente MEJOR (caza promediar todos). */
  reintenta?: string;
  /** Correo de quien tiene un intento `en_curso` SIN puntaje (caza el NaN). */
  enCurso?: string;
  /** Correo cuyo enviado se siembra como LEGADO pre-LUI-104/27 (`numeroIntento` ausente,
   *  SIN desglose, CON puntaje alcanzable): el discriminante del proxy del selector
   *  canónico y del flag `desgloseIncompleto` de LUI-30. Solo en asignaciones CERRADAS
   *  (no toca los oráculos de lui9/lui19/lui26). */
  legado?: string;
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
  // ── Cerradas (LUI-20 B): a 40+ días del día 1 → concluidas CUALQUIER día ──
  // Quedan fuera de «este mes» y muy por debajo del top-5 de «últimos exámenes»,
  // así que el oráculo del panel (LUI-9) no se mueve. ⚠️ NO añadir aquí entradas
  // `esteMes`: recalcularían `paso` y moverían los umbrales de apertura de las
  // existentes y el orden del top-5.
  // SG0 con `presentan: []` — la fila «asignación sí · intento no» de la tabla de
  // verdad del candado. Con intentos no discriminaría la rama de asignaciones.
  { examen: "Simulacro General 0", grupo: "Matutino A", cuando: "cerrada", presentan: [] },
  // SG4 CON intentos: tras archivarlo en el E2E es «archivado con resultados».
  { examen: "Simulacro General 4", grupo: "Matutino A", cuando: "cerrada", presentan: "activasDelGrupo" },
  { examen: "Simulacro General 4", grupo: "Vespertino B", cuando: "cerrada", presentan: "activasDelGrupo", legado: "regina.avila@correo.com" },
];

/** El hash 31 determinista del seed (nada de `Math.random()`: este archivo CONVERGE). */
function hashDemo(clave: string): number {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * ACIERTOS ficticios pero ESTABLES de un intento: hash determinista de (examen, grupo,
 * alumna) en `[0..n]`. Sustituye al viejo `puntajeDemo` (LUI-30): aquel elegía un puntaje
 * arbitrario en 700–1300 que con N reactivos podía ser INALCANZABLE (solo existen N+1
 * puntajes posibles) — el CA «las cifras coinciden con las del alumno» y la réplica del
 * promedio lo habrían delatado. Ahora el fixture elige ACIERTOS y el puntaje sale de la
 * fórmula real (`calcularPuntaje`), exactamente como en producción.
 */
function aciertosDemo(clave: string, n: number): number {
  return n <= 0 ? 0 : hashDemo(clave) % (n + 1);
}

/**
 * El SUBCONJUNTO de reactivos correctos de un intento sembrado: ventana CIRCULAR estable
 * sobre el orden de los vivos (`inicio = hash % n`, `aciertos` consecutivos con wrap).
 * Determinista mientras la membresía del examen no cambie — así el desglose por
 * sección/área que produce `desglosePorClasificacion` converge entre corridas.
 */
function correctasDemo(
  vivos: readonly { id: Id<"reactivos"> }[],
  aciertos: number,
  clave: string,
): Set<string> {
  const correctas = new Set<string>();
  const n = vivos.length;
  if (n === 0 || aciertos <= 0) return correctas;
  const inicio = hashDemo(clave) % n;
  for (let k = 0; k < aciertos; k++) correctas.add(vivos[(inicio + k) % n].id);
  return correctas;
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

    // Orden: de las hojas hacia la raíz del grafo de contenido. `posiciones` (cursor del
    // player) va primero por lo mismo que `respuestas`: cuelga de `intentos`.
    const tablas = [
      "posiciones",
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
    // nombre canónico → id de sección, HOISTEADO fuera del bloque: lo consume el
    // paso 7 para resolver el `tipo` de los exámenes de módulo (LUI-20 B).
    const seccionIdPorNombre = new Map<string, Id<"secciones">>();
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
      // Cubre AMBOS caminos (sección preexistente e insertada): al llegar aquí,
      // `seccionPorNombre` contiene todas las del fixture.
      for (const [clave, s] of seccionPorNombre) {
        seccionIdPorNombre.set(clave, s._id);
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
          // Clave SIEMPRE presente: `undefined` BORRA un material residual (el seed
          // escribe el estado completo — converge, no preserva). Pasa por
          // `validarMaterial` para que el fixture respete mínimos/máximos/no-vacío
          // por construcción (LUI-20 B).
          material: r.material ? validarMaterial(r.material) : undefined,
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
        material: r.material ? validarMaterial(r.material) : undefined,
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
    // El seed escribe las uniones DIRECTO (≤4 por instructor — muy por debajo de
    // la frontera `asegurarCapacidadMembresias` que sí aplican los escritores
    // productivos; documentado en instructores.ts).
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

    // ── 6b. Reconciliación ESTRECHA de uniones (LUI-19) ────────────────────
    // SOLO retira: (a) filas DUPLICADAS del mismo par dentro de los grupos del
    // fixture y (b) uniones hacia grupos marcados «[Cota LUI-19]» (residuo del
    // E2E de la frontera de membresías, si su `finally` no alcanzó a limpiar).
    // Nada más: una poda global borraría asociaciones manuales legítimas del
    // deployment de dev.
    for (const grupoId of grupoIdPorNombre.values()) {
      const filas = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect();
      const vistos = new Set<string>();
      for (const fila of filas) {
        const key = fila.instructorId as string;
        if (vistos.has(key)) {
          await ctx.db.delete(fila._id);
          reparado.push("grupo-instructor:duplicado");
        } else {
          vistos.add(key);
        }
      }
    }
    const gruposMarcadosLui19 = (await ctx.db.query("grupos").collect()).filter(
      (g) => g.nombre.startsWith(MARCA_COTA_LUI19),
    );
    for (const g of gruposMarcadosLui19) {
      const filas = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect();
      for (const fila of filas) {
        await ctx.db.delete(fila._id);
        reparado.push("grupo-instructor:cota-lui19");
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
    const idHermanaLibre = reactivoIdPorEnunciado.get(REACTIVO_HERMANA_LIBRE);
    // ⚠️ Los 4 exclusivos de LUI-20 B entran a `apartados` OBLIGATORIAMENTE: si
    // cayeran en `restoReactivos` entrarían a SG1/SG2 (publicados con asignación)
    // y su candado ajeno taparía —o contradiría— el que cada aserción mide.
    const apartados = new Set(
      [
        idSinExamen,
        idSoloBorrador,
        idSoloFuturo,
        idRetiradoLibre,
        idHermanaLibre,
        reactivoIdPorEnunciado.get(REACTIVO_SOLO_ARCHIVADO),
        reactivoIdPorEnunciado.get(REACTIVO_INTENTO_DIRECTO),
        reactivoIdPorEnunciado.get(REACTIVO_ARCHIVADO_LIBRE),
        reactivoIdPorEnunciado.get(REACTIVO_SOLO_SG4),
      ].filter(Boolean) as Id<"reactivos">[],
    );
    const restoReactivos = todosLosReactivoIds.filter((id) => !apartados.has(id));

    /** Resuelve un enunciado a id, o TRUENA: un fixture silenciosamente ausente
     *  produce fallos indescifrables tres pasos después. */
    const idDe = (enunciado: string): Id<"reactivos"> => {
      const id = reactivoIdPorEnunciado.get(enunciado);
      if (!id) {
        throw new Error(
          `La membresía de un examen refiere «${enunciado}», que no está en REACTIVOS.`,
        );
      }
      return id;
    };

    /** Membresía DECLARATIVA (LUI-20 B; reemplaza las ramas por estado/título —
     *  ver el docblock de `EXAMENES`). `fantasma` inserta un reactivo mínimo y lo
     *  borra EN LA MISMA mutation: el id queda colgante pero bien formado, el
     *  temario nunca lo cuenta (se borra antes de `recalcular`) y cada corrida
     *  re-parchea el arreglo con un colgante fresco — converge. */
    const membresiaDe = async (
      e: (typeof EXAMENES)[number],
    ): Promise<Id<"reactivos">[]> => {
      const m = e.miembros ?? { base: "resto" as const };
      if (m.base === "solo") return m.enunciados.map(idDe);
      if (m.base === "fantasma") {
        const subtemaEfimero = subtemaPorRuta.get(
          ruta("Comprensión lectora", "Textos argumentativos", "Tesis y argumentos"),
        );
        if (!subtemaEfimero) throw new Error("Falta la rama del reactivo efímero.");
        const clasifEfimera = await resolverClasificacion(ctx, subtemaEfimero, {});
        const rid = await ctx.db.insert("reactivos", {
          enunciado: "(reactivo efímero: existe solo dentro de esta corrida del seed)",
          opciones: [
            { id: "a", texto: "—" },
            { id: "b", texto: "—" },
            { id: "c", texto: "—" },
          ],
          opcionCorrecta: "a",
          ...clasifEfimera,
          dificultad: "facil",
          retroalimentacion: "",
          autorId: instructorUserId,
          activo: true,
        });
        await ctx.db.delete(rid);
        return [rid];
      }
      return m.extra ? [...restoReactivos, idDe(m.extra)] : restoReactivos;
    };

    /** `tipo` del examen por NOMBRE de sección → id. AUSENTE = general legado (el
     *  campo no se escribe). Truena si el nombre no existe — nada de `continue`
     *  silencioso. */
    const tipoDe = (e: (typeof EXAMENES)[number]): TipoExamen | undefined => {
      if (!e.tipo) return undefined;
      if (e.tipo.clase === "general") return { clase: "general" };
      const seccionId = seccionIdPorNombre.get(canonizar(e.tipo.seccion));
      if (!seccionId) {
        throw new Error(
          `El examen «${e.titulo}» apunta al módulo «${e.tipo.seccion}», que no existe en TEMARIO_DEMO.`,
        );
      }
      return { clase: "modulo", seccionId };
    };

    const examenesExistentes = await ctx.db.query("examenes").collect();
    const examenIdPorTitulo = new Map<string, Id<"examenes">>();
    for (const e of EXAMENES) {
      const datos = {
        titulo: e.titulo,
        descripcion: e.descripcion,
        reactivoIds: await membresiaDe(e),
        duracionMin: e.duracionMin,
        estado: e.estado,
        // Clave SIEMPRE presente: en el patch, `undefined` BORRA un `tipo`
        // residual y el examen converge a general. «Ausente = mantener» es
        // semántica de mutations de ACTUALIZACIÓN (`resolverIntencionTipo`); un
        // seed convergente escribe el estado COMPLETO — la semántica contraria.
        tipo: tipoDe(e),
        // Mismo trato para la ESTRUCTURA (LUI-21): los 14 exámenes del fixture son
        // legados SIN estructura declarada, y la clave presente con `undefined` hace
        // que el patch BORRE la que un E2E le haya guardado a un sembrado — sin esto,
        // re-correr el seed sin `limpiarContenidoDemo` dejaría pegada la estructura
        // anterior y el fixture no convergería. (Prueba discriminante: guardar
        // estructura en un sembrado → re-seed SIN limpiar → `secciones` ausente.)
        secciones: undefined,
        autorId:
          (e.autorCorreo &&
            instructorUserIdPorCorreo.get(norm(e.autorCorreo))) ||
          instructorUserId,
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
    const delCerradas = ASIGNACIONES.filter((a) => a.cuando === "cerrada");
    const paso = (ahora - inicioMes) / (delMes.length + 1);

    function abreEnDe(a: (typeof ASIGNACIONES)[number]): number {
      if (a.cuando === "futura") return ahora + 7 * DIA;
      if (a.cuando === "cerrada") {
        // 40, 47, 54… días ANTES del día 1: con la ventana de 21 días, cierran a
        // −19, −26… — SIEMPRE antes de `ahora`, cualquier día del mes (LUI-20 B).
        return inicioMes - (40 + 7 * delCerradas.indexOf(a)) * DIA;
      }
      if (a.cuando === "mesPasado") {
        // 3+7k días ANTES del día 1, del más antiguo al más reciente. La fórmula
        // vieja `(10 − 7·i)` se volvía NEGATIVA en i≥2: una tercera entrada habría
        // aterrizado DENTRO del mes en curso — el fixture mentiría («mesPasado» que
        // no lo es) y los días 1–4 rompería las aserciones LITERALES de e2e-lui9
        // (la 1ª fila de «Últimos exámenes» dejaría de ser la que lleva «—»).
        // Nota: NO rompería la métrica «7» — ese número es un oráculo DERIVADO del
        // fixture, no un literal. Para n=2 esta fórmula produce exactamente los
        // −10d/−3d de siempre: cero movimiento de datos.
        const n = delMesPasado.length;
        return inicioMes - (3 + 7 * (n - 1 - delMesPasado.indexOf(a))) * DIA;
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

    // Los `en_curso` sembrados, para la aserción post-siembra (abajo): el fixture no puede
    // producir intentos que nazcan vencidos.
    const enCursoSembrados: {
      intentoId: Id<"intentos">;
      etiqueta: string;
      iniciadoEn: number;
      duracionMin: number;
      cierraEn: number | null;
    }[] = [];

    // Reactivos VIVOS con su clasificación, por examen (cache de una pasada): el insumo de
    // `desglosePorClasificacion` y del `n` de `calcularPuntaje` — EXACTAMENTE el mismo
    // recorte que hace `finalizarIntento` (los fantasmas no cuentan como pregunta).
    const vivosPorExamen = new Map<
      string,
      { id: Id<"reactivos">; seccionId: Id<"secciones">; areaId: Id<"areasTematicas"> }[]
    >();
    const vivosDe = async (
      exId: Id<"examenes">,
      reactivoIds: Id<"reactivos">[],
    ) => {
      const clave = exId as string;
      const cacheado = vivosPorExamen.get(clave);
      if (cacheado) return cacheado;
      const docs = await Promise.all(reactivoIds.map((rid) => ctx.db.get(rid)));
      const vivos = docs
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => ({ id: r._id, seccionId: r.seccionId, areaId: r.areaId }));
      vivosPorExamen.set(clave, vivos);
      return vivos;
    };

    for (const asig of ASIGNACIONES) {
      const examenId = examenIdPorTitulo.get(asig.examen);
      const grupoId = grupoIdPorNombre.get(asig.grupo);
      if (!examenId || !grupoId) continue;

      // Los read-models de la asignación salen del documento del examen, igual que en
      // `asignar` (que es la autoridad): título, número de reactivos, duración y tipo.
      const examenDoc = await ctx.db.get(examenId);
      if (!examenDoc) continue;

      const abreEn = abreEnDe(asig);
      const datos = {
        examenId,
        // El destino SOLO se arma esparciendo `camposDestino` (frontera XOR, LUI-22):
        // el seed es un escritor más y no queda fuera del invariante.
        ...camposDestino({ grupoId }),
        abreEn,
        // Ventana de 21 días. ⚠️ NO afirmar «la mayoría siguen abiertas»: depende
        // del día del mes (a fin de mes las primeras `esteMes` ya cerraron). Los
        // únicos estados de ventana DETERMINISTAS todo el mes son: `cerrada`
        // (cierra a ≥19 días antes del día 1), `futura` (abre en +7d) y las
        // `esteMes` de índice ≥3 (siempre abiertas: su cierre cae el mes entrante).
        cierraEn: abreEn + 21 * DIA,
        creadoPor: instructorUserId,
        // Read-models del panel del instructor (LUI-19) y de «Mis exámenes» (LUI-25):
        // mismo estampado que hace `asignar` — y como la reconciliación PATCHEA,
        // también repara filas de dev previas a los campos.
        tituloExamen: asig.examen,
        numReactivos: examenDoc.reactivoIds.length,
        duracionMin: examenDoc.duracionMin,
        tipoExamen: normalizarTipo(examenDoc.tipo),
      };
      // La reconciliación NORMALIZA con `destinoDeFila` antes de comparar el par: una
      // fila-alumno residual del E2E jamás se confunde con una sembrada (y una fila
      // malformada revienta aquí, nunca se interpreta en silencio).
      const existente = asignacionesExistentes.find((x) => {
        if (x.examenId !== examenId) return false;
        const destino = destinoDeFila(x);
        return destino.tipo === "grupo" && destino.grupoId === grupoId;
      });
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
        // (a) que caigan en el pasado, (b) el ORDEN entre los intentos de una
        // misma alumna y (c) que queden DENTRO de la ventana — de ahí el
        // `min(ahora, cierraEn)`: en una ventana ya CERRADA hace semanas, el tope
        // `ahora` de antes producía intentos posteriores a `cierraEn` (LUI-20 B).
        const finVentana = Math.min(ahora, datos.cierraEn);
        const enVentana = (f: number) =>
          Math.round(abreEn + (finVentana - abreEn) * f);

        // ACIERTOS reales sobre los reactivos VIVOS del examen (LUI-30): el puntaje sale
        // de `calcularPuntaje` y el desglose de `desglosePorClasificacion` — la MISMA
        // matemática que el cierre real del player, así que las cifras del fixture son
        // alcanzables y coherentes por construcción (Σ aciertos por sección = aciertos).
        const vivos = await vivosDe(examenId, examenDoc.reactivoIds);
        const n = vivos.length;
        const claveBase = `${asig.examen}|${asig.grupo}|${correo}`;
        const desgloseDe = (aciertos: number, clave: string) =>
          desglosePorClasificacion(vivos, correctasDemo(vivos, aciertos, clave));

        // ⚠️ `enviadoEn` y `puntaje` son claves OBLIGADAS (valor `number |
        // undefined`), no opcionales: el spread solo esparce claves PRESENTES, y
        // el `patch` solo elimina campos cuya clave llega con `undefined`. Con el
        // tipo opcional de antes, una posición que convergiera de `enviado` a
        // `en_curso` habría conservado puntaje y fecha de envío residuales — un
        // «en curso» con calificación. (El comentario que había junto al patch
        // AFIRMABA que mandaba `undefined`; no lo hacía.)
        //
        // `numeroIntento`, `formaCierre` y el DESGLOSE (paquete player + LUI-30) son
        // claves OBLIGADAS por lo mismo. El número sigue la POSICIÓN cronológica del
        // fixture, que es como reconcilia el bucle de abajo — así el 1 es siempre el
        // diagnóstico y el invariante «un repaso es posterior a su diagnóstico» se
        // respeta. `numeroIntento` admite `undefined` SOLO para el fixture LEGADO
        // (`asig.legado`): una fila pre-LUI-104/27, sin número y sin desglose.
        type FixtureIntento = {
          estado: "en_curso" | "enviado";
          iniciadoEn: number;
          enviadoEn: number | undefined;
          puntaje: number | undefined;
          numeroIntento: number | undefined;
          formaCierre: "manual" | undefined;
          aciertosPorSeccion: ConteoPorSeccion[] | undefined;
          aciertosPorArea: ConteoPorArea[] | undefined;
        };
        const fixture: FixtureIntento[] = [];

        if (asig.enCurso === correo) {
          // Sin puntaje y sin enviar: si el promedio no filtra, sale NaN.
          // ⚠️ ANCLADO A `ahora`, no a la mitad de la ventana: con el cronómetro real un
          // intento iniciado hace días ya venció, y el cierre durable lo entregaría al
          // instante — el fixture `en_curso` dejaría de existir. `max(abreEn, …)` lo
          // mantiene dentro de la ventana el día 1 del mes, cuando la apertura es
          // reciente. La aserción post-siembra verifica que le quede vida.
          fixture.push({
            estado: "en_curso",
            iniciadoEn: Math.max(abreEn, ahora - ENCURSO_TRANSCURRIDO_MS),
            enviadoEn: undefined,
            puntaje: undefined,
            numeroIntento: 1,
            formaCierre: undefined,
            aciertosPorSeccion: undefined,
            aciertosPorArea: undefined,
          });
        } else if (asig.legado === correo) {
          // FIXTURE LEGADO (LUI-30): enviado pre-LUI-104/27 — sin `numeroIntento`, sin
          // `formaCierre` (ausente ≡ «manual») y SIN desglose, pero con puntaje
          // ALCANZABLE: ejercita el proxy del selector canónico (el promedio SÍ lo
          // cuenta) y el flag `desgloseIncompleto` (sus celdas por sección van «—»).
          fixture.push({
            estado: "enviado",
            iniciadoEn: enVentana(0.2),
            enviadoEn: enVentana(0.3),
            puntaje: n === 0 ? undefined : calcularPuntaje(aciertosDemo(claveBase, n), n),
            numeroIntento: undefined,
            formaCierre: undefined,
            aciertosPorSeccion: undefined,
            aciertosPorArea: undefined,
          });
        } else {
          const aciertos1 =
            asig.reintenta === correo
              ? Math.min(aciertosDemo(claveBase, n), Math.max(0, n - 1))
              : aciertosDemo(claveBase, n);
          const desglose1 = desgloseDe(aciertos1, claveBase);
          fixture.push({
            estado: "enviado",
            iniciadoEn: enVentana(0.2),
            enviadoEn: enVentana(0.3),
            puntaje: n === 0 ? undefined : calcularPuntaje(aciertos1, n),
            numeroIntento: 1,
            formaCierre: "manual",
            aciertosPorSeccion: desglose1.porSeccion,
            aciertosPorArea: desglose1.porArea,
          });
          if (asig.reintenta === correo) {
            // 2º intento estrictamente MEJOR (≈+150 pts: +max(1, n/4) aciertos): si se
            // promedian todos los intentos, o se toma el último, el número SUBE de forma
            // detectable. Con `numeroIntento: 2` es además el discriminante de la regla
            // de LUI-104 (este puntaje NO entra al promedio del panel ni a LUI-30). El
            // clamp de `aciertos1` a `n−1` garantiza el margen de mejora.
            const aciertos2 = Math.min(
              n,
              aciertos1 + Math.max(1, Math.round(n / 4)),
            );
            const desglose2 = desgloseDe(aciertos2, `${claveBase}|r2`);
            fixture.push({
              estado: "enviado",
              iniciadoEn: enVentana(0.6),
              enviadoEn: enVentana(0.7),
              puntaje: n === 0 ? undefined : calcularPuntaje(aciertos2, n),
              numeroIntento: 2,
              formaCierre: "manual",
              aciertosPorSeccion: desglose2.porSeccion,
              aciertosPorArea: desglose2.porArea,
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
          let intentoId: Id<"intentos">;
          if (previo) {
            // `patch` con la clave presente y `undefined` ELIMINA el campo — y
            // AHORA las claves sí van siempre presentes (ver `FixtureIntento`).
            await ctx.db.patch(previo._id, datosIntento);
            intentoId = previo._id;
          } else {
            intentoId = await ctx.db.insert("intentos", datosIntento);
            insertado.push(`intento:${asig.examen}·${correo}`);
          }
          if (fixture[k].estado === "en_curso") {
            enCursoSembrados.push({
              intentoId,
              etiqueta: `${asig.examen}·${correo}`,
              iniciadoEn: fixture[k].iniciadoEn,
              duracionMin: examenDoc.duracionMin,
              cierraEn: datos.cierraEn,
            });
          }
        }
      }
    }

    // ── 9b. Intentos DIRECTOS (sin asignación) — LUI-20 B ──────────────────
    // El schema los admite (`asignacionId` es opcional) y el candado los reconoce
    // (rama ∨ de `calcularBloqueo`, revisión de la Entrega A); este paso
    // materializa el ÚNICO fixture de esa rama. «Práctica libre» lleva:
    //  · 1 `enviado` → `tieneResultados` con CERO asignaciones (mata
    //    `tieneResultados = f(asignaciones)`),
    //  · 1 `en_curso` → la ÚNICA razón por la que no es archivable (sin
    //    asignaciones, la regla base lo dejaría pasar): discrimina la ampliación
    //    del guard de archivar.
    //
    // Reconciliación calcada del paso 9, pero por `by_examen` filtrando
    // `asignacionId === undefined` + alumna + posición cronológica (la del paso 9
    // ancla en `by_asignacion`, que aquí no existe). El orden entre los dos
    // intentos es estable entre corridas (6 días ≫ 30 minutos) → converge.
    {
      const INTENTOS_DIRECTOS: {
        examen: string;
        alumna: string;
        fixture: {
          estado: "en_curso" | "enviado";
          /** ms hacia atrás desde `ahora`, del más antiguo al más reciente. */
          hace: number;
        }[];
      }[] = [
        {
          examen: "Práctica libre",
          alumna: "ana.lopez@correo.com",
          fixture: [
            { estado: "enviado", hace: 6 * DIA },
            // «Práctica libre» dura 30 min: con el ancla vieja («hace 30 minutos») el
            // límite del intento era EXACTAMENTE `ahora` y el cierre durable lo habría
            // entregado en el acto. Ver `ENCURSO_TRANSCURRIDO_MS`.
            { estado: "en_curso", hace: ENCURSO_TRANSCURRIDO_MS },
          ],
        },
      ];

      for (const d of INTENTOS_DIRECTOS) {
        const examenId = examenIdPorTitulo.get(d.examen);
        const alumnoId = alumnoUserIdPorCorreo.get(norm(d.alumna));
        // TRUENA, no `continue`: un fixture silenciosamente ausente produce
        // fallos indescifrables en el E2E que depende de él.
        if (!examenId) throw new Error(`Intento directo: no existe el examen «${d.examen}».`);
        if (!alumnoId) throw new Error(`Intento directo: no existe la alumna «${d.alumna}».`);

        const previos = (
          await ctx.db
            .query("intentos")
            .withIndex("by_examen", (q) => q.eq("examenId", examenId))
            .collect()
        )
          .filter((i) => i.asignacionId === undefined && i.alumnoId === alumnoId)
          .sort((a, b) => a.iniciadoEn - b.iniciadoEn);

        const examenDirecto = await ctx.db.get(examenId);
        if (!examenDirecto)
          throw new Error(`Intento directo: examen «${d.examen}» ilegible.`);
        const vivosDirecto = await vivosDe(examenId, examenDirecto.reactivoIds);
        const nDirecto = vivosDirecto.length;

        for (let k = 0; k < d.fixture.length; k++) {
          const f = d.fixture[k];
          const iniciadoEn = ahora - f.hace;
          const claveDirecta = `${d.examen}|directo|${d.alumna}|${k}`;
          const aciertosDirecto = aciertosDemo(claveDirecta, nDirecto);
          const desgloseDirecto = desglosePorClasificacion(
            vivosDirecto,
            correctasDemo(vivosDirecto, aciertosDirecto, claveDirecta),
          );
          // Las claves variables SIEMPRE presentes (`asignacionId` y el desglose
          // incluidos): el patch limpia cualquier residuo — un intento que fue
          // «enviado» o que alguien ligó a una asignación a mano converge al
          // fixture, no lo preserva. Puntaje y desglose con la MISMA matemática
          // real del cierre (ver paso 9).
          const datosIntento = {
            examenId,
            alumnoId,
            asignacionId: undefined,
            estado: f.estado,
            iniciadoEn,
            enviadoEn:
              f.estado === "enviado" ? iniciadoEn + 40 * 60_000 : undefined,
            puntaje:
              f.estado === "enviado" && nDirecto > 0
                ? calcularPuntaje(aciertosDirecto, nDirecto)
                : undefined,
            // Serie (examen, alumna) para los directos: la posición cronológica es el
            // número, igual que en el paso 9.
            numeroIntento: k + 1,
            formaCierre: f.estado === "enviado" ? ("manual" as const) : undefined,
            aciertosPorSeccion:
              f.estado === "enviado" ? desgloseDirecto.porSeccion : undefined,
            aciertosPorArea:
              f.estado === "enviado" ? desgloseDirecto.porArea : undefined,
          };
          const previo = previos[k];
          let intentoId: Id<"intentos">;
          if (previo) {
            await ctx.db.patch(previo._id, datosIntento);
            intentoId = previo._id;
          } else {
            intentoId = await ctx.db.insert("intentos", datosIntento);
            insertado.push(`intento-directo:${d.examen}·${d.alumna}`);
          }
          if (f.estado === "en_curso") {
            enCursoSembrados.push({
              intentoId,
              etiqueta: `${d.examen}·${d.alumna}`,
              iniciadoEn,
              duracionMin: examenDirecto.duracionMin,
              cierraEn: null, // directo: sin ventana que recorte
            });
          }
        }
      }
    }

    // ── 9c. Los `en_curso` sembrados son JUGABLES y se CIERRAN solos ────────
    // Dos obligaciones que el paquete player impone al fixture:
    //
    //  (a) **Aserción que LANZA**: a cada `en_curso` debe quedarle vida real
    //      (`MARGEN_ENCURSO_MS`). Sin ella, acortar la duración de un examen o mover una
    //      ventana degradaría el fixture en silencio —el intento nacería vencido y el
    //      cierre durable lo entregaría al instante— y las suites que esperan ver «En
    //      curso» fallarían con un síntoma lejano a la causa.
    //
    //  (b) **Cierre durable agendado**, como haría `player.iniciarIntento`: estos intentos
    //      son operables desde la UI de la alumna, así que deben comportarse igual que los
    //      reales. Se CANCELA el job anterior (`cierreJobId`) antes de agendar el nuevo: en
    //      cada reseed el límite se mueve, y sin la cancelación quedaría una cadena de jobs
    //      viejos que disparan antes de tiempo y se re-agendan (correctos pero
    //      acumulativos). Con ella: ≤1 job pendiente por intento vivo.
    for (const e of enCursoSembrados) {
      const limite = limiteDe(e.iniciadoEn, e.duracionMin, e.cierraEn);
      if (limite - ahora < MARGEN_ENCURSO_MS) {
        throw new Error(
          `Fixture inválido: al intento en curso «${e.etiqueta}» le quedan ` +
            `${Math.round((limite - ahora) / 60_000)} min (mínimo ` +
            `${MARGEN_ENCURSO_MS / 60_000}). Revisa la duración del examen o la ventana.`,
        );
      }
      const doc = await ctx.db.get(e.intentoId);
      // …y que sigue siendo el ÚLTIMO de su serie: un `en_curso` con un número menor que
      // algún enviado violaría el invariante de `iniciarIntento` («no se crea mientras
      // haya uno vivo»), y la equivalencia «∃ enviado ⟺ el intento 1 está enviado» —de la
      // que dependen las dos sondas del panel del instructor— dejaría de sostenerse.
      // La SERIE es (asignación, alumna) para los asignados y (examen, alumna) para los
      // directos — el mismo ámbito que usa `iniciarIntento` para numerar.
      const hermanos = !doc
        ? []
        : doc.asignacionId
          ? (
              await ctx.db
                .query("intentos")
                .withIndex("by_asignacion", (q) =>
                  q.eq("asignacionId", doc.asignacionId),
                )
                .collect()
            ).filter((i) => i.alumnoId === doc.alumnoId)
          : (
              await ctx.db
                .query("intentos")
                .withIndex("by_examen", (q) => q.eq("examenId", doc.examenId))
                .collect()
            ).filter(
              (i) => i.asignacionId === undefined && i.alumnoId === doc.alumnoId,
            );
      const maximo = Math.max(...hermanos.map((i) => i.numeroIntento ?? 0), 0);
      if (doc && (doc.numeroIntento ?? 0) !== maximo) {
        throw new Error(
          `Fixture inválido: el intento en curso «${e.etiqueta}» es el número ` +
            `${doc.numeroIntento} pero su serie llega hasta ${maximo}: un repaso no puede ` +
            "quedar por debajo de un envío posterior.",
        );
      }
      if (doc?.cierreJobId) await ctx.scheduler.cancel(doc.cierreJobId);
      const cierreJobId = await ctx.scheduler.runAt(
        limite,
        internal.player.cerrarVencido,
        { intentoId: e.intentoId },
      );
      await ctx.db.patch(e.intentoId, { cierreJobId });
    }

    // ── 9d. READ-MODEL `envioRegistradoEn` (LUI-30) + ASERCIÓN ─────────────
    // El seed es un escritor más del read-model: estampa el MIN `enviadoEn` por
    // asignación con enviados (converge: repara valores y LIMPIA residuos —una fila
    // que perdió sus envíos en la reconciliación pierde también el campo). Después,
    // aserción que LANZA: `presente ⟺ ∃ enviado` contra la BD real — el fixture
    // jamás degrada el contrato del campo en silencio (docblock en schema.ts).
    {
      const asignacionesRM = await ctx.db.query("asignaciones").collect();
      const intentosRM = await ctx.db.query("intentos").collect();
      const primerEnvioPorAsignacion = new Map<string, number>();
      for (const i of intentosRM) {
        if (i.estado !== "enviado" || !i.asignacionId) continue;
        const t = i.enviadoEn ?? i.iniciadoEn;
        const clave = i.asignacionId as string;
        const previo = primerEnvioPorAsignacion.get(clave);
        if (previo === undefined || t < previo) {
          primerEnvioPorAsignacion.set(clave, t);
        }
      }
      for (const a of asignacionesRM) {
        const esperado = primerEnvioPorAsignacion.get(a._id as string);
        if (a.envioRegistradoEn !== esperado) {
          await ctx.db.patch(a._id, { envioRegistradoEn: esperado });
        }
      }
      for (const a of await ctx.db.query("asignaciones").collect()) {
        const tieneEnvio = primerEnvioPorAsignacion.has(a._id as string);
        if ((a.envioRegistradoEn !== undefined) !== tieneEnvio) {
          throw new Error(
            `Read-model roto: «envioRegistradoEn» de la asignación ${a._id} ` +
              "no refleja la existencia de sus envíos.",
          );
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

    // ── Oráculo del panel del INSTRUCTOR (LUI-19) ──────────────────────────
    // Mismo principio que `panelEsperado`: conteo PROPIO contra la BD REAL —
    // independiente de las queries de `panelInstructor.ts`, así un error en
    // ellas se caza igual. Filas CRUDAS y SIN filtrar por tiempo: entre el seed
    // y el assert solo se mueve el reloj, y el spec E2E re-deriva «qué está
    // abierto» con su propio `Date.now()` AL ASERTAR (las ventanas `esteMes` de
    // índice <3 cambian de estado según el día del mes — congelarlas mentiría).
    // ⚠️ PROHIBIDO añadir asignaciones al fixture desde aquí: este bloque solo
    // ENSANCHA el retorno. `totalReactivos` se cuenta de FILAS (no del contador
    // denormalizado): misma independencia que el oráculo del temario — el E2E
    // también caza una deriva del contador que la query heredaría.
    const intentosFinal = await ctx.db.query("intentos").collect();
    const unionesFinal = await ctx.db.query("grupoInstructores").collect();
    const alumnasActivasPorGrupoId = new Map<
      string,
      { userId: Id<"users">; nombre: string }[]
    >();
    for (const p of alumnosFinal) {
      if (!p.activo || !p.grupoId) continue;
      const lista = alumnasActivasPorGrupoId.get(p.grupoId as string) ?? [];
      lista.push({
        userId: p.userId,
        nombre: nombreCompleto(p.nombre, p.apellidos ?? ""),
      });
      alumnasActivasPorGrupoId.set(p.grupoId as string, lista);
    }
    const intentosPorAsignacion = new Map<string, typeof intentosFinal>();
    for (const i of intentosFinal) {
      if (!i.asignacionId) continue;
      const lista = intentosPorAsignacion.get(i.asignacionId as string) ?? [];
      lista.push(i);
      intentosPorAsignacion.set(i.asignacionId as string, lista);
    }
    const grupoDocPorId = new Map(gruposFinal.map((g) => [g._id as string, g]));

    const oraculoInstructor = (correo: string) => {
      const userId = instructorUserIdPorCorreo.get(norm(correo));
      const nombrePila =
        INSTRUCTORES.find((i) => norm(i.correo) === norm(correo))?.nombre ?? "?";
      const susGrupos = userId
        ? [
            ...new Map(
              unionesFinal
                .filter((u) => u.instructorId === userId)
                .map((u) => grupoDocPorId.get(u.grupoId as string))
                .filter(
                  (g): g is NonNullable<typeof g> => g !== undefined && g.activo,
                )
                .map((g) => [g._id as string, g] as const),
            ).values(),
          ].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        : [];
      return {
        nombre: nombrePila,
        grupos: susGrupos.map((g) => ({
          nombre: g.nombre,
          alumnasActivas: (alumnasActivasPorGrupoId.get(g._id as string) ?? [])
            .map((a) => a.nombre)
            .sort((a, b) => a.localeCompare(b, "es")),
        })),
        asignaciones: susGrupos.flatMap((g) => {
          const roster = alumnasActivasPorGrupoId.get(g._id as string) ?? [];
          return asignacionesFinal
            .filter((a) => a.grupoId === g._id)
            .map((a) => {
              const deEsta = intentosPorAsignacion.get(a._id as string) ?? [];
              // Espejo de la sonda del panel: por alumna ACTIVA del roster,
              // «enviado» GANA sobre «en_curso»; sin intento → no aparece.
              const porAlumna: {
                nombre: string;
                estado: "enviado" | "en_curso";
              }[] = [];
              for (const al of roster) {
                const suyos = deEsta.filter((i) => i.alumnoId === al.userId);
                if (suyos.length === 0) continue;
                porAlumna.push({
                  nombre: al.nombre,
                  estado: suyos.some((i) => i.estado === "enviado")
                    ? "enviado"
                    : "en_curso",
                });
              }
              return {
                examen: examenPorId.get(a.examenId) ?? "?",
                examenId: a.examenId as string,
                grupo: g.nombre,
                abreEn: a.abreEn,
                cierraEn: a.cierraEn,
                porAlumna,
              };
            });
        }),
      };
    };

    // ── Oráculo de «Mis exámenes» (LUI-25) ─────────────────────────────────
    // Mismo principio que los dos anteriores: se ENSANCHA el retorno (jamás se añaden
    // fixtures) y las filas van CRUDAS, sin estado de ventana ni clasificación — el spec
    // E2E re-deriva pendiente/completado/vencido con su propio `Date.now()` al asertar,
    // porque las ventanas `esteMes` cambian de estado según el día del mes.
    //
    // Lo que sí resuelve aquí es la PERTENENCIA (qué asignaciones alcanzan a la alumna:
    // las de su grupo ∪ las individuales suyas) y el orden de sus intentos, que es
    // exactamente lo que la query debe reproducir. Los intentos DIRECTOS (sin asignación,
    // «Práctica libre» de ana) quedan fuera a propósito: no son asignaciones y la pantalla
    // no debe listarlos — discriminante gratis.
    const oraculoAlumna = (correo: string) => {
      const userId = alumnoUserIdPorCorreo.get(norm(correo));
      const perfil = alumnosFinal.find((p) => p.userId === userId);
      const grupoId = perfil?.grupoId;
      const suyas = asignacionesFinal.filter(
        (a) =>
          (grupoId !== undefined && a.grupoId === grupoId) ||
          a.alumnoId === userId,
      );
      return {
        nombre: perfil ? nombreCompleto(perfil.nombre, perfil.apellidos ?? "") : "?",
        grupo: grupoId ? (grupoPorId.get(grupoId) ?? "?") : null,
        filas: suyas.map((a) => ({
          examen: a.tituloExamen ?? examenPorId.get(a.examenId) ?? "?",
          abreEn: a.abreEn,
          cierraEn: a.cierraEn,
          numReactivos: a.numReactivos ?? null,
          duracionMin: a.duracionMin ?? null,
          esModulo: (a.tipoExamen?.clase ?? "general") === "modulo",
          intentos: intentosFinal
            .filter((i) => i.asignacionId === a._id && i.alumnoId === userId)
            .sort(
              (x, y) =>
                (x.numeroIntento ?? 0) - (y.numeroIntento ?? 0) ||
                x.iniciadoEn - y.iniciadoEn,
            )
            .map((i) => ({
              estado: i.estado,
              numeroIntento: i.numeroIntento ?? null,
              iniciadoEn: i.iniciadoEn,
              enviadoEn: i.enviadoEn ?? null,
              puntaje: i.puntaje ?? null,
            })),
        })),
      };
    };

    // ── Oráculo de RESULTADOS del examen (LUI-30) ──────────────────────────
    // Mismo principio que sus hermanos: el retorno se ENSANCHA (jamás se añaden
    // fixtures), el conteo es PROPIO contra la BD REAL —una réplica independiente de la
    // tabla de precedencia ①–⑥ del selector canónico, escrita aquí a mano para que un
    // error en `resultados.ts`/`simulacro.ts` se cace igual (JAMÁS los importa)— y los
    // estados de reloj NO se congelan: el spec E2E re-deriva pendiente/«No contestó» con
    // su propio `Date.now()` al asertar. Los repasos (`numeroIntento ≥ 2`) NO cuentan; los
    // desgloses viajan con NOMBRES resueltos para que la réplica del spec no dependa de
    // ids de dev.
    const nombrePorSeccionId = new Map(
      seccionesFinal.map((s) => [s._id as string, s.nombre]),
    );
    const nombrePorAreaId = new Map(
      areasFinal.map((a) => [a._id as string, a.nombre]),
    );
    const resultadosEsperado = {
      porAsignacion: asignacionesFinal.flatMap((a) => {
        const destino = destinoDeFila(a);
        if (destino.tipo !== "grupo") return [];
        const grupoIdStr = destino.grupoId as string;
        const roster = alumnasActivasPorGrupoId.get(grupoIdStr) ?? [];
        const deEsta = intentosPorAsignacion.get(a._id as string) ?? [];

        // Selección PROPIA del intento-que-cuenta (tabla ①–⑥, reimplementada).
        const rangoDe = (i: (typeof deEsta)[number]) => {
          const diag = i.numeroIntento === 1;
          if (i.estado === "enviado" && i.puntaje !== undefined) return diag ? 1 : 2;
          if (i.estado === "enviado") return diag ? 3 : 4;
          return diag ? 5 : 6;
        };
        const porAlumnaId = new Map<string, (typeof deEsta)[number]>();
        for (const i of deEsta) {
          if (i.numeroIntento !== undefined && i.numeroIntento !== 1) continue;
          const previo = porAlumnaId.get(i.alumnoId as string);
          if (
            !previo ||
            rangoDe(i) < rangoDe(previo) ||
            (rangoDe(i) === rangoDe(previo) && i.iniciadoEn < previo.iniciadoEn)
          ) {
            porAlumnaId.set(i.alumnoId as string, i);
          }
        }
        const seleccionados = [...porAlumnaId.values()];
        const enviadosSel = seleccionados.filter((i) => i.estado === "enviado");
        const calificadosSel = enviadosSel.filter((i) => i.puntaje !== undefined);
        const rosterIds = new Set(roster.map((r) => r.userId as string));

        const porAreaAgregado = new Map<string, { aciertos: number; total: number }>();
        for (const i of enviadosSel) {
          for (const c of i.aciertosPorArea ?? []) {
            const acc = porAreaAgregado.get(c.areaId as string) ?? {
              aciertos: 0,
              total: 0,
            };
            acc.aciertos += c.aciertos;
            acc.total += c.total;
            porAreaAgregado.set(c.areaId as string, acc);
          }
        }

        return [
          {
            examen: examenPorId.get(a.examenId) ?? "?",
            grupo: grupoPorId.get(destino.grupoId) ?? "?",
            abreEn: a.abreEn,
            cierraEn: a.cierraEn,
            rosterActivas: roster
              .map((r) => r.nombre)
              .sort((x, y) => x.localeCompare(y, "es")),
            porAlumna: roster
              .filter((r) => porAlumnaId.has(r.userId as string))
              .map((r) => {
                const i = porAlumnaId.get(r.userId as string)!;
                return {
                  nombre: r.nombre,
                  estado: i.estado,
                  numeroIntento: i.numeroIntento ?? null,
                  iniciadoEn: i.iniciadoEn,
                  enviadoEn: i.enviadoEn ?? null,
                  // SIN redondear: la réplica del spec redondea con su propio
                  // `Math.round` — así también caza un doble redondeo en la query.
                  puntajeExacto: i.puntaje ?? null,
                  porSeccion: (i.aciertosPorSeccion ?? []).map((c) => ({
                    seccion: nombrePorSeccionId.get(c.seccionId as string) ?? "?",
                    aciertos: c.aciertos,
                    total: c.total,
                  })),
                  porArea: (i.aciertosPorArea ?? []).map((c) => ({
                    area: nombrePorAreaId.get(c.areaId as string) ?? "?",
                    aciertos: c.aciertos,
                    total: c.total,
                  })),
                };
              })
              .sort((x, y) => x.nombre.localeCompare(y.nombre, "es")),
            promedio: calificadosSel.length
              ? Math.round(
                  calificadosSel.reduce((s, i) => s + (i.puntaje as number), 0) /
                    calificadosSel.length,
                )
              : null,
            participacion: {
              completaron: roster.filter((r) => {
                const i = porAlumnaId.get(r.userId as string);
                return i !== undefined && i.estado === "enviado";
              }).length,
              deTotal: roster.length,
            },
            porAreaAgregado: [...porAreaAgregado.entries()]
              .map(([areaId, c]) => ({
                area: nombrePorAreaId.get(areaId) ?? "?",
                aciertos: c.aciertos,
                total: c.total,
              }))
              .sort((x, y) => x.area.localeCompare(y.area, "es")),
            fuerasDeRoster: enviadosSel.filter(
              (i) => !rosterIds.has(i.alumnoId as string),
            ).length,
          },
        ];
      }),
    };

    return {
      insertado,
      reparado,
      resultadosEsperado,
      misExamenesEsperado: {
        "fernanda.alumna@demo.unx.mx": oraculoAlumna(
          "fernanda.alumna@demo.unx.mx",
        ),
        "ana.lopez@correo.com": oraculoAlumna("ana.lopez@correo.com"),
      },
      panelInstructorEsperado: {
        totalReactivos: reactivosFinal.length,
        instructores: {
          "cristian.instructor@demo.unx.mx": oraculoInstructor(
            "cristian.instructor@demo.unx.mx",
          ),
          "diana.instructor@demo.unx.mx": oraculoInstructor(
            "diana.instructor@demo.unx.mx",
          ),
        },
      },
      panelEsperado: {
        gruposActivos: gruposFinal.filter((g) => g.activo).length,
        alumnosRegistrados: alumnosFinal.filter((p) => p.activo).length,
        examenesAplicadosMes: aplicadasDelMes.length,
        ultimosExamenes: ultimas.map((a) => {
          // Espejo del render de `panel.resumen`: el destino se interpreta vía
          // `destinoDeFila` (rama alumno inalcanzable con este fixture — total igual).
          const destino = destinoDeFila(a);
          return {
            examen: examenPorId.get(a.examenId) ?? "?",
            grupo:
              destino.tipo === "alumno"
                ? "Asignación individual"
                : (grupoPorId.get(destino.grupoId) ?? "?"),
          };
        }),
      },
      temarioEsperado,
      mensaje:
        insertado.length || reparado.length
          ? `Seed OK — insertado: ${insertado.length ? insertado.join(", ") : "nada"} · reparado: ${reparado.length ? reparado.join(", ") : "nada"}`
          : "Todo ya existía y estaba al día.",
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers del E2E de LUI-19 (cotas del panel del instructor) — SOLO_DEV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (LUI-19 · §5b del E2E) COMPLETA las asignaciones VIVAS de un grupo HASTA el
 * objetivo — no «inserta N»: el fixture ya trae vivas (p. ej. Vespertino B con
 * SG2 `esteMes` de índice ≥3, siempre abierta) y sembrar de más correría los
 * conteos de la prueba. Las nuevas son FUTURAS (abren en +30 días): una futura
 * jamás cuenta como «aplicada» (`abreEn <= ahora`), así que el oráculo de lui9
 * queda intacto — la prohibición de añadir asignaciones `esteMes` se respeta.
 * Consumidor único: `scripts/e2e-lui19.mjs`; la pizarra (`limpiarContenidoDemo`)
 * las barre con toda la tabla.
 */
export const completarVivasParaCota = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    grupoNombre: v.string(),
    objetivo: v.number(),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const ahora = Date.now();
    const grupo = (await ctx.db.query("grupos").collect()).find(
      (g) => g.nombre === args.grupoNombre,
    );
    if (!grupo) throw new Error(`No existe el grupo «${args.grupoNombre}».`);
    const vivas = (
      await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo_cierra", (q) =>
          q.eq("grupoId", grupo._id).gt("cierraEn", ahora),
        )
        .collect()
    ).length;
    const faltan = args.objetivo - vivas;
    if (faltan <= 0) return { creadas: 0, vivas };
    const examen = await ctx.db
      .query("examenes")
      .withIndex("by_estado", (q) => q.eq("estado", "publicado"))
      .first();
    if (!examen) throw new Error("No hay examen publicado para sembrar vivas.");
    const admin = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "admin"))
      .first();
    if (!admin) throw new Error("No hay administradora para `creadoPor`.");
    for (let i = 0; i < faltan; i++) {
      const abreEn = ahora + 30 * DIA + i * DIA;
      await ctx.db.insert("asignaciones", {
        examenId: examen._id,
        ...camposDestino({ grupoId: grupo._id }),
        abreEn,
        cierraEn: abreEn + DIA,
        creadoPor: admin.userId,
        tituloExamen: examen.titulo,
        numReactivos: examen.reactivoIds.length,
        duracionMin: examen.duracionMin,
        tipoExamen: normalizarTipo(examen.tipo),
      });
    }
    return { creadas: faltan, vivas: vivas + faltan };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers del E2E del player (LUI-26 · LUI-27) — SOLO_DEV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ENVEJECE un intento en curso: mueve su `iniciadoEn` para que le queden exactamente
 * `msRestantes` hasta el límite, y RE-AGENDA su cierre durable (cancelando el job anterior:
 * ver el docblock de `intentos.cierreJobId`).
 *
 * Es el instrumento del testigo de TIEMPO del E2E: un simulacro real dura de 20 a 180
 * minutos y ninguna suite puede esperar eso. Con esto, el cruce del umbral de 5 minutos, el
 * cruce del cero y el escenario «tiempo agotado mientras el navegador estaba cerrado» se
 * prueban en segundos, contra el MISMO código de producción — no se simula nada: el reloj
 * del intento es real, solo empieza antes.
 *
 * ⚠️ `msRestantes` puede ser NEGATIVO (intento ya vencido, para el escenario del regreso).
 * Consumidor único: `scripts/e2e-lui26.mjs`.
 */
export const envejecerIntento = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    correo: v.string(),
    examen: v.string(),
    msRestantes: v.number(),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const ahora = Date.now();

    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => norm(u.email ?? "") === norm(args.correo));
    if (!user) throw new Error(`No existe la cuenta «${args.correo}».`);

    const examen = (await ctx.db.query("examenes").collect()).find(
      (e) => e.titulo === args.examen,
    );
    if (!examen) throw new Error(`No existe el examen «${args.examen}».`);

    // El más reciente en curso de esa alumna en ese examen.
    const enCurso = (
      await ctx.db
        .query("intentos")
        .withIndex("by_examen_estado", (q) =>
          q.eq("examenId", examen._id).eq("estado", "en_curso"),
        )
        .collect()
    )
      .filter((i) => i.alumnoId === user._id)
      .sort((a, b) => b.iniciadoEn - a.iniciadoEn)[0];
    if (!enCurso) {
      throw new Error(
        `«${args.correo}» no tiene un intento en curso de «${args.examen}».`,
      );
    }

    const asignacion = enCurso.asignacionId
      ? await ctx.db.get(enCurso.asignacionId)
      : null;
    // Se despeja `iniciadoEn` de `limiteDe`: como el límite puede venir RECORTADO por
    // `cierraEn`, se calcula el iniciado que da el restante pedido por DURACIÓN y se
    // comprueba después contra el límite real.
    const iniciadoEn =
      ahora + args.msRestantes - examen.duracionMin * 60_000;
    await ctx.db.patch(enCurso._id, { iniciadoEn });

    const limite = limiteDe(
      iniciadoEn,
      examen.duracionMin,
      asignacion?.cierraEn,
    );
    if (enCurso.cierreJobId) await ctx.scheduler.cancel(enCurso.cierreJobId);
    const cierreJobId = await ctx.scheduler.runAt(
      limite,
      internal.player.cerrarVencido,
      { intentoId: enCurso._id },
    );
    await ctx.db.patch(enCurso._id, { cierreJobId });

    return {
      intentoId: enCurso._id,
      iniciadoEn,
      limite,
      restanteMs: limite - ahora,
    };
  },
});

/**
 * Borra los grupos TEMPORALES del E2E del player y sus rastros (uniones con instructores y
 * alumnas que hubieran quedado dentro). Namespace marcado: solo toca nombres que empiecen
 * con `[E2E LUI-26]` — jamás los del fixture ni los grupos manuales de dev.
 *
 * Existe porque §14 necesita una alumna cuyo ÚNICO examen sea futuro, y el fixture no tiene
 * ningún grupo así; el grupo se crea, se usa y se retira. Sin este helper quedaría un grupo
 * de más en dev y los oráculos de otras suites tendrían que tolerarlo.
 */
export const limpiarGruposMarcados = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const marcados = (await ctx.db.query("grupos").collect()).filter((g) =>
      g.nombre.startsWith(MARCA_E2E_PLAYER),
    );
    let uniones = 0;
    let asignaciones = 0;
    for (const g of marcados) {
      for (const u of await ctx.db.query("grupoInstructores").collect()) {
        if (u.grupoId === g._id) {
          await ctx.db.delete(u._id);
          uniones++;
        }
      }
      const suyas = await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect();
      for (const a of suyas) {
        await ctx.db.delete(a._id);
        asignaciones++;
      }
      // Una alumna que se quedó dentro volvería a un grupo inexistente: se desliga.
      for (const p of await ctx.db
        .query("perfiles")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect()) {
        await ctx.db.patch(p._id, { grupoId: undefined });
      }
      await ctx.db.delete(g._id);
    }
    return { grupos: marcados.length, uniones, asignaciones };
  },
});

/**
 * Cuenta los cierres durables PENDIENTES, separando los HUÉRFANOS (jobs de intentos que la
 * pizarra ya borró: terminarán en no-op, pero siguen ocupando la cola).
 *
 * Existe para que el E2E pueda DEMOSTRAR —no afirmar— que correr la suite dos veces no
 * acumula trabajo residual relevante: registra el conteo antes y después, con la cota
 * «pendientes ≤ intentos en curso vivos + los que creó la corrida». Un delta cero sería una
 * exigencia falsa: las entregas legítimas dejan jobs futuros que aún no dispararon.
 */
export const contarJobsPendientes = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    const cierres = jobs.filter(
      (j) => j.name.includes("cerrarVencido") && j.state.kind === "pending",
    );
    let huerfanos = 0;
    for (const j of cierres) {
      const arg = j.args[0] as { intentoId?: Id<"intentos"> } | undefined;
      const intento = arg?.intentoId ? await ctx.db.get(arg.intentoId) : null;
      if (!intento || intento.estado === "enviado") huerfanos++;
    }
    const enCursoVivos = (
      await ctx.db.query("intentos").collect()
    ).filter((i) => i.estado === "en_curso").length;
    return {
      pendientes: cierres.length,
      huerfanos,
      enCursoVivos,
      totalJobs: jobs.length,
    };
  },
});

/**
 * (LUI-19 · §5c del E2E) Prepara el escenario de la frontera de membresías:
 *
 *  1. TRES grupos temporales ACTIVOS marcados («Candidato G/A/B»), asignados
 *     inicialmente a OTRO instructor (`candidatosPara`) — candidatos VÁLIDOS
 *     para los formularios reales (que solo ofrecen grupos activos); si el
 *     instructor bajo prueba ya estaba ligado a alguno, se le desliga (el test
 *     necesita añadirlos él).
 *  2. Fillers CERRADOS marcados («Filler NNN») con una unión cada uno hasta que
 *     el instructor tenga EXACTAMENTE `objetivo` uniones — cerrados: invisibles
 *     para el panel (filtro `activo`), para `asignar` y para el oráculo de lui9
 *     (`gruposActivos` cuenta activos). Idempotente: reutiliza los marcados
 *     existentes antes de crear.
 *
 * Toda mutación EXITOSA de §5c cae dentro del namespace marcado ⇒
 * `limpiarMembresiasParaCota` restaura EXACTAMENTE el estado previo (suite
 * repetible). El helper escribe uniones DIRECTO (es el andamio que construye el
 * estado «al borde de la cota» — la frontera productiva es justo lo que la
 * prueba va a ejercitar vía las mutations reales).
 */
export const sembrarMembresiasParaCota = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    instructorCorreo: v.string(),
    objetivo: v.number(),
    candidatosPara: v.string(),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const buscarUser = async (correo: string) => {
      const u = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", norm(correo)))
        .first();
      if (!u) throw new Error(`No existe el usuario «${correo}».`);
      return u._id;
    };
    const instructorId = await buscarUser(args.instructorCorreo);
    const duenoCandidatos = await buscarUser(args.candidatosPara);

    // 1. Candidatos ACTIVOS G/A/B.
    for (const letra of ["G", "A", "B"]) {
      const nombre = `${MARCA_COTA_LUI19} Candidato ${letra}`;
      const existente = (await ctx.db.query("grupos").collect()).find(
        (g) => g.nombre === nombre,
      );
      let grupoId;
      if (existente) {
        grupoId = existente._id;
        if (!existente.activo) await ctx.db.patch(grupoId, { activo: true });
      } else {
        grupoId = await ctx.db.insert("grupos", {
          nombre,
          ciclo: "Cota",
          activo: true,
        });
      }
      const uniones = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect();
      if (!uniones.some((u) => u.instructorId === duenoCandidatos)) {
        await ctx.db.insert("grupoInstructores", {
          grupoId,
          instructorId: duenoCandidatos,
        });
      }
      for (const u of uniones) {
        if (u.instructorId === instructorId) await ctx.db.delete(u._id);
      }
    }

    // 2. Fillers CERRADOS hasta dejar al instructor en `objetivo` uniones.
    const actuales = await ctx.db
      .query("grupoInstructores")
      .withIndex("by_instructor", (q) => q.eq("instructorId", instructorId))
      .collect();
    let faltan = args.objetivo - actuales.length;
    const ligadosSet = new Set(actuales.map((u) => u.grupoId as string));
    let ligados = 0;
    let creados = 0;
    const todos = await ctx.db.query("grupos").collect();
    for (const g of todos) {
      if (faltan <= 0) break;
      if (!g.nombre.startsWith(`${MARCA_COTA_LUI19} Filler`)) continue;
      if (ligadosSet.has(g._id as string)) continue;
      await ctx.db.insert("grupoInstructores", {
        grupoId: g._id,
        instructorId,
      });
      ligadosSet.add(g._id as string);
      ligados++;
      faltan--;
    }
    let n = todos.filter((g) =>
      g.nombre.startsWith(`${MARCA_COTA_LUI19} Filler`),
    ).length;
    while (faltan > 0) {
      const grupoId = await ctx.db.insert("grupos", {
        nombre: `${MARCA_COTA_LUI19} Filler ${String(++n).padStart(3, "0")}`,
        ciclo: "Cota",
        activo: false,
      });
      await ctx.db.insert("grupoInstructores", { grupoId, instructorId });
      creados++;
      faltan--;
    }
    return { creados, ligados, uniones: args.objetivo };
  },
});

/**
 * (LUI-19 · `finally` del E2E) Borra TODOS los grupos marcados «[Cota LUI-19]»
 * — fillers Y candidatos — y sus uniones: restaura exactamente el estado previo
 * a §5c. Solo toca el namespace marcado.
 */
export const limpiarMembresiasParaCota = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const marcados = (await ctx.db.query("grupos").collect()).filter((g) =>
      g.nombre.startsWith(MARCA_COTA_LUI19),
    );
    let uniones = 0;
    for (const g of marcados) {
      const filas = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect();
      for (const f of filas) {
        await ctx.db.delete(f._id);
        uniones++;
      }
      await ctx.db.delete(g._id);
    }
    return { grupos: marcados.length, uniones };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers del E2E de LUI-30 (Resultados del examen) — SOLO_DEV
//
// Disciplina común: namespace ESTRICTO `[E2E LUI-30]` / `e2e-lui30-*@invalido.local`;
// sembradores idempotentes (completan hasta el objetivo, no «insertan N»); limpiezas
// FÍSICAS con cascada académica completa (Convex no tiene borrado en cascada) en el
// ORDEN del limpiador integral: posiciones → respuestas → intentos → asignaciones →
// uniones → grupos. El E2E toma línea base con `contarLineaBase` ANTES de sembrar y
// aserta el regreso EXACTO en el `finally` — las corridas ×2 NO dependen de la pizarra
// global para estos rastros.
// ─────────────────────────────────────────────────────────────────────────────

/** Conteos CRUDOS de las tablas que los sembradores de LUI-30 tocan — la LÍNEA BASE del
 *  E2E (§0) y su aserción de restauración (§ final). Filas totales, sin filtrar. */
export const contarLineaBase = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const cuenta = async (
      tabla:
        | "grupos"
        | "perfiles"
        | "users"
        | "asignaciones"
        | "intentos"
        | "respuestas"
        | "posiciones"
        | "secciones"
        | "areasTematicas",
    ) => (await ctx.db.query(tabla).collect()).length;
    return {
      grupos: await cuenta("grupos"),
      perfiles: await cuenta("perfiles"),
      users: await cuenta("users"),
      asignaciones: await cuenta("asignaciones"),
      intentos: await cuenta("intentos"),
      respuestas: await cuenta("respuestas"),
      posiciones: await cuenta("posiciones"),
      secciones: await cuenta("secciones"),
      areasTematicas: await cuenta("areasTematicas"),
    };
  },
});

/** Grupo marcado de LUI-30: lo encuentra o lo crea (idempotente). */
async function grupoLui30(
  ctx: MutationCtx,
  sufijo: string,
  activo: boolean,
): Promise<Id<"grupos">> {
  const nombre = `${MARCA_E2E_LUI30} ${sufijo}`;
  const existente = (await ctx.db.query("grupos").collect()).find(
    (g) => g.nombre === nombre,
  );
  if (existente) return existente._id;
  return await ctx.db.insert("grupos", { nombre, activo });
}

/**
 * (§5d del E2E) Siembra `objetivo` intentos ENVIADOS mínimos sobre UNA asignación de un
 * grupo marcado — el instrumento de la frontera 400/401 del centinela de
 * `leerIntentosParaAnalitica` y, en modo `conDesglose`, de su corte por BYTES (cada
 * intento carga un desglose de 240 entradas ≈ 40 KiB: ~160 filas superan los 6 MiB del
 * paginate ANTES de las 401 — el testigo específico de la rama `!isDone`).
 *
 * ⚠️ Por defecto fabrica EXCLUSIVAMENTE `enviado` SIN `cierreJobId` — jamás `en_curso`:
 * CERO jobs pendientes por construcción (la limpieza lo aserta). Reutiliza UNA alumna
 * real repetida (el corte cuenta FILAS del rango, no alumnas distintas; el selector
 * deduplica y eso no afecta la frontera). Estampa `envioRegistradoEn` en la asignación:
 * el contrato del read-model se respeta también en el andamiaje. `seccionId`/`areaId`
 * opcionales apuntan el desglose a clasificaciones específicas (p. ej. las infladas de
 * §5e); sin ellas usa las primeras del temario.
 *
 * `conJobHuerfano` (testigo de la ronda 2 de auditoría y del §12b del E2E): fabrica UN
 * intento con un `cerrarVencido` REAL agendado y luego lo deja «enviado a mano»
 * reproduciendo EXACTAMENTE lo que hace `finalizarIntento` — limpia `cierreJobId` SIN
 * cancelar el job. El resultado es la fila-trampa de la limpieza: un job pendiente que
 * ningún campo referencia y que solo el barrido por conjunto capturado puede cancelar.
 */
export const sembrarIntentosParaCota = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    objetivo: v.number(),
    conDesglose: v.optional(v.boolean()),
    conJobHuerfano: v.optional(v.boolean()),
    seccionId: v.optional(v.id("secciones")),
    areaId: v.optional(v.id("areasTematicas")),
    instructorCorreo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const ahora = Date.now();

    const grupoId = await grupoLui30(ctx, "Cota intentos", true);

    if (args.instructorCorreo) {
      const user = (await ctx.db.query("users").collect()).find(
        (u) => norm(u.email ?? "") === norm(args.instructorCorreo ?? ""),
      );
      if (!user) throw new Error(`No existe «${args.instructorCorreo}».`);
      const uniones = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect();
      if (!uniones.some((u) => u.instructorId === user._id)) {
        await ctx.db.insert("grupoInstructores", {
          grupoId,
          instructorId: user._id,
        });
      }
    }

    const examen = await ctx.db
      .query("examenes")
      .withIndex("by_estado", (q) => q.eq("estado", "publicado"))
      .first();
    if (!examen) throw new Error("No hay examen publicado para la cota.");
    const admin = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "admin"))
      .first();
    if (!admin) throw new Error("No hay administradora para `creadoPor`.");
    const alumna = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .first();
    if (!alumna) throw new Error("No hay alumna para los intentos de cota.");

    let asignacion = (
      await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect()
    )[0];
    if (!asignacion) {
      const abreEn = ahora - 60_000;
      const id = await ctx.db.insert("asignaciones", {
        examenId: examen._id,
        ...camposDestino({ grupoId }),
        abreEn,
        cierraEn: ahora + 30 * DIA,
        creadoPor: admin.userId,
        tituloExamen: examen.titulo,
        numReactivos: examen.reactivoIds.length,
        duracionMin: examen.duracionMin,
        tipoExamen: normalizarTipo(examen.tipo),
      });
      asignacion = (await ctx.db.get(id))!;
    }

    // ── Testigo del job huérfano (ronda 2 · §12b) ─────────────────────────
    // Job REAL agendado + «envío a mano» que limpia el campo SIN cancelar — la
    // reproducción exacta del hueco: queda un `cerrarVencido` pendiente que ningún
    // campo referencia (al disparar en 1 h haría no-op, pero es trabajo residual que
    // la limpieza DEBE cancelar por conjunto capturado).
    if (args.conJobHuerfano) {
      const intentoId = await ctx.db.insert("intentos", {
        examenId: examen._id,
        alumnoId: alumna.userId,
        asignacionId: asignacion._id,
        estado: "en_curso",
        iniciadoEn: ahora,
        numeroIntento: 1,
      });
      // Anotación EXPLÍCITA: devolver este id hace que TS intente resolver el tipo del
      // handler a través del grafo de `internal` (que incluye a esta misma función) y
      // reporte una circularidad TS7022 sin ella.
      const jobId: Id<"_scheduled_functions"> = await ctx.scheduler.runAt(
        ahora + 60 * 60_000,
        internal.player.cerrarVencido,
        { intentoId },
      );
      await ctx.db.patch(intentoId, {
        estado: "enviado",
        enviadoEn: ahora,
        puntaje: 1000,
        formaCierre: "manual",
        cierreJobId: undefined, // como `finalizarIntento`: limpia sin cancelar
      });
      if (asignacion.envioRegistradoEn === undefined) {
        await ctx.db.patch(asignacion._id, { envioRegistradoEn: ahora });
      }
      return {
        grupoId,
        asignacionId: asignacion._id,
        creados: 1,
        intentoConJobHuerfano: intentoId,
        jobId,
      };
    }

    // Desglose GORDO opcional: 240 entradas por arreglo (la cota real del constructor),
    // repitiendo la clasificación indicada — el tamaño contractual de un cierre real.
    const seccionRef =
      args.seccionId ??
      (await ctx.db.query("secciones").collect())[0]?._id;
    const areaRef =
      args.areaId ?? (await ctx.db.query("areasTematicas").collect())[0]?._id;
    if (args.conDesglose && (!seccionRef || !areaRef)) {
      throw new Error("No hay temario para fabricar el desglose gordo.");
    }
    const desgloseGordo = args.conDesglose
      ? {
          aciertosPorSeccion: Array.from({ length: 240 }, (_, i) => ({
            seccionId: seccionRef!,
            aciertos: i % 2,
            total: 1,
          })),
          aciertosPorArea: Array.from({ length: 240 }, (_, i) => ({
            areaId: areaRef!,
            aciertos: i % 2,
            total: 1,
          })),
        }
      : {};

    const existentes = (
      await ctx.db
        .query("intentos")
        .withIndex("by_asignacion", (q) => q.eq("asignacionId", asignacion._id))
        .collect()
    ).length;
    let creados = 0;
    for (let k = existentes; k < args.objetivo; k++) {
      await ctx.db.insert("intentos", {
        examenId: examen._id,
        alumnoId: alumna.userId,
        asignacionId: asignacion._id,
        estado: "enviado",
        iniciadoEn: asignacion.abreEn + k,
        enviadoEn: asignacion.abreEn + k + 1,
        puntaje: 1000,
        numeroIntento: 1,
        formaCierre: "manual",
        ...desgloseGordo,
      });
      creados++;
    }
    if (asignacion.envioRegistradoEn === undefined && args.objetivo > 0) {
      await ctx.db.patch(asignacion._id, {
        envioRegistradoEn: asignacion.abreEn + 1,
      });
    }
    return { grupoId, asignacionId: asignacion._id, creados };
  },
});

/**
 * (§11 del E2E) Enciende los flags del panel admin migrado:
 *  · `sinEnvios: false` (default) — asignaciones del MES con UN intento enviado cada una
 *    (y `envioRegistradoEn` estampado: el contrato del read-model se respeta): con
 *    objetivo 201 la métrica del mes desborda `MAX_APLICADAS_MES_PANEL` → «—» + Alert.
 *  · `sinEnvios: true` — asignaciones RECIENTES sin ningún envío: llenan la ventana de
 *    escaneo de «Últimos aplicados» (30) sin aportar aplicadas → nota de incompletitud.
 * Idempotente: completa hasta el objetivo contando las existentes del grupo marcado.
 */
export const sembrarAplicadasParaCota = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    objetivo: v.number(),
    sinEnvios: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const ahora = Date.now();
    const inicioMes = inicioDeMesMx(ahora);
    const sufijo = args.sinEnvios ? "Sin envíos" : "Aplicadas";
    const grupoId = await grupoLui30(ctx, sufijo, true);

    const examen = await ctx.db
      .query("examenes")
      .withIndex("by_estado", (q) => q.eq("estado", "publicado"))
      .first();
    if (!examen) throw new Error("No hay examen publicado para la cota.");
    const admin = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "admin"))
      .first();
    if (!admin) throw new Error("No hay administradora para `creadoPor`.");
    const alumna = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .first();
    if (!alumna) throw new Error("No hay alumna para los envíos de cota.");

    const existentes = (
      await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .collect()
    ).length;
    let creadas = 0;
    for (let k = existentes; k < args.objetivo; k++) {
      // Dentro del mes SIEMPRE (a minutos de `ahora`, con piso en el inicio de mes MX).
      const abreEn = Math.max(inicioMes, ahora - (k + 1) * 60_000);
      const asignacionId = await ctx.db.insert("asignaciones", {
        examenId: examen._id,
        ...camposDestino({ grupoId }),
        abreEn,
        cierraEn: ahora + 30 * DIA,
        creadoPor: admin.userId,
        tituloExamen: examen.titulo,
        numReactivos: examen.reactivoIds.length,
        duracionMin: examen.duracionMin,
        tipoExamen: normalizarTipo(examen.tipo),
        ...(args.sinEnvios ? {} : { envioRegistradoEn: abreEn + 1 }),
      });
      if (!args.sinEnvios) {
        await ctx.db.insert("intentos", {
          examenId: examen._id,
          alumnoId: alumna.userId,
          asignacionId,
          estado: "enviado",
          iniciadoEn: abreEn,
          enviadoEn: abreEn + 1,
          puntaje: 1000,
          numeroIntento: 1,
          formaCierre: "manual",
        });
      }
      creadas++;
    }
    return { grupoId, creadas, totales: existentes + creadas };
  },
});

/**
 * (§5e del E2E) Crea una sección y un área NUEVAS marcadas con nombres de ~280 KB cada
 * una (Σ > `CATALOGO_CLASIF_BYTES`): el testigo del PARO TEMPRANO por bytes del catálogo
 * de Q3. NINGÚN doc real del temario se toca — cero riesgo colateral; la restauración es
 * `limpiarClasificacionesMarcadas`, independiente en el `finally`.
 *
 * ⚠️ Inserta DIRECTO en la BD (bypass consciente de `MAX_NOMBRE_TEMARIO`): simula el
 * LEGADO anterior a esa frontera de escritura, que es exactamente lo que el paro por
 * bytes protege. Mientras estas filas existan, `panelInstructor.material` reporta su
 * corte por bytes (256 KiB) — por eso §5e siembra, prueba y limpia en la misma sección.
 * `activo: false` para minimizar su visibilidad en formularios.
 */
export const sembrarClasificacionInflada = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const relleno = "x".repeat(280_000);
    const nombreSeccion = `${MARCA_E2E_LUI30} Sección inflada ${relleno}`;
    const nombreArea = `${MARCA_E2E_LUI30} Área inflada ${relleno}`;

    let seccion = (await ctx.db.query("secciones").collect()).find((s) =>
      s.nombre.startsWith(`${MARCA_E2E_LUI30} Sección inflada`),
    );
    if (!seccion) {
      const id = await ctx.db.insert("secciones", {
        nombre: nombreSeccion,
        tipo: "modulo",
        activo: false,
        orden: 99_999,
        reactivosCount: 0,
      });
      seccion = (await ctx.db.get(id))!;
    }
    let area = (await ctx.db.query("areasTematicas").collect()).find((a) =>
      a.nombre.startsWith(`${MARCA_E2E_LUI30} Área inflada`),
    );
    if (!area) {
      const id = await ctx.db.insert("areasTematicas", {
        seccionId: seccion._id,
        nombre: nombreArea,
        activo: false,
        orden: 99_999,
        reactivosCount: 0,
      });
      area = (await ctx.db.get(id))!;
    }
    return { seccionId: seccion._id, areaId: area._id };
  },
});

/** (§11) Grupos marcados hasta el objetivo — desbordan el paginate de `panel.grupos`
 *  (el corte cuenta FILAS leídas de la tabla, activos o no; `activo: false` los oculta de
 *  formularios y del panel del instructor mientras existen). Idempotente. */
export const sembrarGruposParaCota = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV), objetivo: v.number() },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const existentes = (await ctx.db.query("grupos").collect()).filter((g) =>
      g.nombre.startsWith(`${MARCA_E2E_LUI30} Grupo`),
    ).length;
    let creados = 0;
    for (let k = existentes; k < args.objetivo; k++) {
      await ctx.db.insert("grupos", {
        nombre: `${MARCA_E2E_LUI30} Grupo ${String(k).padStart(4, "0")}`,
        activo: false,
      });
      creados++;
    }
    return { creados, totalMarcados: existentes + creados };
  },
});

/**
 * (§11) Perfiles de alumna SINTÉTICOS hasta el objetivo, por LOTES de 200 por llamada
 * (el llamador repite hasta `faltan === 0` — igual que un cursor): desbordan el paginate
 * de `panel.alumnos`. **UN user sintético NUEVO por perfil** (`e2e-lui30-N@invalido.local`),
 * jamás un userId real ni uno compartido: la limpieza borra el PAR completo sin tocar a
 * nadie más.
 */
export const sembrarPerfilesParaCota = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV), objetivo: v.number() },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const LOTE = 200;
    const marcados = (await ctx.db.query("perfiles").collect()).filter((p) =>
      p.nombre.startsWith(`${MARCA_E2E_LUI30} Alumna`),
    ).length;
    const faltanAntes = Math.max(0, args.objetivo - marcados);
    const crear = Math.min(LOTE, faltanAntes);
    for (let j = 0; j < crear; j++) {
      const idx = marcados + j;
      const userId = await ctx.db.insert("users", {
        email: CORREO_E2E_LUI30(idx),
      });
      await ctx.db.insert("perfiles", {
        userId,
        rol: "alumno",
        nombre: `${MARCA_E2E_LUI30} Alumna ${String(idx).padStart(4, "0")}`,
        activo: true,
      });
    }
    return {
      creados: crear,
      totalMarcados: marcados + crear,
      faltan: faltanAntes - crear,
    };
  },
});

/** (§5f) Quita `envioRegistradoEn` de la asignación (examen, grupo) del fixture: fabrica
 *  la fila «con envíos y sin campo» que el fasado de la migración impide en prod — el
 *  escenario ROJO que la reconciliación repara. */
export const borrarEnvioRegistrado = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    examen: v.string(),
    grupo: v.string(),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const grupo = (await ctx.db.query("grupos").collect()).find(
      (g) => g.nombre === args.grupo,
    );
    if (!grupo) throw new Error(`No existe el grupo «${args.grupo}».`);
    const examen = (await ctx.db.query("examenes").collect()).find(
      (e) => e.titulo === args.examen,
    );
    if (!examen) throw new Error(`No existe el examen «${args.examen}».`);
    const asignacion = (
      await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupo._id))
        .collect()
    ).find((a) => a.examenId === examen._id);
    if (!asignacion) {
      throw new Error(`No hay asignación «${args.examen}·${args.grupo}».`);
    }
    const tenia = asignacion.envioRegistradoEn !== undefined;
    await ctx.db.patch(asignacion._id, { envioRegistradoEn: undefined });
    return { asignacionId: asignacion._id, tenia };
  },
});

/**
 * (`finally` del E2E) Borra FÍSICAMENTE los grupos marcados de LUI-30 con su CASCADA
 * ACADÉMICA COMPLETA, en el orden del limpiador integral (`limpiarContenidoDemo`):
 * posiciones → respuestas → intentos → asignaciones → uniones → grupo. Convex no tiene
 * borrado en cascada: sin esto quedarían intentos huérfanos alimentando
 * `by_examen_estado`/`tieneResultados` (el hallazgo mayor del 5º dictamen del plan).
 *
 * `lote` acota las eliminaciones de INTENTOS por llamada (el llamador repite hasta
 * `quedan === false` — cursor por lotes). Los JOBS de cierre se cancelan por CONJUNTO
 * CAPTURADO, no por `cierreJobId`: `finalizarIntento` limpia ese campo sin cancelar el
 * job, así que un intento real del player (§5/§5b generan intentos vía player sobre
 * grupos marcados; los sembradores de LUI-30 no crean jobs por construcción) enviado a
 * mano dejaría un `cerrarVencido` pendiente irrastreable por campo. La pertenencia se
 * captura ANTES de borrar y la aserción final barre la cola contra ESE conjunto — con
 * `get(intentoId)` sería vacua: el doc ya no existe (ronda 1 de auditoría de código).
 * Idempotente y tolerante a siembras parciales.
 */
export const limpiarGruposLui30 = internalMutation({
  args: {
    confirmar: v.literal(CONFIRMACION_SOLO_DEV),
    lote: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const lote = args.lote ?? 500;
    const conteo = {
      grupos: 0,
      uniones: 0,
      asignaciones: 0,
      intentos: 0,
      respuestas: 0,
      posiciones: 0,
      jobsCancelados: 0,
    };
    let borradosIntentos = 0;

    const marcados = (await ctx.db.query("grupos").collect()).filter((g) =>
      g.nombre.startsWith(MARCA_E2E_LUI30),
    );

    // ── PRIMERO: capturar la pertenencia y barrer la COLA (ronda 1 de auditoría) ──
    // `finalizarIntento` limpia `cierreJobId` del intento SIN cancelar el job (el job
    // vivo hará no-op al disparar): un intento real del player enviado a mano en un
    // grupo marcado deja un `cerrarVencido` pendiente que el campo ya no referencia.
    // Por eso la cancelación NO puede depender de `cierreJobId`, y la pertenencia se
    // captura ANTES de borrar nada — reconstruirla después con `get(intentoId)` es
    // imposible (el doc ya no existe) y era exactamente el hueco por el que un
    // huérfano pasaba la aserción. Cancelar un job ya ejecutado/cancelado es no-op ⇒
    // el barrido es idempotente entre lotes y tolera siembras parciales.
    const intentosMarcados = new Set<string>();
    for (const g of marcados) {
      for (const a of await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect()) {
        for (const i of await ctx.db
          .query("intentos")
          .withIndex("by_asignacion", (q) => q.eq("asignacionId", a._id))
          .collect()) {
          intentosMarcados.add(i._id as string);
        }
      }
    }
    const esCierrePendienteDe = (
      j: { name: string; state: { kind: string }; args: unknown[] },
      conjunto: ReadonlySet<string>,
    ) => {
      if (!j.name.includes("cerrarVencido") || j.state.kind !== "pending")
        return false;
      const arg = j.args[0] as { intentoId?: Id<"intentos"> } | undefined;
      return arg?.intentoId !== undefined && conjunto.has(arg.intentoId as string);
    };
    for (const j of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (esCierrePendienteDe(j, intentosMarcados)) {
        await ctx.scheduler.cancel(j._id);
        conteo.jobsCancelados++;
      }
    }

    for (const g of marcados) {
      const suyas = await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect();
      for (const a of suyas) {
        const intentos = await ctx.db
          .query("intentos")
          .withIndex("by_asignacion", (q) => q.eq("asignacionId", a._id))
          .collect();
        for (const i of intentos) {
          if (borradosIntentos >= lote) {
            // Presupuesto del lote agotado: el llamador repite. Nada quedó a medias —
            // cada intento se borra con TODAS sus dependencias antes de contar, y el
            // barrido de la cola de arriba ya corrió sobre el conjunto COMPLETO.
            return { ...conteo, quedan: true };
          }
          for (const r of await ctx.db
            .query("respuestas")
            .withIndex("by_intento_reactivo", (q) => q.eq("intentoId", i._id))
            .collect()) {
            await ctx.db.delete(r._id);
            conteo.respuestas++;
          }
          for (const p of await ctx.db
            .query("posiciones")
            .withIndex("by_intento", (q) => q.eq("intentoId", i._id))
            .collect()) {
            await ctx.db.delete(p._id);
            conteo.posiciones++;
          }
          // SIN cancelación por `cierreJobId` aquí (ronda 2 de auditoría): el barrido
          // canónico de arriba ya canceló CADA job pendiente del conjunto — un job
          // referenciado por el campo también está en `intentosMarcados` — y el
          // contrato de `Scheduler.cancel` no documenta idempotencia: una segunda
          // cancelación del mismo id podría lanzar y hacer rollback de TODA la
          // limpieza. Cada id pendiente se cancela EXACTAMENTE una vez.
          await ctx.db.delete(i._id);
          conteo.intentos++;
          borradosIntentos++;
        }
        await ctx.db.delete(a._id);
        conteo.asignaciones++;
      }
      for (const u of await ctx.db
        .query("grupoInstructores")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect()) {
        await ctx.db.delete(u._id);
        conteo.uniones++;
      }
      // Una alumna real que quedó dentro volvería a un grupo inexistente: se desliga.
      for (const p of await ctx.db
        .query("perfiles")
        .withIndex("by_grupo", (q) => q.eq("grupoId", g._id))
        .collect()) {
        await ctx.db.patch(p._id, { grupoId: undefined });
      }
      await ctx.db.delete(g._id);
      conteo.grupos++;
    }

    // Aserción de cierre sobre el CONJUNTO CAPTURADO (no sobre `get(intentoId)`, que a
    // estas alturas siempre es null): tras cancelar y borrar, ningún `cerrarVencido`
    // pendiente puede seguir apuntando a un intento que fue de un grupo marcado.
    for (const j of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (esCierrePendienteDe(j, intentosMarcados)) {
        throw new Error(
          "Limpieza incompleta: queda un cierre durable de un intento marcado.",
        );
      }
    }
    return { ...conteo, quedan: false };
  },
});

/** (`finally` del E2E) Borra FÍSICAMENTE cada perfil sintético marcado Y su user, por
 *  LOTES (el llamador repite hasta `quedan === false`). Al terminar, barre users
 *  huérfanos del namespace de correo (residuos de una siembra interrumpida). */
export const limpiarPerfilesLui30 = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const LOTE = 400;
    const marcados = (await ctx.db.query("perfiles").collect()).filter((p) =>
      p.nombre.startsWith(`${MARCA_E2E_LUI30} Alumna`),
    );
    const tanda = marcados.slice(0, LOTE);
    let users = 0;
    for (const p of tanda) {
      const user = await ctx.db.get(p.userId);
      await ctx.db.delete(p._id);
      if (user && CORREO_E2E_LUI30_RE.test(user.email ?? "")) {
        await ctx.db.delete(user._id);
        users++;
      }
    }
    const quedan = marcados.length > tanda.length;
    let usersHuerfanos = 0;
    if (!quedan) {
      for (const u of await ctx.db.query("users").collect()) {
        if (!CORREO_E2E_LUI30_RE.test(u.email ?? "")) continue;
        await ctx.db.delete(u._id);
        usersHuerfanos++;
      }
    }
    return { perfiles: tanda.length, users, usersHuerfanos, quedan };
  },
});

/** (`finally` del E2E) Borra las clasificaciones INFLADAS marcadas (§5e). Independiente
 *  de las otras limpiezas: si §5e falló a medias, esta restaura su parte igual. */
export const limpiarClasificacionesMarcadas = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    let subtemas = 0;
    let areas = 0;
    let secciones = 0;
    for (const s of await ctx.db.query("subtemas").collect()) {
      if (!s.nombre.startsWith(MARCA_E2E_LUI30)) continue;
      await ctx.db.delete(s._id);
      subtemas++;
    }
    for (const a of await ctx.db.query("areasTematicas").collect()) {
      if (!a.nombre.startsWith(MARCA_E2E_LUI30)) continue;
      await ctx.db.delete(a._id);
      areas++;
    }
    for (const s of await ctx.db.query("secciones").collect()) {
      if (!s.nombre.startsWith(MARCA_E2E_LUI30)) continue;
      await ctx.db.delete(s._id);
      secciones++;
    }
    return { secciones, areas, subtemas };
  },
});
