/**
 * Prueba del núcleo puro de la META de la alumna (LUI-36) y de la derivación de Resultados
 * de UN intento (LUI-28). Corre con `npm run test:meta` (tsx).
 *
 * Misma razón de existir que `test-simulacro.ts`: **`npx convex run` corre SIN identidad**,
 * así que todo lo que vive tras `requireAlumna` daría falso verde. Lo decidible sin BD se
 * prueba aquí contra el MISMO código de producción — `convex/metaAlumna.ts` y las funciones
 * compartidas de `convex/resultados.ts`.
 *
 * Archivo NUEVO: las suites existentes conservan sus conteos IDÉNTICOS.
 */
import { ConvexError } from "convex/values";
import {
  BADGE_META_ALCANZADA,
  BADGE_META_SUPERADA,
  MAX_TEXTO_META,
  MSG_CARRERA_OBLIGATORIA,
  MSG_INSTITUCION_OBLIGATORIA,
  MSG_META_RANGO,
  MSG_TEXTO_CONTROL,
  MSG_TEXTO_LARGO,
  MSG_TRIPLETA_PARCIAL,
  PASO_META,
  badgeDeMeta,
  compararConMeta,
  etiquetaDelta,
  limpiarTextoMeta,
  metaDe,
  validarMetaPuntaje,
} from "../convex/metaAlumna";
import {
  PUNTAJE_BASE,
  PUNTAJE_MAX,
  PUNTAJE_RANGO,
  calcularPuntaje,
} from "../convex/simulacro";
import {
  UMBRAL_REFUERZO_AREA,
  construirAcordeon,
  derivarResultadoIntento,
  ordenDeColumnas,
  type CatalogoClasificaciones,
  type IntentoCrudoResultados,
} from "../convex/resultados";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

/** Ejecuta y devuelve el mensaje de la ConvexError, o null si NO lanzó. */
function mensajeDe(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ConvexError ? String(e.data) : `error inesperado: ${e}`;
  }
}

/**
 * El valor devuelto, o `null` si LANZÓ. Todas las aserciones de «esto PASA» van por aquí:
 * si el código bajo prueba se rompe y empieza a lanzar donde no debe, esta suite tiene que
 * marcar UN fallo y seguir — una excepción sin capturar abortaría el proceso y se llevaría
 * por delante todas las comprobaciones posteriores, que es justo cuando más falta hacen.
 */
