/**
 * Prueba del bloque de preguntas de una lectura (LUI-17). Corre con `npm run test:bloque`
 * (tsx → sin depender del type-stripping de Node).
 *
 * Cubre lo que NINGUNA prueba de integración alcanza, por la razón que ya documentan
 * `test-material.ts` y `convex/bloque.ts`: todo está tras `requireStaff`, así que
 * `npx convex run` sin identidad se rechaza antes de llegar a las guardas, y el formulario
 * nunca envía las combinaciones ilegales. Aquí se llama el MISMO código que corre producción.
 *
 * Los helpers de bloque se partieron en núcleo PURO + envoltorio con `ctx` justamente para
 * que estos casos —orden corrupto, id fantasma, lectura fantasma— sean alcanzables.
 */
import {
  MAX_PREGUNTAS,
  MAX_TITULO,
  MIN_PREGUNTAS,
  expandirBloquesPuro,
  lecturaPublicable,
  reordenar,
  validarBloquesCompletosPuro,
  validarTextoBase,
  validarTitulo,
  type BloqueDeLectura,
  type PreguntaOrdenable,
  type ReactivoDeExamen,
} from "../convex/bloque";
import { MAX_HTML } from "../convex/sanitizar";
import { resolverLectura, esDeBloque, lecturaParaBloqueo, lecturaParaEnlace } from "../convex/lecturaCompat";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

/** Devuelve el mensaje del `ConvexError`, o null si NO lanzó. */
function rechazo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    check(`payload string: ${String(data).slice(0, 40)}`, typeof data === "string");
    return String(data);
  }
}

const p = (id: string, orden: number, creado = 0): PreguntaOrdenable => ({
  _id: id,
  _creationTime: creado,
  orden,
});

console.log("1 · validarTitulo");
check("título normal pasa", validarTitulo("  El calentamiento global  ") === "El calentamiento global");
check("vacío se rechaza", rechazo(() => validarTitulo("")) !== null);
check("solo espacios se rechaza", rechazo(() => validarTitulo("    ")) !== null);
const ZWSP = String.fromCodePoint(0x200b);
const WJ = String.fromCodePoint(0x2060);
const VS16 = String.fromCodePoint(0xfe0f); // Default_Ignorable que NO es Cf
check(
  "solo INVISIBLES se rechaza",
  rechazo(() => validarTitulo(`${ZWSP}${WJ}${VS16}`)) !== null,
);
check(
  `más de ${MAX_TITULO} caracteres se rechaza`,
  rechazo(() => validarTitulo("a".repeat(MAX_TITULO + 1))) !== null,
);
// ⭐ Lo almacenado NUNCA es la salida de `aTextoPlano`, que desescapa entidades.
check(
  "⭐ un título con entidades se guarda TAL CUAL (no desescapado)",
  validarTitulo("3 &lt;b&gt; 4") === "3 &lt;b&gt; 4",
  validarTitulo("3 &lt;b&gt; 4"),
);

console.log("2 · validarTextoBase");
check("texto normal se sanea", validarTextoBase("<p>Hola <strong>mundo</strong></p>") === "<p>Hola <strong>mundo</strong></p>");
check(
  `más de MAX_HTML (${MAX_HTML}) LANZA, no trunca`,
  rechazo(() => validarTextoBase("a".repeat(MAX_HTML + 1))) !== null,
);
check("`<p></p>` se rechaza", rechazo(() => validarTextoBase("<p></p>")) !== null);
const saneado = validarTextoBase("<script>alert(1)</script>x");
check("`<script>` queda escapado", saneado.includes("&lt;script&gt;") && !saneado.includes("<script"));

console.log("3 · ⭐ reordenar con orden persistido NO denso [0, 0, 5]");
// Vector discriminante: empate + hueco. Un swap ingenuo dejaría los valores tal cual y el
// orden visible pasaría a depender del desempate; renumerar sin desempate estable daría un
// resultado intermitente ante el empate.
const corrupto = [p("A", 0, 10), p("B", 0, 20), p("C", 5, 30)];
const bajado = reordenar(corrupto, "A", "abajo");
check("(a) la permutación es B, A, C", JSON.stringify(bajado?.map((x) => x._id)) === '["B","A","C"]', JSON.stringify(bajado));
check(
  "(b) ⭐ lo persistido es DENSO 0,1,2 (no [0,0,5])",
  JSON.stringify(bajado?.map((x) => x.orden)) === "[0,1,2]",
  JSON.stringify(bajado),
);
check("subir el primero es no-op", reordenar(corrupto, "A", "arriba") === null);
check("bajar el último es no-op", reordenar(corrupto, "C", "abajo") === null);
check("id ausente es no-op", reordenar(corrupto, "ZZ", "abajo") === null);
check("bloque de 1 es no-op", reordenar([p("A", 0)], "A", "abajo") === null);
check(
  "el empate se desempata de forma DETERMINISTA (por creación)",
  JSON.stringify(reordenar(corrupto, "C", "arriba")?.map((x) => x._id)) === '["A","C","B"]',
);

