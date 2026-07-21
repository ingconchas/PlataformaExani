/**
 * Prueba del núcleo puro de la ASIGNACIÓN de examen (LUI-22, Entrega A). Corre con
 * `npm run test:asignacion` (tsx).
 *
 * Misma razón de existir que `test-constructor.ts`: **`npx convex run` corre SIN
 * identidad**, así que todo lo que vive tras `requireStaff` se rechaza antes de llegar a la
 * lógica — un falso verde. Lo decidible sin BD se prueba aquí, contra el MISMO código que
 * corre en producción.
 *
 * ⚠️ El conteo de esta suite NO es un oráculo congelado: la Entrega B le suma los casos de
 * `fechas.ts` (`epochDeRelojMx` round-trip y `rangoCortoMx` por rama) — declarado en el plan.
 */
import { ConvexError } from "convex/values";
import {
  MIN_VIGENCIA_RESTANTE_MS,
  MSG_VENTANA_INVERTIDA,
  MSG_VENTANA_PASADA,
  estadoDeVentana,
  etiquetaVentana,
  validarVentana,
} from "../convex/examenEstado";
import {
  MAX_ALUMNOS_DESTINO,
  MAX_ASIGNACIONES_POR_EXAMEN,
  MAX_GRUPOS_DESTINO,
  camposDestino,
  destinoDeFila,
  validarCapacidad,
  validarDestinoCrudo,
  type Destino,
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

/** Ids tipados para el módulo puro (mismo truco `as never` que test-constructor.ts). */
const id = (s: string) => s as never;
const ids = (prefijo: string, n: number) =>
  Array.from({ length: n }, (_, i) => id(`${prefijo}${i}`));

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const AHORA = 1_000_000_000_000; // instante FIJO: las pruebas puras jamás leen el reloj
const MIN = MIN_VIGENCIA_RESTANTE_MS;

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · validarVentana — frontera de ESCRITURA de la ventana");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "ventana futura normal aceptada",
  mensajeDe(() => validarVentana(AHORA + DIA, AHORA + 2 * DIA, AHORA)) === null,
);
check(
  "inmediatamente abierta (abre ≤ ahora, cierre con vigencia) aceptada",
  mensajeDe(() => validarVentana(AHORA - HORA, AHORA + DIA, AHORA)) === null,
  "el flujo real de «aplícalo ya» es legal",
);
check(
  "⭐ degenerada (abre === cierra) rechazada con el copy de invertida",
  mensajeDe(() => validarVentana(AHORA + DIA, AHORA + DIA, AHORA)) ===
    MSG_VENTANA_INVERTIDA,
  "caza `cierra < abre` donde va `cierra <= abre`",
);
check(
  "⭐ invertida rechazada con MSG_VENTANA_INVERTIDA exacto",
  mensajeDe(() => validarVentana(AHORA + 2 * DIA, AHORA + DIA, AHORA)) ===
    MSG_VENTANA_INVERTIDA,
  "el cliente pinta EXACTAMENTE este copy en la validación en vivo",
);
check(
  "⭐ NaN en el cierre rechazado",
  mensajeDe(() => validarVentana(AHORA + DIA, NaN, AHORA)) !== null,
  "toda comparación con NaN es false: `if (cierra <= abre) throw` lo DEJA PASAR",
);
check(
  "⭐ NaN en la apertura rechazado",
  mensajeDe(() => validarVentana(NaN, AHORA + DIA, AHORA)) !== null,
);
check(
  "⭐ Infinity rechazado",
  mensajeDe(() => validarVentana(AHORA + DIA, Infinity, AHORA)) !== null,
  "Number.isInteger(Infinity) es false — el mismo guard cubre ±Infinity",
);
check(
  "⭐ fecha fraccionaria rechazada",
  mensajeDe(() => validarVentana(AHORA + DIA + 0.5, AHORA + 2 * DIA, AHORA)) !== null,
);
check(
  "⭐ ordenada pero completamente PASADA rechazada con MSG_VENTANA_PASADA",
  mensajeDe(() => validarVentana(AHORA - 2 * DIA, AHORA - DIA, AHORA)) ===
    MSG_VENTANA_PASADA,
  "caza validar solo forma y orden: la fila nacería cerrada e incancelable",
);
check(
  "⭐ borde de vigencia: cierra = ahora + MIN_VIGENCIA aceptada",
  mensajeDe(() => validarVentana(AHORA - DIA, AHORA + MIN, AHORA)) === null,
);
check(
  "⭐ borde de vigencia: cierra = ahora + MIN_VIGENCIA − 1 rechazada",
  mensajeDe(() => validarVentana(AHORA - DIA, AHORA + MIN - 1, AHORA)) ===
    MSG_VENTANA_PASADA,
  "un margen de ms es inservible: Date.now() está CONGELADO al inicio de la mutation",
);