function valorDe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Ids tipados para los módulos puros (mismo truco `as never` que las otras suites). */
const id = (s: string) => s as never;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Texto libre del perfil (institución y carrera)");
{
  check(
    "recorta extremos y conserva el interior",
    valorDe(() => limpiarTextoMeta("  Universidad de Guadalajara  ", MSG_INSTITUCION_OBLIGATORIA)) ===
      "Universidad de Guadalajara",
  );
  check(
    "vacío tras trim → rechazo con el copy de SU campo (institución)",
    mensajeDe(() => limpiarTextoMeta("   ", MSG_INSTITUCION_OBLIGATORIA)) ===
      MSG_INSTITUCION_OBLIGATORIA,
  );
  check(
    "vacío tras trim → rechazo con el copy de SU campo (carrera): el mensaje NO es genérico",
    mensajeDe(() => limpiarTextoMeta("", MSG_CARRERA_OBLIGATORIA)) ===
      MSG_CARRERA_OBLIGATORIA,
  );
  check(
    "cadena vacía real también rechaza",
    mensajeDe(() => limpiarTextoMeta("", MSG_INSTITUCION_OBLIGATORIA)) !== null,
  );

  // FRONTERA exacta: 120 pasa, 121 rechaza.
  const justo = "a".repeat(MAX_TEXTO_META);
  const unoMas = "a".repeat(MAX_TEXTO_META + 1);
  check(
    `${MAX_TEXTO_META} caracteres PASAN`,
    valorDe(() => limpiarTextoMeta(justo, MSG_CARRERA_OBLIGATORIA)) === justo,
  );
  check(
    `${MAX_TEXTO_META + 1} caracteres RECHAZAN`,
    mensajeDe(() => limpiarTextoMeta(unoMas, MSG_CARRERA_OBLIGATORIA)) === MSG_TEXTO_LARGO,
  );
  check(
    "la cota se mide DESPUÉS de recortar: 120 útiles con espacios alrededor pasan",
    valorDe(() => limpiarTextoMeta(`   ${justo}   `, MSG_CARRERA_OBLIGATORIA)) === justo,
  );

  // Multibyte: la cota cuenta CODE POINTS, no unidades UTF-16 ni bytes.
  const emojis = "🎓".repeat(MAX_TEXTO_META);
  check(
    `${MAX_TEXTO_META} emojis (240 unidades UTF-16) PASAN: se cuentan code points`,
    valorDe(() => limpiarTextoMeta(emojis, MSG_CARRERA_OBLIGATORIA)) === emojis,
  );
  check(
    `${MAX_TEXTO_META + 1} emojis RECHAZAN`,
    mensajeDe(() => limpiarTextoMeta("🎓".repeat(MAX_TEXTO_META + 1), MSG_CARRERA_OBLIGATORIA)) ===
      MSG_TEXTO_LARGO,
  );

  // NFC: «é» descompuesta (e + U+0301) cuenta como UN carácter tras normalizar. Sin NFC,
  // 120 «é» tecleadas en un teclado que descompone medirían 240 y rechazarían.
  const eDescompuesta = "é";
  const ciento20Descompuestas = eDescompuesta.repeat(MAX_TEXTO_META);
  check(
    "NFC: 120 «é» descompuestas PASAN (sin normalizar medirían 240)",
    valorDe(() => limpiarTextoMeta(ciento20Descompuestas, MSG_CARRERA_OBLIGATORIA)) ===
      ciento20Descompuestas.normalize("NFC"),
  );
  check(
    "NFC: la forma compuesta y la descompuesta producen EL MISMO texto guardado",
    valorDe(() => limpiarTextoMeta("Medicina é", MSG_CARRERA_OBLIGATORIA)) ===
      valorDe(() => limpiarTextoMeta("Medicina é", MSG_CARRERA_OBLIGATORIA)),
  );

  // Caracteres de control: basura pegada, no contenido.
  check(
    "salto de línea RECHAZA (campo de una línea)",
    mensajeDe(() => limpiarTextoMeta("UDG\nCUCS", MSG_INSTITUCION_OBLIGATORIA)) ===
      MSG_TEXTO_CONTROL,
  );
  check(
    "tabulador interior RECHAZA",
    mensajeDe(() => limpiarTextoMeta("UDG\tCUCS", MSG_INSTITUCION_OBLIGATORIA)) ===
      MSG_TEXTO_CONTROL,
  );
  check(
    "NUL RECHAZA",
    mensajeDe(() => limpiarTextoMeta("UDG\u0000", MSG_INSTITUCION_OBLIGATORIA)) ===
      MSG_TEXTO_CONTROL,
  );
  check(
    "DEL (U+007F) RECHAZA",
    mensajeDe(() => limpiarTextoMeta("UDG\u007F", MSG_INSTITUCION_OBLIGATORIA)) ===
      MSG_TEXTO_CONTROL,
  );
  check(
    "un \\n en los EXTREMOS lo come el trim y NO rechaza (solo estorba dentro)",
    valorDe(() => limpiarTextoMeta("\nUDG\n", MSG_INSTITUCION_OBLIGATORIA)) === "UDG",
  );
  check(
    "acentos y ñ normales pasan intactos",
    valorDe(() => limpiarTextoMeta("Ingeniería en Computación · UNAM", MSG_CARRERA_OBLIGATORIA)) ===
      "Ingeniería en Computación · UNAM",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Puntaje objetivo: rango, enteros y el paso del slider");
{
  check(
    `${PUNTAJE_BASE} (piso) PASA`,
    valorDe(() => validarMetaPuntaje(PUNTAJE_BASE)) === PUNTAJE_BASE,
  );
  check(
    `${PUNTAJE_MAX} (techo) PASA`,
    valorDe(() => validarMetaPuntaje(PUNTAJE_MAX)) === PUNTAJE_MAX,
  );
  check(
    `${PUNTAJE_BASE - 1} RECHAZA`,
    mensajeDe(() => validarMetaPuntaje(PUNTAJE_BASE - 1)) === MSG_META_RANGO,
  );
  check(
    `${PUNTAJE_MAX + 1} RECHAZA`,
    mensajeDe(() => validarMetaPuntaje(PUNTAJE_MAX + 1)) === MSG_META_RANGO,
  );
  check(
    "decimal RECHAZA (la meta es un entero)",
    mensajeDe(() => validarMetaPuntaje(1150.5)) === MSG_META_RANGO,
  );
  check("NaN RECHAZA", mensajeDe(() => validarMetaPuntaje(Number.NaN)) === MSG_META_RANGO);
  check(
    "Infinity RECHAZA",
    mensajeDe(() => validarMetaPuntaje(Number.POSITIVE_INFINITY)) === MSG_META_RANGO,
  );
  check(
    `⭐ 1147 PASA aunque NO sea múltiplo de ${PASO_META}: el paso es del slider, no del servidor ` +
      "(si no, la entrada numérica accesible sería la ruta que falla)",
    valorDe(() => validarMetaPuntaje(1147)) === 1147,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ ⭐ Invariante de REDONDEO: todo lo visible se compara contra el número visible");
{
  // El caso exacto del dictamen: 67 aciertos de 90 → 1146.666…, que la pantalla muestra como
  // 1147. Comparar contra el CRUDO diría «A 1 punto» debajo de un «1147» junto a una meta de
  // 1147: el número principal contradiciendo a su propio comentario.
  const crudo = calcularPuntaje(67, 90);
  check("el crudo NO es entero (67/90)", !Number.isInteger(crudo));
  const c = compararConMeta(crudo, 1147);
  check("⭐ 1146.666… con meta 1147 → puntajeMostrado 1147", c.puntajeMostrado === 1147);
  check("⭐ …y delta 0 (no «A 1 punto»)", c.delta === 0);
  check("⭐ …y ALCANZADA", c.alcanzada);
  check("⭐ …y NO superada (empate no es superación)", !c.superada);
  check("⭐ …y sin etiqueta de delta", etiquetaDelta(c, "Fernanda") === null);
  check("⭐ …y badge de ALCANZADA, no de superada", badgeDeMeta(c) === BADGE_META_ALCANZADA);

  const igual = compararConMeta(1150, 1150);
  check("igualdad exacta → alcanzada", igual.alcanzada);
  check("igualdad exacta → NO superada", !igual.superada);
  check("igualdad exacta → delta 0", igual.delta === 0);

  const superada = compararConMeta(1151, 1150);
  check("1151 con meta 1150 → superada", superada.superada && superada.alcanzada);
  check("…con el badge del diseño", badgeDeMeta(superada) === BADGE_META_SUPERADA);
  check("…y delta negativo, sin etiqueta", superada.delta === -1 && etiquetaDelta(superada, "F") === null);

  // Lado de abajo del redondeo: 1146.4 muestra 1146 y sí faltan puntos.
  const casi = compararConMeta(1146.4, 1147);
  check("1146.4 con meta 1147 → muestra 1146", casi.puntajeMostrado === 1146);
  check("…delta 1", casi.delta === 1);
  check("…NO alcanzada", !casi.alcanzada && badgeDeMeta(casi) === null);
  check(
    "⭐ singular: «A 1 punto», no «A 1 puntos»",
    etiquetaDelta(casi, "Fernanda") === "¡A 1 punto de tu meta, Fernanda!",
  );

  const lejos = compararConMeta(1138, 1150);
  check(
    "plural: «A 12 puntos»",
    etiquetaDelta(lejos, "Fernanda") === "¡A 12 puntos de tu meta, Fernanda!",
  );
  check("el nombre viaja en el copy", etiquetaDelta(lejos, "Ana")?.includes("Ana") === true);

  // Contrato de la barra: trasladado al origen de la escala.
  const barra = compararConMeta(1000, 1150);
  check("barra: value = puntajeMostrado − 700", barra.valorBarra === 300);
  check("barra: goal = meta − 700", barra.metaBarra === 450);
  check(`barra: max = ${PUNTAJE_RANGO}`, barra.maxBarra === PUNTAJE_RANGO);
  const piso = compararConMeta(PUNTAJE_BASE, PUNTAJE_BASE);
  check("meta en el piso (700) con puntaje 700 → alcanzada y barra en 0", piso.alcanzada && piso.valorBarra === 0);
  const techo = compararConMeta(PUNTAJE_MAX, PUNTAJE_MAX);
  check(
    "meta en el techo (1300) con 1300 → alcanzada, barra llena",
    techo.alcanzada && techo.valorBarra === PUNTAJE_RANGO && techo.metaBarra === PUNTAJE_RANGO,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Máquina de estados del perfil académico (metaDe)");
{
  check("estado 1 — sin fila (null) → sin meta", metaDe(null) === null);
  check("estado 1 — undefined → sin meta", metaDe(undefined) === null);
  check("estado 2 — fila sin ningún campo de la tripleta → sin meta", metaDe({}) === null);

  const completa = metaDe({
    institucionObjetivo: "UDG",
    carreraObjetivo: "Medicina",
    metaPuntaje: 1150,
  });
  check(
    "estados 3 y 4 — tripleta completa → la meta",
    completa?.institucion === "UDG" &&
      completa.carrera === "Medicina" &&
      completa.puntaje === 1150,
  );

  // La tripleta PARCIAL es inexpresable por el producto; si aparece, el escritor está roto.
  check(
    "⭐ parcial (solo institución) LANZA, no degrada a «sin meta»",
    mensajeDe(() => metaDe({ institucionObjetivo: "UDG" })) === MSG_TRIPLETA_PARCIAL,
  );
  check(
    "⭐ parcial (institución + carrera, sin puntaje) LANZA",
    mensajeDe(() => metaDe({ institucionObjetivo: "UDG", carreraObjetivo: "Medicina" })) ===
      MSG_TRIPLETA_PARCIAL,
  );
  check(
    "⭐ parcial (solo puntaje) LANZA",
    mensajeDe(() => metaDe({ metaPuntaje: 1150 })) === MSG_TRIPLETA_PARCIAL,
  );
  check(
    "una meta de 700 NO se confunde con «ausente» (el 0 falsy no aplica, pero el piso sí existe)",
    metaDe({ institucionObjetivo: "A", carreraObjetivo: "B", metaPuntaje: PUNTAJE_BASE })
      ?.puntaje === PUNTAJE_BASE,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ ⭐ Acordeón de UN intento (LUI-28) — la MISMA función que el del instructor");
{
  const SEC_MAT = id("sec-mat");
  const SEC_LEC = id("sec-lec");
  const AREA_ALG = id("area-alg");
  const AREA_GEO = id("area-geo");
  const AREA_EXP = id("area-exp");

  const catalogo: CatalogoClasificaciones = {
    secciones: [
      { seccionId: SEC_MAT, nombre: "Pensamiento matemático", orden: 0 },
      { seccionId: SEC_LEC, nombre: "Comprensión lectora", orden: 1 },
    ],
    areas: [
      { areaId: AREA_ALG, nombre: "Álgebra", orden: 0, seccionId: SEC_MAT },
      { areaId: AREA_GEO, nombre: "Geometría", orden: 1, seccionId: SEC_MAT },
      { areaId: AREA_EXP, nombre: "Textos expositivos", orden: 0, seccionId: SEC_LEC },
    ],
  };

  // 59 % marca «A estudiar»; 60 % EXACTO no (comparación estricta, espejo del instructor).
  const intento: IntentoCrudoResultados = {
    alumnoId: id("alumna"),
    estado: "enviado",
    numeroIntento: 1,
    iniciadoEn: 1,
    enviadoEn: 2,
    puntaje: 1000,
    aciertosPorSeccion: [
      { seccionId: SEC_MAT, aciertos: 12, total: 20 },
      { seccionId: SEC_LEC, aciertos: 3, total: 10 },
    ],
    aciertosPorArea: [
      { areaId: AREA_ALG, aciertos: 59, total: 100 }, // 59 % → reforzar
      { areaId: AREA_GEO, aciertos: 6, total: 10 }, // 60 % EXACTO → NO reforzar
      { areaId: AREA_EXP, aciertos: 3, total: 10 },
    ],
  };

  const d = derivarResultadoIntento(intento, catalogo, [SEC_MAT, SEC_LEC]);
  check("no reporta «sin desglose» cuando lo hay", !d.sinDesglose);
  check("una fila por sección, en el orden DECLARADO", d.secciones.length === 2);
  check(
    "«Pensamiento matemático — 12 de 20» con su fracción",
    d.secciones[0]?.nombre === "Pensamiento matemático" &&
      d.secciones[0]?.aciertos === 12 &&
      d.secciones[0]?.total === 20 &&
      d.secciones[0]?.pct === 0.6,
  );
  check(
    "los conteos CRUDOS sobreviven (el cociente no sustituye al par)",
    d.secciones[1]?.aciertos === 3 && d.secciones[1]?.total === 10,
  );

  const mat = d.acordeon.find((s) => s.seccionId === SEC_MAT);
  const alg = mat?.areas.find((a) => a.areaId === AREA_ALG);
  const geo = mat?.areas.find((a) => a.areaId === AREA_GEO);
  check(`umbral = ${UMBRAL_REFUERZO_AREA}`, UMBRAL_REFUERZO_AREA === 0.6);
  check("⭐ 59 % SÍ se marca «A estudiar»", alg?.reforzar === true);
  check("⭐ 60 % EXACTO NO se marca (comparación estricta)", geo?.reforzar === false);
  check(
    "las áreas cuelgan de SU sección y en orden",
    mat?.areas.map((a) => a.nombre).join("|") === "Álgebra|Geometría",
  );

  // Área cuyo doc no resolvió: cubeta «Sin clasificación vigente», jamás una sección inventada.
  const AREA_FANTASMA = id("area-borrada");
  const conFantasma = derivarResultadoIntento(
    {
      ...intento,
      aciertosPorArea: [
        ...intento.aciertosPorArea!,
        { areaId: AREA_FANTASMA, aciertos: 1, total: 4 },
      ],
    },
    { ...catalogo, areas: [...catalogo.areas, { areaId: AREA_FANTASMA, nombre: null, orden: null, seccionId: null }] },
    [SEC_MAT, SEC_LEC],
  );
  const cubeta = conFantasma.acordeon.find((s) => s.seccionId === null);
  check(
    "⭐ un área sin clasificación vigente cae en la cubeta final, con nombre null",
    cubeta !== undefined && cubeta.areas.length === 1 && cubeta.areas[0]?.nombre === null,
  );
  check(
    "…y la cubeta va AL FINAL",
    conFantasma.acordeon[conFantasma.acordeon.length - 1]?.seccionId === null,
  );

  // Legado sin desglose (anterior a LUI-27): se DICE, no se pintan ceros.
  const legado = derivarResultadoIntento(
    { alumnoId: id("a"), estado: "enviado", iniciadoEn: 1, enviadoEn: 2, puntaje: 900 },
    catalogo,
    [SEC_MAT],
  );
  check(
    "⭐ intento legado SIN desglose → sinDesglose true y CERO filas fabricadas",
    legado.sinDesglose && legado.secciones.length === 0 && legado.acordeon.length === 0,
  );

  // Paridad con el instructor: el acordeón de un intento es el mismo que construye LUI-30
  // sobre ese único intento.
  const agregadoManual = {
    porSeccion: new Map([
      [SEC_MAT, { aciertos: 12, total: 20 }],
      [SEC_LEC, { aciertos: 3, total: 10 }],
    ]),
    porArea: new Map([
      [AREA_ALG, { aciertos: 59, total: 100 }],
      [AREA_GEO, { aciertos: 6, total: 10 }],
      [AREA_EXP, { aciertos: 3, total: 10 }],
    ]),
  };
  const orden = ordenDeColumnas(agregadoManual, catalogo, [SEC_MAT, SEC_LEC]);
  check(
    "⭐ MISMA salida que `construirAcordeon` directo: alumna e instructor no pueden discrepar",
    JSON.stringify(construirAcordeon(agregadoManual, catalogo, orden)) ===
      JSON.stringify(d.acordeon),
  );

  // Sección declarada que el intento no tocó: aparece con pct null, no con 0 %.
  const SEC_VACIA = id("sec-vacia");
  const conVacia = derivarResultadoIntento(
    intento,
    {
      ...catalogo,
      secciones: [...catalogo.secciones, { seccionId: SEC_VACIA, nombre: "Módulo", orden: 2 }],
    },
    [SEC_MAT, SEC_LEC, SEC_VACIA],
  );
  const vacia = conVacia.secciones.find((s) => s.seccionId === SEC_VACIA);
  check(
    "⭐ sección declarada sin reactivos → pct null (0 de 0 no es 0 %)",
    vacia?.pct === null && vacia.aciertos === 0 && vacia.total === 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