console.log("4 · lecturaPublicable");
const base = { lecturaActiva: true, clasificacionDisponible: true };
check("0 preguntas → no", !lecturaPublicable({ ...base, preguntas: 0, activas: 0 }));
check(`${MIN_PREGUNTAS - 1} pregunta → no`, !lecturaPublicable({ ...base, preguntas: 1, activas: 1 }));
check(`${MIN_PREGUNTAS} preguntas → sí`, lecturaPublicable({ ...base, preguntas: 2, activas: 2 }));
check(`${MAX_PREGUNTAS} preguntas → sí`, lecturaPublicable({ ...base, preguntas: 5, activas: 5 }));
check(`${MAX_PREGUNTAS + 1} preguntas → no`, !lecturaPublicable({ ...base, preguntas: 6, activas: 6 }));
check("una pregunta inactiva → no", !lecturaPublicable({ ...base, preguntas: 3, activas: 2 }));
check("lectura inactiva → no", !lecturaPublicable({ ...base, preguntas: 3, activas: 3, lecturaActiva: false }));
check(
  "⭐ rama de clasificación RETIRADA → no (aunque todo lo demás esté bien)",
  !lecturaPublicable({ ...base, preguntas: 3, activas: 3, clasificacionDisponible: false }),
);

console.log("5 · expandirBloquesPuro");
const porId = new Map<string, ReactivoDeExamen>([
  ["d1", { _id: "d1" }],
  ["d2", { _id: "d2" }],
  ["L1a", { _id: "L1a", bloque: { lecturaId: "L1", orden: 0 } }],
  ["L1b", { _id: "L1b", bloque: { lecturaId: "L1", orden: 1 } }],
  ["L2a", { _id: "L2a", bloque: { lecturaId: "L2", orden: 0 } }],
  ["L2b", { _id: "L2b", bloque: { lecturaId: "L2", orden: 1 } }],
]);
/** Un bloque SANO: existe, todas activas, lectura activa y rama vigente. */
const sano = (preguntas: PreguntaOrdenable[]): BloqueDeLectura => ({
  existe: true,
  preguntas,
  activas: preguntas.length,
  lecturaActiva: true,
  clasificacionDisponible: true,
});
const bloquePorLectura = new Map<string, BloqueDeLectura>([
  ["L1", sano([p("L1a", 0), p("L1b", 1)])],
  ["L2", sano([p("L2a", 0), p("L2b", 1)])],
]);
check(
  "una sola pregunta expande a su bloque completo",
  JSON.stringify(expandirBloquesPuro(["L1b"], porId, bloquePorLectura)) === '["L1a","L1b"]',
);
check(
  "si ya estaban todas, no duplica",
  JSON.stringify(expandirBloquesPuro(["L1a", "L1b"], porId, bloquePorLectura)) === '["L1a","L1b"]',
);
// ⭐ El orden RELATIVO del examen se conserva: directas antes y después, y dos bloques.
check(
  "⭐ conserva el orden relativo con directas y DOS bloques",
  JSON.stringify(expandirBloquesPuro(["d1", "L2b", "d2", "L1a"], porId, bloquePorLectura)) ===
    '["d1","L2a","L2b","d2","L1a","L1b"]',
  JSON.stringify(expandirBloquesPuro(["d1", "L2b", "d2", "L1a"], porId, bloquePorLectura)),
);
check(
  "un id fantasma se conserva (lo denuncia el validador, no el expansor)",
  JSON.stringify(expandirBloquesPuro(["d1", "zz"], porId, bloquePorLectura)) === '["d1","zz"]',
);