// Coherencia escritura↔lectura: toda ventana ACEPTADA está ABIERTA en max(abre, ahora) —
// ata la frontera nueva al intervalo semiabierto de `estadoDeVentana`.
let coherente = true;
const ventanasAceptables: Array<[number, number]> = [
  [AHORA + DIA, AHORA + 2 * DIA],
  [AHORA - HORA, AHORA + DIA],
  [AHORA, AHORA + MIN],
  [AHORA - 30 * DIA, AHORA + MIN],
];
for (const [abre, cierra] of ventanasAceptables) {
  if (mensajeDe(() => validarVentana(abre, cierra, AHORA)) !== null) {
    coherente = false;
    continue;
  }
  if (estadoDeVentana(abre, cierra, Math.max(abre, AHORA)) !== "abierta") {
    coherente = false;
  }
}
check(
  "⭐ coherencia: toda ventana aceptada cumple estadoDeVentana(…, max(abre, ahora)) === «abierta»",
  coherente,
  "si cae, la frontera de escritura y el semiabierto de lectura se desalinearon",
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("2 · etiquetaVentana — la etiqueta VISIBLE del Diseño 19");
// ─────────────────────────────────────────────────────────────────────────────

check("programada → «Programada»", etiquetaVentana("programada") === "Programada");
check(
  "⭐ abierta → «En curso»",
  etiquetaVentana("abierta") === "En curso",
  "caza pasar el estado crudo al Badge («abierta» no es copy de la pantalla)",
);
check("cerrada → «Cerrada»", etiquetaVentana("cerrada") === "Cerrada");

// ─────────────────────────────────────────────────────────────────────────────
console.log("3 · validarDestinoCrudo — entrada CRUDA, cero lecturas");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "todosLosGrupos pasa la validación cruda",
  mensajeDe(() => validarDestinoCrudo({ tipo: "todosLosGrupos" })) === null,
  "no trae arreglo; su tope se aplica POST-collect en la mutation (no comprobable aquí)",
);
check(
  "rama grupos vacía rechazada",
  mensajeDe(() => validarDestinoCrudo({ tipo: "grupos", grupoIds: [] })) !== null,
);
check(
  "rama alumnos vacía rechazada",
  mensajeDe(() => validarDestinoCrudo({ tipo: "alumnos", alumnoIds: [] })) !== null,
);
check(
  "⭐ borde exacto: MAX_GRUPOS_DESTINO grupos pasa",
  mensajeDe(() =>
    validarDestinoCrudo({ tipo: "grupos", grupoIds: ids("g", MAX_GRUPOS_DESTINO) }),
  ) === null,
);
check(
  "⭐ borde exacto: MAX_GRUPOS_DESTINO + 1 grupos falla",
  mensajeDe(() =>
    validarDestinoCrudo({ tipo: "grupos", grupoIds: ids("g", MAX_GRUPOS_DESTINO + 1) }),
  ) !== null,
);
check(
  "⭐ borde exacto: MAX_ALUMNOS_DESTINO alumnos pasa",
  mensajeDe(() =>
    validarDestinoCrudo({ tipo: "alumnos", alumnoIds: ids("a", MAX_ALUMNOS_DESTINO) }),
  ) === null,
);
check(
  "⭐ borde exacto: MAX_ALUMNOS_DESTINO + 1 alumnos falla",
  mensajeDe(() =>
    validarDestinoCrudo({
      tipo: "alumnos",
      alumnoIds: ids("a", MAX_ALUMNOS_DESTINO + 1),
    }),
  ) !== null,
);
check(
  "⭐ grupos duplicados rechazados",
  mensajeDe(() =>
    validarDestinoCrudo({ tipo: "grupos", grupoIds: [id("g1"), id("g2"), id("g1")] }),
  ) !== null,
  "caza materializar dos filas idénticas en una misma operación",
);
check(
  "⭐ alumnos duplicados rechazados",
  mensajeDe(() =>
    validarDestinoCrudo({ tipo: "alumnos", alumnoIds: [id("a1"), id("a1")] }),
  ) !== null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("4 · camposDestino / destinoDeFila — el invariante XOR en ambas fronteras");
// ─────────────────────────────────────────────────────────────────────────────

const fragmentoGrupo = camposDestino({ grupoId: id("g1") });
check(
  "⭐ fragmento de grupo tiene EXACTAMENTE una clave",
  Object.keys(fragmentoGrupo).length === 1 && "grupoId" in fragmentoGrupo,
  "el escritor solo puede esparcir; dos claves = fila malformada representable",
);
const fragmentoAlumno = camposDestino({ alumnoId: id("a1") });
check(
  "⭐ fragmento de alumno tiene EXACTAMENTE una clave",
  Object.keys(fragmentoAlumno).length === 1 && "alumnoId" in fragmentoAlumno,
);
check(
  "⭐ entrada con AMBOS campos LANZA (jamás elige uno en silencio)",
  mensajeDe(() =>
    camposDestino({ grupoId: id("g1"), alumnoId: id("a1") }),
  ) !== null,
  "TS acepta un literal con ambas claves contra la unión; el runtime es la frontera real",
);
check(
  "entrada sin ningún campo LANZA",
  mensajeDe(() => camposDestino({} as never)) !== null,
);

const filaGrupo = destinoDeFila({ grupoId: id("g1") });
check(
  "fila legado {grupoId} normaliza a la rama grupo con SU id",
  filaGrupo.tipo === "grupo" && filaGrupo.grupoId === id("g1"),
);
const filaAlumno = destinoDeFila({ alumnoId: id("a1") });
check(
  "fila {alumnoId} normaliza a la rama alumno con SU id",
  filaAlumno.tipo === "alumno" && filaAlumno.alumnoId === id("a1"),
);
check(
  "⭐ fila con AMBOS campos lanza",
  mensajeDe(() => destinoDeFila({ grupoId: id("g1"), alumnoId: id("a1") })) !== null,
  "jamás se interpreta una fila malformada en silencio",
);
check(
  "⭐ fila SIN ningún campo lanza",
  mensajeDe(() => destinoDeFila({})) !== null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("5 · validarCapacidad — la política del acumulado, en sus bordes");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "⭐ borde exacto: 599 existentes + 1 nueva pasa",
  mensajeDe(() => validarCapacidad(MAX_ASIGNACIONES_POR_EXAMEN - 1, 1)) === null,
);
check(
  "⭐ borde exacto: 599 existentes + 2 nuevas falla",
  mensajeDe(() => validarCapacidad(MAX_ASIGNACIONES_POR_EXAMEN - 1, 2)) !== null,
);
check(
  "borde exacto: 600 existentes + 1 nueva falla",
  mensajeDe(() => validarCapacidad(MAX_ASIGNACIONES_POR_EXAMEN, 1)) !== null,
);
check(
  "el mensaje nombra el techo (el cliente y el reporte lo citan)",
  (mensajeDe(() => validarCapacidad(MAX_ASIGNACIONES_POR_EXAMEN, 1)) ?? "").includes(
    String(MAX_ASIGNACIONES_POR_EXAMEN),
  ),
);
check(
  "la operación individual MÁXIMA no agota un examen vacío",
  mensajeDe(() => validarCapacidad(0, MAX_ALUMNOS_DESTINO)) === null,
);
check(
  "la operación por grupos MÁXIMA no agota un examen vacío",
  mensajeDe(() => validarCapacidad(0, MAX_GRUPOS_DESTINO)) === null,
);
check(
  "⭐ COHERENCIA entre constantes: la op máxima consume ≤ 5% de la capacidad",
  Math.max(MAX_ALUMNOS_DESTINO, MAX_GRUPOS_DESTINO) <=
    MAX_ASIGNACIONES_POR_EXAMEN / 20,
  "caza reintroducir el conflicto del plan v5 (una op que retira el examen) al mover UNA constante",
);

// Tipado: `Destino` es la unión discriminada de args — el compilador es parte de la prueba.
const _destinos: Destino[] = [
  { tipo: "todosLosGrupos" },
  { tipo: "grupos", grupoIds: [id("g1")] },
  { tipo: "alumnos", alumnoIds: [id("a1")] },
];
void _destinos;

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
