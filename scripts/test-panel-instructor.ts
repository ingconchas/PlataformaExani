/**
 * Prueba del núcleo puro del PANEL DEL INSTRUCTOR (LUI-19). Corre con
 * `npm run test:panel-instructor` (tsx).
 *
 * Misma razón de existir que `test-asignacion.ts`: **`npx convex run` corre SIN
 * identidad**, así que todo lo que vive tras `requireStaff` daría falso verde. Lo
 * decidible sin BD se prueba aquí contra el MISMO código de producción:
 * `convex/participacion.ts` (derivación + cotas del panel), `convex/fechas.ts`
 * (formateadores nuevos) y `convex/asignacionDestino.ts` (cota de vivas).
 *
 * Archivo NUEVO a propósito: las suites existentes conservan sus conteos
 * IDÉNTICOS (regla del ciclo — lo nuevo jamás infla un oráculo ajeno).
 */
import { ConvexError } from "convex/values";
import {
  ESTADOS_INTENTO,
  MAX_GRUPOS_POR_INSTRUCTOR,
  UMBRAL_PARTICIPACION,
  derivarPanelInstructor,
  tonoParticipacion,
  validarMembresias,
  type AsignacionDelPanel,
  type EstadoParticipacion,
  type PanelQ1,
  type ParticipacionDeGrupo,
} from "../convex/participacion";
import {
  MAX_ASIGNACIONES_VIVAS_POR_GRUPO,
  validarCapacidadVivas,
} from "../convex/asignacionDestino";
import {
  fechaHoraMx,
  fechaLargaMx,
  siguienteMedianocheMx,
} from "../convex/fechas";

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

/** Ids tipados para el módulo puro (mismo truco `as never` que test-asignacion.ts). */
const id = (s: string) => s as never;

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const AHORA = 1_000_000_000_000; // instante FIJO: las pruebas puras jamás leen el reloj

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · fechaHoraMx — badge «Cierra el {fecha, hora}»");
// ─────────────────────────────────────────────────────────────────────────────