console.log("6 · validarBloquesCompletosPuro");
const val = (ids: string[]) => validarBloquesCompletosPuro(ids, porId, bloquePorLectura);
check("bloque completo y contiguo pasa", val(["d1", "L1a", "L1b"]) === null);
check("dos bloques completos pasan", val(["L1a", "L1b", "d1", "L2a", "L2b"]) === null);
check("bloque INCOMPLETO se rechaza", val(["d1", "L1a"]) !== null);
check("pregunta REPETIDA se rechaza", val(["L1a", "L1a", "L1b"]) !== null);
check("id fantasma se rechaza", val(["d1", "zz"]) !== null);
check(
  "⭐ completas pero en ORDEN distinto al del bloque se rechaza",
  val(["L1b", "L1a"]) !== null,
  String(val(["L1b", "L1a"])),
);
check(
  "⭐ completas pero NO contiguas se rechaza",
  val(["L1a", "d1", "L1b"]) !== null,
  String(val(["L1a", "d1", "L1b"])),
);
check("dos bloques INTERCALADOS se rechaza", val(["L1a", "L2a", "L1b", "L2b"]) !== null);
// ⭐ Corrupción persistida: el orden en la base no es denso.
const bloqueCorrupto = new Map<string, BloqueDeLectura>([
  ["L1", sano([p("L1a", 0), p("L1b", 5)])],
]);
check(
  "⭐ `orden` persistido NO denso se RECHAZA (no se «interpreta»)",
  validarBloquesCompletosPuro(["L1a", "L1b"], porId, bloqueCorrupto) !== null,
);
// ⭐ Lectura FANTASMA modelada como la construye el ENVOLTORIO: el índice `by_bloque` SÍ
// encuentra las preguntas huérfanas, así que el mapa NO llega vacío — llega con el bloque
// completo y `existe: false`. Con un mapa vacío esta prueba pasaba sin probar nada.
const bloqueFantasma = new Map<string, BloqueDeLectura>([
  ["L1", { ...sano([p("L1a", 0), p("L1b", 1)]), existe: false }],
]);
check(
  "⭐ lectura FANTASMA se rechaza aunque el mapa traiga sus preguntas",
  validarBloquesCompletosPuro(["L1a", "L1b"], porId, bloqueFantasma) !== null,
  String(validarBloquesCompletosPuro(["L1a", "L1b"], porId, bloqueFantasma)),
);

console.log("6b · ⭐ La frontera exige ELEGIBILIDAD, no solo forma");
// Sin esto, la frontera aceptaría exactamente lo que el listado marca «Incompleta».
const conBloque = (b: BloqueDeLectura) =>
  validarBloquesCompletosPuro(
    b.preguntas.map((x) => x._id),
    porId,
    new Map([["L1", b]]),
  );
check(
  "⭐ un bloque de UNA sola pregunta se rechaza",
  conBloque({ ...sano([p("L1a", 0)]), preguntas: [p("L1a", 0)], activas: 1 }) !== null,
);
check(
  "⭐ con una pregunta INACTIVA se rechaza",
  conBloque({ ...sano([p("L1a", 0), p("L1b", 1)]), activas: 1 }) !== null,
);
check(
  "⭐ con la LECTURA desactivada se rechaza",
  conBloque({ ...sano([p("L1a", 0), p("L1b", 1)]), lecturaActiva: false }) !== null,
);
check(
  "⭐ con la clasificación RETIRADA se rechaza",
  conBloque({
    ...sano([p("L1a", 0), p("L1b", 1)]),
    clasificacionDisponible: false,
  }) !== null,
);
check(
  "un bloque sano de 2 sigue pasando",
  conBloque(sano([p("L1a", 0), p("L1b", 1)])) === null,
);

console.log("7 · lecturaCompat (resolución transitoria de la Fase A)");
const L = "lec1" as never;
const OTRA = "lec2" as never;
check("sin campos → libre", resolverLectura({}).tipo === "libre");
check("solo lecturaId → legado", resolverLectura({ lecturaId: L }).tipo === "legado");
check(
  "solo bloque → bloque",
  resolverLectura({ bloque: { lecturaId: L, orden: 0 } }).tipo === "bloque",
);
check(
  "ambos COINCIDENTES → bloque",
  resolverLectura({ lecturaId: L, bloque: { lecturaId: L, orden: 0 } }).tipo === "bloque",
);
const disc = resolverLectura({ lecturaId: OTRA, bloque: { lecturaId: L, orden: 0 } });
check("⭐ ambos DISCREPANTES → inconsistente", disc.tipo === "inconsistente");
check(
  "⭐ inconsistente: el candado es CONSERVADOR (usa bloque.lecturaId)",
  lecturaParaBloqueo(disc) === L,
);
check("⭐ inconsistente: el enlace se SUPRIME", lecturaParaEnlace(disc) === null);
check("legado NO participa del candado de bloque", lecturaParaBloqueo(resolverLectura({ lecturaId: L })) === null);
check("legado SÍ enlaza", lecturaParaEnlace(resolverLectura({ lecturaId: L })) === L);
check("esDeBloque cubre bloque e inconsistente", esDeBloque(disc) && !esDeBloque(resolverLectura({ lecturaId: L })));

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
