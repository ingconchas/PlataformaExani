/**
 * Prueba del núcleo puro de «MIS EXÁMENES» (LUI-25). Corre con
 * `npm run test:mis-examenes` (tsx).
 *
 * Prueba la DERIVACIÓN que el cliente ejecuta con su reloj anclado
 * (`convex/misExamenes.ts`): clasificación, urgencia, órdenes totales y los estados que
 * apagan el vacío exitoso. El servidor no la ejecuta —entrega crudo—, así que este es el
 * único lugar donde puede probarse sin montar la pantalla.
 *
 * Archivo NUEVO: las suites existentes conservan sus conteos IDÉNTICOS.
 */
import {
  derivarMisExamenes,
  esCierraHoy,
  etiquetaResultado,
  type FilaCruda,
  type MisExamenesCrudo,
} from "../convex/misExamenes";
import { siguienteMedianocheMx } from "../convex/fechas";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const id = (s: string) => s as never;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Mediodía MX del 12 de julio de 2026 (instante fijo: nada depende del reloj real). */
const AHORA = Date.UTC(2026, 6, 12, 18, 0, 0);

function fila({
  asignacionId,
  ...over
}: Partial<Omit<FilaCruda, "asignacionId">> & {
  asignacionId: string;
}): FilaCruda {
  return {
    asignacionId: id(asignacionId),
    examenId: id("ex_" + asignacionId),
    titulo: "Simulacro",
    numReactivos: 90,
    duracionMin: 180,
    tipoEtiqueta: "Simulacro general",
    esModulo: false,
    abreEn: AHORA - DIA,
    cierraEn: AHORA + DIA,
    enviados: [],
    enCurso: null,
    ...over,
  };
}

function crudo(filas: FilaCruda[], flags: Partial<MisExamenesCrudo> = {}) {
  return {
    filas,
    historialGrupoIncompleto: false,
    directasIncompletas: false,
    asignacionesLegadasOmitidas: false,
    ...flags,
  };
}