// MX = UTC−6: la medianoche MX del 12-jul-2026 es 06:00 UTC.
const MEDIANOCHE_MX = Date.UTC(2026, 6, 12, 6, 0);
check(
  "medianoche MX → «12 de julio, 00:00»",
  fechaHoraMx(MEDIANOCHE_MX) === "12 de julio, 00:00",
  fechaHoraMx(MEDIANOCHE_MX),
);
check(
  "mediodía MX → «12 de julio, 12:00»",
  fechaHoraMx(Date.UTC(2026, 6, 12, 18, 0)) === "12 de julio, 12:00",
  fechaHoraMx(Date.UTC(2026, 6, 12, 18, 0)),
);
check(
  "cambio de año: 1-ene 00:30 UTC = «31 de diciembre, 18:30» en MX",
  fechaHoraMx(Date.UTC(2027, 0, 1, 0, 30)) === "31 de diciembre, 18:30",
  fechaHoraMx(Date.UTC(2027, 0, 1, 0, 30)),
);
const NUEVE_CINCO = Date.UTC(2026, 6, 12, 15, 5); // 09:05 MX
check(
  "padding con cero: «12 de julio, 09:05»",
  fechaHoraMx(NUEVE_CINCO) === "12 de julio, 09:05",
  fechaHoraMx(NUEVE_CINCO),
);
check(
  "el minuto se TRUNCA: +59.999 s sigue en el mismo minuto",
  fechaHoraMx(NUEVE_CINCO + 59_999) === "12 de julio, 09:05",
  fechaHoraMx(NUEVE_CINCO + 59_999),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("2 · siguienteMedianocheMx — frontera del reloj del panel");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "instante cualquiera → la próxima medianoche MX",
  siguienteMedianocheMx(Date.UTC(2026, 6, 12, 18, 0)) ===
    Date.UTC(2026, 6, 13, 6, 0),
);
check(
  "medianoche EXACTA → la SIGUIENTE, no la misma",
  siguienteMedianocheMx(MEDIANOCHE_MX) === Date.UTC(2026, 6, 13, 6, 0),
);
{
  // Round-trip con fechaLargaMx cruzando el AÑO: 31-dic-2026 18:30 MX → la
  // frontera cae en el 1-ene-2027 y la fecha larga cambia EXACTAMENTE ahí.
  const ts = Date.UTC(2027, 0, 1, 0, 30);
  const frontera = siguienteMedianocheMx(ts);
  check(
    "round-trip: la fecha larga cambia exactamente en la frontera (fin de año)",
    fechaLargaMx(frontera - 1) === "Jueves 31 de diciembre de 2026" &&
      fechaLargaMx(frontera) === "Viernes 1 de enero de 2027",
    `${fechaLargaMx(frontera - 1)} | ${fechaLargaMx(frontera)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("3 · ESTADOS_INTENTO — enumeración compartida de las sondas");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "exactamente 2 estados — un TERCERO obliga a revisar las DOS sondas del panel",
  ESTADOS_INTENTO.length === 2 &&
    ESTADOS_INTENTO.includes("en_curso") &&
    ESTADOS_INTENTO.includes("enviado"),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("4 · tonoParticipacion — umbral global 60 %");
// ─────────────────────────────────────────────────────────────────────────────

check("⭐ frontera EXACTA: 3 de 5 (60 %) es VERDE", tonoParticipacion(3, 5) === "green");
check("59 de 100 (justo debajo) es naranja", tonoParticipacion(59, 100) === "orange");
check("5 de 5 verde", tonoParticipacion(5, 5) === "green");
check("0 de 2 naranja", tonoParticipacion(0, 2) === "orange");
check(
  "0 de 0 → naranja (función TOTAL, sin división entre cero)",
  tonoParticipacion(0, 0) === "orange",
);
check(
  "el umbral es la constante compartida (0.6)",
  UMBRAL_PARTICIPACION === 0.6,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("5 · validarCapacidadVivas — cota de vivas por grupo (escritor)");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "29 vivas existentes: la 30ª pasa",
  mensajeDe(() => validarCapacidadVivas("Vespertino B", 29)) === null,
);
check(
  "⭐ 30 vivas existentes: la 31ª LANZA (frontera exacta)",
  mensajeDe(() => validarCapacidadVivas("Vespertino B", 30)) !== null,
);
check(
  "el mensaje NOMBRA al grupo y la cota",
  (mensajeDe(() => validarCapacidadVivas("Vespertino B", 30)) ?? "").includes(
    "Vespertino B",
  ) &&
    (mensajeDe(() => validarCapacidadVivas("Vespertino B", 30)) ?? "").includes(
      String(MAX_ASIGNACIONES_VIVAS_POR_GRUPO),
    ),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("6 · validarMembresias — frontera por TAMAÑO FINAL");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "⭐ 99 existentes + 2 altas = 101: rechaza",
  mensajeDe(() => validarMembresias("Cristian", 99, 2, 0)) !== null,
);
check(
  "99 existentes − 1 baja + 2 altas = 100: pasa (tamaño FINAL, no +1)",
  mensajeDe(() => validarMembresias("Cristian", 99, 2, 1)) === null,
);
check(
  "100 existentes + 0 altas: pasa (las bajas puras siempre proceden)",
  mensajeDe(() => validarMembresias("Cristian", 100, 0, 3)) === null,
);
check(
  "⭐ sonda SATURADA (101) + altas: rechaza aunque las bajas 'compensen' — el " +
    "tamaño real es desconocido",
  mensajeDe(() => validarMembresias("Cristian", 101, 1, 5)) !== null,
);
check(
  "el mensaje NOMBRA al instructor y la cota",
  (mensajeDe(() => validarMembresias("Cristian", 99, 2, 0)) ?? "").includes(
    "Cristian",
  ) &&
    (mensajeDe(() => validarMembresias("Cristian", 99, 2, 0)) ?? "").includes(
      String(MAX_GRUPOS_POR_INSTRUCTOR),
    ),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("7 · derivarPanelInstructor — derivación pura del panel");
// ─────────────────────────────────────────────────────────────────────────────

const G1 = id("g1");
const G2 = id("g2");
const E1 = id("e1");
const E2 = id("e2");

function asg(
  asignacionId: string,
  examenId: never,
  titulo: string,
  grupoId: never,
  abreEn: number,
  cierraEn: number,
): AsignacionDelPanel {
  return { asignacionId: id(asignacionId), examenId, titulo, grupoId, abreEn, cierraEn };
}

function q1De(
  asignaciones: AsignacionDelPanel[],
  over: Partial<PanelQ1> = {},
): PanelQ1 {
  return {
    grupos: [
      { grupoId: G1, nombre: "Matutino A" },
      { grupoId: G2, nombre: "Sabatino C" },
    ],
    asignaciones,
    gruposOmitidos: false,
    asignacionesLegadasOmitidas: false,
    ...over,
  };
}

function partDe(
  grupoId: never,
  alumnas: { alumnoId: never; nombre: string }[],
  porAsignacion: ParticipacionDeGrupo["porAsignacion"],
  over: Partial<ParticipacionDeGrupo> = {},
): ParticipacionDeGrupo {
  return { grupoId, alumnas, porAsignacion, sondasOmitidas: false, ...over };
}

const AL1 = id("al-ana");
const AL2 = id("al-diego");
const AL9 = id("al-santiago"); // fuera del roster activo

const sinParticipaciones = new Map<never, EstadoParticipacion>();

{
  // Semiabierto [abreEn, cierraEn): en ahora === cierraEn la card NO existe…
  const d = derivarPanelInstructor(
    q1De([asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA)]),
    sinParticipaciones,
    AHORA,
  );
  check("semiabierto: ahora === cierraEn → SIN card", d.cards.length === 0);
  check("…y sin cards, examenVerTodos es null", d.examenVerTodos === null);
}
{
  // …y en ahora === abreEn SÍ existe.
  const d = derivarPanelInstructor(
    q1De([asg("a1", E1, "SG2", G1, AHORA, AHORA + DIA)]),
    sinParticipaciones,
    AHORA,
  );
  check("semiabierto: ahora === abreEn → CON card", d.cards.length === 1);
  check(
    "examenVerTodos = el examen de la card[0]",
    d.examenVerTodos === E1,
  );
}
{
  // Programada: sin card, pero su abreEn alimenta el timer.
  const d = derivarPanelInstructor(
    q1De([asg("a1", E1, "SG3", G1, AHORA + HORA, AHORA + DIA)]),
    sinParticipaciones,
    AHORA,
  );
  check("programada: SIN card", d.cards.length === 0);
  check(
    "programada: su abreEn Y cierraEn están en fronteras",
    d.fronteras.includes(AHORA + HORA) && d.fronteras.includes(AHORA + DIA),
  );
  check(
    "la próxima medianoche MX está SIEMPRE en fronteras (la fecha cruza sola)",
    d.fronteras.includes(siguienteMedianocheMx(AHORA)),
  );
}
{
  // Unión multi-asignación + dedupe + en_curso + no_iniciado + fuera de roster.
  // Dos asignaciones ABIERTAS del mismo (examen, grupo); ana enviada en AMBAS
  // (cuenta UNA vez), diego con en_curso (pendiente «En curso»), santiago enviado
  // pero FUERA del roster activo (ni X ni Y).
  const filas = [
    asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA + DIA),
    asg("a2", E1, "SG2", G1, AHORA - HORA, AHORA + 2 * DIA),
  ];
  const p = new Map<never, EstadoParticipacion>([
    [
      G1,
      partDe(
        G1,
        [
          { alumnoId: AL1, nombre: "Ana López" },
          { alumnoId: AL2, nombre: "Diego Ramírez" },
        ],
        [
          {
            asignacionId: id("a1"),
            porAlumna: [
              { alumnoId: AL1, estado: "enviado" },
              { alumnoId: AL9, estado: "enviado" },
            ],
          },
          {
            asignacionId: id("a2"),
            porAlumna: [
              { alumnoId: AL1, estado: "enviado" },
              { alumnoId: AL2, estado: "en_curso" },
            ],
          },
        ],
      ),
    ],
  ]);
  const d = derivarPanelInstructor(q1De(filas), p, AHORA);
  check("multi-asignación: UNA card por examen", d.cards.length === 1);
  check(
    "cierraProximo = min(cierraEn) de las abiertas",
    d.cards[0].cierraProximo === AHORA + DIA,
  );
  const barra = d.cards[0].barras[0];
  check(
    "dedupe por alumna: ana enviada en DOS asignaciones cuenta UNA vez (1 de 2)",
    barra !== undefined && barra.completaron === 1 && barra.total === 2,
    barra ? `${barra.completaron} de ${barra.total}` : "sin barra",
  );
  check(
    "santiago (fuera del roster activo): ni X ni Y",
    barra !== undefined && barra.total === 2 && barra.completaron === 1,
  );
  check("1 de 2 = 50 % → naranja", barra?.tono === "orange");
  check(
    "diego en_curso NO suma a completaron y ES pendiente «en_curso»",
    d.pendientes.length === 1 &&
      d.pendientes[0].alumnoId === AL2 &&
      d.pendientes[0].estado === "en_curso",
  );
  check(
    "todo limpio → datosPendientesCompletos true y sin carga",
    d.datosPendientesCompletos && !d.participacionesCargando,
  );
}
{
  // Sin intento → «no_iniciado».
  const filas = [asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA + DIA)];
  const p = new Map<never, EstadoParticipacion>([
    [
      G1,
      partDe(G1, [{ alumnoId: AL1, nombre: "Fernanda" }], [
        { asignacionId: id("a1"), porAlumna: [] },
      ]),
    ],
  ]);
  const d = derivarPanelInstructor(q1De(filas), p, AHORA);
  check(
    "alumna sin intento → pendiente «no_iniciado»",
    d.pendientes.length === 1 && d.pendientes[0].estado === "no_iniciado",
  );
  check(
    "0 de 1 → barra naranja",
    d.cards[0]?.barras[0]?.tono === "orange" &&
      d.cards[0]?.barras[0]?.completaron === 0,
  );
}
{
  // Órdenes TOTALES con empates.
  const filas = [
    // Mismo cierre para E1 y E2 → desempata el título («Álgebra» < «Zeta» en es).
    asg("a1", E2, "Zeta", G1, AHORA - DIA, AHORA + DIA),
    asg("a2", E1, "Álgebra", G1, AHORA - DIA, AHORA + DIA),
    // E1 también en G2 (barra extra, orden de barras por nombre de grupo).
    asg("a3", E1, "Álgebra", G2, AHORA - DIA, AHORA + 2 * DIA),
  ];
  const p = new Map<never, EstadoParticipacion>([
    [
      G1,
      partDe(
        G1,
        [
          { alumnoId: AL2, nombre: "Diego" },
          { alumnoId: AL1, nombre: "Ana" },
        ],
        [
          { asignacionId: id("a1"), porAlumna: [] },
          { asignacionId: id("a2"), porAlumna: [] },
        ],
      ),
    ],
    [
      G2,
      partDe(G2, [{ alumnoId: id("al-emi"), nombre: "Emiliano" }], [
        { asignacionId: id("a3"), porAlumna: [] },
      ]),
    ],
  ]);
  const d = derivarPanelInstructor(q1De(filas), p, AHORA);
  check(
    "cards: empate de cierre desempata por título (es): «Álgebra» antes de «Zeta»",
    d.cards.length === 2 &&
      d.cards[0].titulo === "Álgebra" &&
      d.cards[1].titulo === "Zeta",
  );
  check(
    "barras de la card ordenadas por nombre de grupo (Matutino A < Sabatino C)",
    d.cards[0].barras.length === 2 &&
      d.cards[0].barras[0].nombre === "Matutino A" &&
      d.cards[0].barras[1].nombre === "Sabatino C",
  );
  check(
    "examenVerTodos = el más próximo a cerrar tras el desempate (Álgebra)",
    d.examenVerTodos === E1,
  );
  const nombresPend = d.pendientes.map((f) => `${f.examenTitulo}·${f.alumnoNombre}`);
  check(
    "pendientes: examen (cierre→título) y dentro alumnas por nombre",
    nombresPend.join("|") ===
      "Álgebra·Ana|Álgebra·Diego|Álgebra·Emiliano|Zeta·Ana|Zeta·Diego",
    nombresPend.join("|"),
  );
}
{
  // Grupo AUSENTE de q1.grupos → sus filas se ignoran (nada se inventa).
  const d = derivarPanelInstructor(
    q1De([asg("a1", E1, "SG2", id("g-fantasma"), AHORA - DIA, AHORA + DIA)]),
    sinParticipaciones,
    AHORA,
  );
  check("asignación de grupo ausente en Q1 → ignorada", d.cards.length === 0);
}
{
  // ⭐ Grupo con problema Q1 («asignaciones_vivas») → EXCLUIDO por completo.
  const d = derivarPanelInstructor(
    q1De([asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA + DIA)], {
      grupos: [
        { grupoId: G1, nombre: "Matutino A", problema: "asignaciones_vivas" },
        { grupoId: G2, nombre: "Sabatino C" },
      ],
    }),
    sinParticipaciones,
    AHORA,
  );
  check(
    "⭐ problema «asignaciones_vivas»: sus filas NO producen cards",
    d.cards.length === 0,
  );
  check(
    "⭐ problema Q1 apaga datosPendientesCompletos (condición del GO)",
    !d.datosPendientesCompletos,
  );
}
{
  // ⭐ Costuras de Q2: undefined (carga) / "error" / "sin_acceso" / degradada.
  const filas = [asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA + DIA)];
  const conQ2 = (estado: EstadoParticipacion) =>
    derivarPanelInstructor(
      q1De(filas),
      new Map<never, EstadoParticipacion>([[G1, estado]]),
      AHORA,
    );

  const cargando = conQ2(undefined);
  check(
    "⭐ Q2 undefined: card SIN barra (nada fabricado) + participacionesCargando",
    cargando.cards.length === 1 &&
      cargando.cards[0].barras.length === 0 &&
      cargando.participacionesCargando &&
      !cargando.datosPendientesCompletos,
  );

  const conError = conQ2("error");
  check(
    "⭐ Q2 «error»: card sin barra, SIN carga, completos false",
    conError.cards[0].barras.length === 0 &&
      !conError.participacionesCargando &&
      !conError.datosPendientesCompletos,
  );

  const sinAcceso = conQ2("sin_acceso");
  check(
    "⭐ Q2 «sin_acceso» (null normalizado): excluido y NO es carga",
    sinAcceso.cards[0].barras.length === 0 &&
      sinAcceso.pendientes.length === 0 &&
      !sinAcceso.participacionesCargando &&
      !sinAcceso.datosPendientesCompletos,
  );

  const degradadaSondas = conQ2(
    partDe(G1, [{ alumnoId: AL1, nombre: "Ana" }], [], {
      sondasOmitidas: true,
    }),
  );
  check(
    "⭐ Q2 con sondasOmitidas: sin barra ni pendientes (jamás «0 de Y» falso)",
    degradadaSondas.cards[0].barras.length === 0 &&
      degradadaSondas.pendientes.length === 0 &&
      !degradadaSondas.datosPendientesCompletos,
  );

  const degradadaRoster = conQ2(
    partDe(G1, [], [], { problema: "roster" }),
  );
  check(
    "⭐ Q2 con problema «roster»: sin barra ni pendientes",
    degradadaRoster.cards[0].barras.length === 0 &&
      degradadaRoster.pendientes.length === 0 &&
      !degradadaRoster.datosPendientesCompletos,
  );
}
{
  // ⭐ Flags de Q1 en la completitud GLOBAL (condición 1 del GO): con las Q2
  // limpias, gruposOmitidos o asignacionesLegadasOmitidas bastan para apagarla.
  const filas = [asg("a1", E1, "SG2", G1, AHORA - DIA, AHORA + DIA)];
  const q2Limpia = new Map<never, EstadoParticipacion>([
    [
      G1,
      partDe(G1, [{ alumnoId: AL1, nombre: "Ana" }], [
        {
          asignacionId: id("a1"),
          porAlumna: [{ alumnoId: AL1, estado: "enviado" }],
        },
      ]),
    ],
  ]);
  const omitidos = derivarPanelInstructor(
    q1De(filas, { gruposOmitidos: true }),
    q2Limpia,
    AHORA,
  );
  check(
    "⭐ gruposOmitidos (Q1) apaga datosPendientesCompletos aunque las Q2 estén limpias",
    !omitidos.datosPendientesCompletos && !omitidos.participacionesCargando,
  );
  const legadas = derivarPanelInstructor(
    q1De(filas, { asignacionesLegadasOmitidas: true }),
    q2Limpia,
    AHORA,
  );
  check(
    "⭐ asignacionesLegadasOmitidas (Q1) también la apaga",
    !legadas.datosPendientesCompletos,
  );
  const feliz = derivarPanelInstructor(q1De(filas), q2Limpia, AHORA);
  check(
    "caso feliz (todo limpio, todos enviados): completos true y 0 pendientes",
    feliz.datosPendientesCompletos && feliz.pendientes.length === 0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
