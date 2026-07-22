/**
 * Prueba del núcleo puro del SIMULACRO (LUI-26 · LUI-27 · LUI-104). Corre con
 * `npm run test:simulacro` (tsx).
 *
 * Misma razón de existir que `test-panel-instructor.ts`: **`npx convex run` corre SIN
 * identidad**, así que todo lo que vive tras `requireAlumna` daría falso verde. Lo
 * decidible sin BD se prueba aquí contra el MISMO código de producción —
 * `convex/simulacro.ts` (puntaje, tiempo, techos, desglose y la regla del primer
 * intento) y la cota de vivas por alumna de `convex/asignacionDestino.ts`.
 *
 * Archivo NUEVO: las suites existentes conservan sus conteos IDÉNTICOS.
 */
import { ConvexError } from "convex/values";
import {
  ALERTA_TIEMPO_MS,
  MAX_INTENTOS_POR_SERIE,
  PUNTAJE_BASE,
  PUNTAJE_MAX,
  calcularPuntaje,
  dentroDeTiempo,
  desglosePorClasificacion,
  formatearHms,
  limiteDe,
  normalizarFormaCierre,
  promedioDeAsignacion,
  rachasDeSecciones,
  redondearPuntaje,
  resumenConfirmacion,
  validarTechoSerie,
  type IntentoAnalitico,
} from "../convex/simulacro";
import {
  MAX_ASIGNACIONES_VIVAS_POR_ALUMNA,
  validarCapacidadVivasAlumna,
} from "../convex/asignacionDestino";

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
function mensajeDe(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ConvexError ? String(e.data) : `error inesperado: ${e}`;
  }
}