const enviado = ({
  intentoId = "1",
  ...over
}: Partial<Omit<FilaCruda["enviados"][number], "intentoId">> & {
  intentoId?: string;
} = {}) => ({
  intentoId: id(intentoId),
  enviadoEn: AHORA - 2 * DIA,
  puntaje: 1082.4,
  numeroIntento: 1,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Clasificación");
{
  const d = derivarMisExamenes(
    crudo([
      fila({ asignacionId: "abierta_sin_intento", titulo: "Pendiente" }),
      fila({
        asignacionId: "abierta_con_enviado",
        titulo: "Completado",
        enviados: [enviado()],
      }),
      fila({
        asignacionId: "cerrada_sin_intento",
        titulo: "Vencido",
        abreEn: AHORA - 10 * DIA,
        cierraEn: AHORA - DIA,
      }),
      fila({
        asignacionId: "futura",
        titulo: "Futura",
        abreEn: AHORA + 7 * DIA,
        cierraEn: AHORA + 28 * DIA,
      }),
    ]),
    AHORA,
  );
  check("abierta sin envío → pendiente", d.pendientes.length === 1);
  check("con envío → completado", d.completados.length === 1);
  check("cerrada sin envío → vencido", d.vencidos.length === 1);
  check("⭐ futura NO se lista en ninguna de las tres", d.hayFuturas && d.pendientes.length === 1);
  check(
    "⭐ pero su apertura SÍ es frontera (la card aparecerá sola)",
    d.fronteras.includes(AHORA + 7 * DIA),
  );
  check(
    "la próxima medianoche MX siempre es frontera (urgencia y fecha cruzan solas)",
    d.fronteras.includes(siguienteMedianocheMx(AHORA)),
  );
  check(
    "un cierre YA pasado no entra a fronteras (no hay nada que esperar)",
    !d.fronteras.includes(AHORA - DIA),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Intento vivo y repasos (M2 de la auditoría)");
{
  const soloEnCurso = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "a",
        enCurso: { intentoId: id("i_vivo"), iniciadoEn: AHORA - 10 * MINUTO },
      }),
    ]),
    AHORA,
  );
  check(
    "pendiente con intento vivo ofrece «Continuar»",
    soloEnCurso.pendientes[0].enCurso === "i_vivo",
  );

  const conRepasoVivo = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "a",
        enviados: [enviado()],
        enCurso: { intentoId: id("i_repaso"), iniciadoEn: AHORA - 5 * MINUTO },
      }),
    ]),
    AHORA,
  );
  check(
    "⭐ completado + intento vivo → «Repaso en curso» con su intentoId (el reloj corre: no se esconde)",
    conRepasoVivo.completados[0].repasoEnCurso === "i_repaso",
  );
  check(
    "⭐ sin intento vivo, repasoEnCurso es null (la acción «Repetir» vuelve a estar disponible)",
    derivarMisExamenes(crudo([fila({ asignacionId: "a", enviados: [enviado()] })]), AHORA)
      .completados[0].repasoEnCurso === null,
  );
  check(
    "⭐ con la ventana CERRADA, un intento vivo no se ofrece (ya venció por el recorte del límite)",
    derivarMisExamenes(
      crudo([
        fila({
          asignacionId: "a",
          abreEn: AHORA - 10 * DIA,
          cierraEn: AHORA - DIA,
          enviados: [enviado()],
          enCurso: { intentoId: id("i_zombi"), iniciadoEn: AHORA - 9 * DIA },
        }),
      ]),
      AHORA,
    ).completados[0].repasoEnCurso === null,
  );
  check(
    "⭐ en curso NUNCA enviado con ventana cerrada → VENCIDO, no accionable",
    (() => {
      const d = derivarMisExamenes(
        crudo([
          fila({
            asignacionId: "a",
            abreEn: AHORA - 10 * DIA,
            cierraEn: AHORA - DIA,
            enCurso: { intentoId: id("i_zombi"), iniciadoEn: AHORA - 9 * DIA },
          }),
        ]),
        AHORA,
      );
      return d.vencidos.length === 1 && d.pendientes.length === 0;
    })(),
  );

  const dosEnviados = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "a",
        enviados: [
          enviado({ intentoId: "diag", puntaje: 900, enviadoEn: AHORA - 5 * DIA }),
          enviado({
            intentoId: "rep",
            puntaje: 1250,
            numeroIntento: 2,
            enviadoEn: AHORA - DIA,
          }),
        ],
      }),
    ]),
    AHORA,
  );
  check("dos envíos → badge de repaso", dosEnviados.completados[0].tieneRepaso);
  check(
    "⭐⭐ el puntaje y la fecha son los del DIAGNÓSTICO, no los del mejor repaso",
    dosEnviados.completados[0].puntaje === 900 &&
      dosEnviados.completados[0].contestadoEn === AHORA - 5 * DIA &&
      dosEnviados.completados[0].intentoId === "diag",
  );
  check(
    "el puntaje se redondea para la card (1082.4 → 1082)",
    derivarMisExamenes(crudo([fila({ asignacionId: "a", enviados: [enviado()] })]), AHORA)
      .completados[0].puntaje === 1082,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Urgencia «¡Cierra hoy!» (frontera de medianoche MX)");
{
  const medianoche = siguienteMedianocheMx(AHORA);
  check("cierre dentro del día → urgente", esCierraHoy(medianoche - HORA, AHORA));
  check(
    "⭐ un milisegundo antes de la medianoche todavía es HOY",
    esCierraHoy(medianoche - 1, AHORA),
  );
  check(
    "⭐ EN la medianoche exacta ya NO es hoy (el intervalo es semiabierto)",
    !esCierraHoy(medianoche, AHORA),
  );
  check("mañana no es urgente", !esCierraHoy(medianoche + HORA, AHORA));
  check("un cierre ya pasado no es urgente: es historia", !esCierraHoy(AHORA - 1, AHORA));
  check(
    "la card lo refleja",
    derivarMisExamenes(
      crudo([fila({ asignacionId: "a", cierraEn: medianoche - HORA })]),
      AHORA,
    ).pendientes[0].urgente,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Órdenes TOTALES");
{
  const d = derivarMisExamenes(
    crudo([
      fila({ asignacionId: "c", titulo: "Zeta", cierraEn: AHORA + 3 * DIA }),
      fila({ asignacionId: "a", titulo: "Beta", cierraEn: AHORA + DIA }),
      fila({ asignacionId: "b", titulo: "Alfa", cierraEn: AHORA + DIA }),
    ]),
    AHORA,
  );
  check(
    "pendientes: cierre ascendente y, a igualdad, por título",
    d.pendientes.map((p) => p.titulo).join(",") === "Alfa,Beta,Zeta",
  );

  const empate = derivarMisExamenes(
    crudo([
      fila({ asignacionId: "z", titulo: "Igual", cierraEn: AHORA + DIA }),
      fila({ asignacionId: "y", titulo: "Igual", cierraEn: AHORA + DIA }),
    ]),
    AHORA,
  );
  check(
    "⭐ empate total: desempata el id (orden ESTABLE entre renders)",
    empate.pendientes.map((p) => p.asignacionId).join(",") === "y,z",
  );

  const comp = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "cerrado",
        titulo: "Cerrado",
        abreEn: AHORA - 30 * DIA,
        cierraEn: AHORA - DIA,
        enviados: [enviado({ enviadoEn: AHORA - 2 * DIA })],
      }),
      fila({
        asignacionId: "abierto",
        titulo: "Abierto",
        enviados: [enviado({ enviadoEn: AHORA - 10 * DIA })],
      }),
    ]),
    AHORA,
  );
  check(
    "completados: los de ventana ABIERTA primero (son los accionables), pese a ser más antiguos",
    comp.completados.map((c) => c.titulo).join(",") === "Abierto,Cerrado",
  );

  const venc = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "viejo",
        titulo: "Viejo",
        abreEn: AHORA - 100 * DIA,
        cierraEn: AHORA - 50 * DIA,
      }),
      fila({
        asignacionId: "reciente",
        titulo: "Reciente",
        abreEn: AHORA - 20 * DIA,
        cierraEn: AHORA - DIA,
      }),
    ]),
    AHORA,
  );
  check(
    "vencidos: el más reciente primero",
    venc.vencidos.map((v) => v.titulo).join(",") === "Reciente,Viejo",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Estados que apagan el vacío EXITOSO");
{
  const vacio = derivarMisExamenes(crudo([]), AHORA);
  check(
    "sin nada: las tres listas vacías, sin futuras y sin flags",
    vacio.pendientes.length === 0 &&
      vacio.completados.length === 0 &&
      vacio.vencidos.length === 0 &&
      !vacio.hayFuturas &&
      !vacio.incompleto,
  );

  const soloFuturas = derivarMisExamenes(
    crudo([
      fila({
        asignacionId: "f",
        abreEn: AHORA + 7 * DIA,
        cierraEn: AHORA + 28 * DIA,
      }),
    ]),
    AHORA,
  );
  check(
    "⭐⭐ SOLO futuras: listas vacías pero `hayFuturas` — «no tienes simulacros asignados» sería FALSO",
    soloFuturas.pendientes.length === 0 &&
      soloFuturas.completados.length === 0 &&
      soloFuturas.vencidos.length === 0 &&
      soloFuturas.hayFuturas,
  );

  for (const flag of [
    "historialGrupoIncompleto",
    "directasIncompletas",
    "asignacionesLegadasOmitidas",
  ] as const) {
    check(
      `⭐ ${flag} enciende \`incompleto\` (la pantalla lo dice y no finge lista completa)`,
      derivarMisExamenes(crudo([], { [flag]: true }), AHORA).incompleto,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▸ Etiqueta del resultado (LUI-104)");
{
  check(
    "diagnóstico: sin sufijo",
    etiquetaResultado("Simulacro General 2", 1) === "Simulacro General 2",
  );
  check(
    "repaso: «— repaso N»",
    etiquetaResultado("Simulacro General 2", 2) === "Simulacro General 2 — repaso 2",
  );
  check(
    "legado sin número: sin sufijo (no inventa un «repaso null»)",
    etiquetaResultado("Simulacro General 2", null) === "Simulacro General 2",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