/** Ids tipados para los módulos puros (mismo truco `as never` que las otras suites). */
const id = (s: string) => s as never;

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Puntaje (LUI-27)");
{
  check("0 aciertos de 90 → 700 (piso de la escala)", calcularPuntaje(0, 90) === PUNTAJE_BASE);
  check("90 de 90 → 1300 (techo)", calcularPuntaje(90, 90) === PUNTAJE_MAX);
  check("45 de 90 → 1000 (mitad exacta)", calcularPuntaje(45, 90) === 1000);
  check(
    "1 de 2 → 1000 (sin responder cuenta como incorrecta: solo suman los aciertos)",
    calcularPuntaje(1, 2) === 1000,
  );
  // 600/90 = 6.666… — el valor almacenado NO es entero y eso es el contrato.
  const inexacto = calcularPuntaje(1, 90);
  check(
    "⭐ el puntaje se calcula EXACTO, sin redondear (700 + 600/90)",
    inexacto === PUNTAJE_BASE + 600 / 90 && !Number.isInteger(inexacto),
    String(inexacto),
  );
  check(
    "⭐ redondearPuntaje es el ÚNICO redondeo (707 para el caso de arriba)",
    redondearPuntaje(inexacto) === 707,
  );
  check(
    "⭐ N = 0 LANZA (un puntaje sobre cero preguntas no existe)",
    mensajeDe(() => calcularPuntaje(0, 0))?.includes("sin reactivos") === true,
  );
  check(
    "N negativo o no finito también lanza",
    mensajeDe(() => calcularPuntaje(1, Number.NaN)) !== null,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Límite del intento (LUI-26 · decisión de producto: recorte al cierre)");
{
  const inicio = 1_700_000_000_000;
  check(
    "sin ventana (intento directo) → iniciadoEn + duración",
    limiteDe(inicio, 180) === inicio + 3 * HORA,
  );
  check(
    "null explícito = sin ventana",
    limiteDe(inicio, 30, null) === inicio + 30 * MINUTO,
  );
  check(
    "ventana lejana no recorta",
    limiteDe(inicio, 60, inicio + 10 * HORA) === inicio + HORA,
  );
  check(
    "⭐ ventana cercana RECORTA: 3 h de examen a 20 min del cierre → 20 min",
    limiteDe(inicio, 180, inicio + 20 * MINUTO) === inicio + 20 * MINUTO,
  );
  check(
    "empate exacto (duración == cierre) → el mismo instante",
    limiteDe(inicio, 60, inicio + HORA) === inicio + HORA,
  );

  const limite = inicio + HORA;
  check("un instante antes del límite: vigente", dentroDeTiempo(limite - 1, limite));
  check(
    "⭐ EN el límite: VENCIDO (semiabierto, como estadoDeVentana)",
    !dentroDeTiempo(limite, limite),
  );
  check("después del límite: vencido", !dentroDeTiempo(limite + 1, limite));
  check("ALERTA_TIEMPO_MS son los 5 minutos del diseño", ALERTA_TIEMPO_MS === 5 * MINUTO);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Cuenta regresiva");
{
  check("una hora justa", formatearHms(HORA) === "01:00:00");
  check("3 h 5 min 9 s", formatearHms(3 * HORA + 5 * MINUTO + 9_000) === "03:05:09");
  check(
    "⭐ redondeo hacia ARRIBA: a 1 ms del final aún se lee 00:00:01",
    formatearHms(1) === "00:00:01",
  );
  check("cero exacto → 00:00:00", formatearHms(0) === "00:00:00");
  check("⭐ negativo → 00:00:00, jamás «-1»", formatearHms(-5_000) === "00:00:00");
  check("más de 9 horas no se corta", formatearHms(12 * HORA) === "12:00:00");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Forma de cierre (LUI-27)");
{
  check("ausente = manual (legado)", normalizarFormaCierre(undefined) === "manual");
  check("manual se conserva", normalizarFormaCierre("manual") === "manual");
  check(
    "tiempo_agotado se conserva",
    normalizarFormaCierre("tiempo_agotado") === "tiempo_agotado",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Techos de escritura (LUI-104 · LUI-25)");
{
  check(
    "28 enviados: el 29º pasa",
    mensajeDe(() => validarTechoSerie("SG2", 28)) === null,
  );
  check(
    "⭐ 29 enviados: el 30º TODAVÍA pasa (frontera exacta)",
    mensajeDe(() => validarTechoSerie("SG2", MAX_INTENTOS_POR_SERIE - 1)) === null,
  );
  const lleno = mensajeDe(() => validarTechoSerie("SG2", MAX_INTENTOS_POR_SERIE));
  check(
    "⭐ 30 enviados: el 31º se RECHAZA (>=, no >: el off-by-one del plan v2)",
    lleno !== null,
  );
  check("el mensaje nombra el examen y el techo", lleno?.includes("«SG2»") === true && lleno.includes("30"));

  check(
    "vivas por alumna: 29 existentes, la 30ª pasa",
    mensajeDe(() =>
      validarCapacidadVivasAlumna("Fernanda", MAX_ASIGNACIONES_VIVAS_POR_ALUMNA - 1),
    ) === null,
  );
  const llenaAlumna = mensajeDe(() =>
    validarCapacidadVivasAlumna("Fernanda", MAX_ASIGNACIONES_VIVAS_POR_ALUMNA),
  );
  check(
    "⭐ vivas por alumna: 30 existentes, la 31ª se rechaza nombrando a la alumna",
    llenaAlumna?.includes("«Fernanda»") === true,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Rachas de sección (mapa y encabezado del player)");
{
  const a = id("s_a");
  const b = id("s_b");
  const r1 = rachasDeSecciones([
    { seccionId: a },
    { seccionId: a },
    { seccionId: b },
  ]);
  check(
    "dos tramos contiguos con rangos 1-based",
    r1.length === 2 &&
      r1[0].desde === 1 &&
      r1[0].hasta === 2 &&
      r1[1].desde === 3 &&
      r1[1].hasta === 3,
  );
  const r2 = rachasDeSecciones([
    { seccionId: a },
    { seccionId: b },
    { seccionId: a },
  ]);
  check(
    "⭐ sección repetida NO contigua → DOS rachas (describe lo que hay, no lo declarado)",
    r2.length === 3,
  );
  const r3 = rachasDeSecciones([
    { seccionId: a },
    { seccionId: null },
    { seccionId: a },
  ]);
  check(
    "⭐ una pregunta sin sección CORTA la racha (jamás hereda la anterior)",
    r3.length === 3 && r3[1].seccionId === null,
  );
  check("examen vacío → sin rachas", rachasDeSecciones([]).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Confirmación de envío (copys del Diseño 25)");
{
  check(
    "plural: el copy exacto del mock",
    resumenConfirmacion(87, 90) ===
      "87 de 90 contestadas. Las 3 sin responder cuentan como incorrectas.",
  );
  check(
    "⭐ singular: frase propia, no «Las 1 …»",
    resumenConfirmacion(89, 90) ===
      "89 de 90 contestadas. La que falta cuenta como incorrecta.",
  );
  check(
    "todas contestadas: sin amenaza de incorrectas",
    resumenConfirmacion(90, 90) === "90 de 90 contestadas. Ya respondiste todas.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Desglose del cierre (contrato de datos de LUI-27)");
{
  const s1 = id("sec1");
  const s2 = id("sec2");
  const a1 = id("area1");
  const a2 = id("area2");
  const a3 = id("area3");
  const reactivos = [
    { id: id("r1"), seccionId: s1, areaId: a1 },
    { id: id("r2"), seccionId: s1, areaId: a2 },
    { id: id("r3"), seccionId: s2, areaId: a3 },
    { id: id("r4"), seccionId: s2, areaId: a3 },
  ];
  const d = desglosePorClasificacion(reactivos, new Set(["r1", "r3"]));
  check("una entrada por sección distinta", d.porSeccion.length === 2);
  check(
    "conteos por sección correctos",
    d.porSeccion[0].aciertos === 1 &&
      d.porSeccion[0].total === 2 &&
      d.porSeccion[1].aciertos === 1 &&
      d.porSeccion[1].total === 2,
  );
  check(
    "⭐ Σ totales por sección = N (cada reactivo cae en exactamente una)",
    d.porSeccion.reduce((s, x) => s + x.total, 0) === reactivos.length,
  );
  check(
    "⭐ Σ totales por área = N",
    d.porArea.reduce((s, x) => s + x.total, 0) === reactivos.length,
  );
  check(
    "área con dos preguntas y un acierto",
    d.porArea.find((x) => x.areaId === a3)?.aciertos === 1,
  );
  const cero = desglosePorClasificacion(reactivos, new Set());
  check(
    "sin respuestas: aciertos 0 pero totales intactos",
    cero.porSeccion.every((x) => x.aciertos === 0) &&
      cero.porSeccion.reduce((s, x) => s + x.total, 0) === 4,
  );
  check(
    "⭐ un fantasma no entra (no está en la lista de vivos)",
    desglosePorClasificacion(reactivos.slice(0, 2), new Set(["r1"])).porSeccion
      .length === 1,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Regla del PRIMER INTENTO (LUI-104) y honestidad del corte");
{
  const ana = id("u_ana");
  const fer = id("u_fer");
  const dia: IntentoAnalitico[] = [
    { alumnoId: ana, estado: "enviado", iniciadoEn: 100, puntaje: 900 },
    { alumnoId: fer, estado: "enviado", iniciadoEn: 200, puntaje: 1100 },
  ];
  const base = promedioDeAsignacion({ diagnosticos: dia, legado: [], desbordado: false });
  check("promedio de los diagnósticos", base.valor === 1000 && !base.incompleto);

  check(
    "⭐ un repaso con mejor puntaje NO entra (ni siquiera llega: el rango lo excluye)",
    promedioDeAsignacion({
      diagnosticos: dia,
      legado: [],
      desbordado: false,
    }).valor === 1000,
  );
  check(
    "en curso o sin puntaje no cuentan",
    promedioDeAsignacion({
      diagnosticos: [
        ...dia,
        { alumnoId: id("u_x"), estado: "en_curso", iniciadoEn: 50 },
        { alumnoId: id("u_y"), estado: "enviado", iniciadoEn: 60 },
      ],
      legado: [],
      desbordado: false,
    }).valor === 1000,
  );
  check(
    "sin calificados → null (no 0: imposible en la escala) y NO incompleto",
    (() => {
      const r = promedioDeAsignacion({
        diagnosticos: [],
        legado: [],
        desbordado: false,
      });
      return r.valor === null && !r.incompleto;
    })(),
  );

  // Legado: el proxy histórico (el `iniciadoEn` más antiguo por alumna).
  const legado: IntentoAnalitico[] = [
    { alumnoId: ana, estado: "enviado", iniciadoEn: 10, puntaje: 800 },
    { alumnoId: ana, estado: "enviado", iniciadoEn: 20, puntaje: 950 },
  ];
  check(
    "⭐ legado sin numerar: gana el más antiguo (proxy de LUI-9, intacto)",
    promedioDeAsignacion({ diagnosticos: [], legado, desbordado: false }).valor === 800,
  );
  check(
    "⭐ si la alumna YA tiene diagnóstico numerado, su legado se ignora",
    promedioDeAsignacion({
      diagnosticos: [dia[0]],
      legado,
      desbordado: false,
    }).valor === 900,
  );

  const desbordado = promedioDeAsignacion({
    diagnosticos: dia,
    legado: [],
    desbordado: true,
  });
  check(
    "⭐⭐ con centinela NO se promedia el prefijo: valor null e incompleto true",
    desbordado.valor === null && desbordado.incompleto,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
