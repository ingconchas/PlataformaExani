/**
 * Prueba del ciclo de vida del examen (LUI-20, Entrega A). Corre con `npm run test:examenes`
 * (tsx → sin depender del type-stripping de Node).
 *
 * Cubre lo que NINGUNA prueba de integración alcanza, por la razón que ya documentan
 * `test-material.ts` y `test-bloque.ts`: **`npx convex run` corre SIN identidad**, así que
 * todo lo que vive tras `requireStaff` se rechaza por falta de sesión ANTES de llegar a la
 * lógica — un falso verde. Aquí se llama el MISMO código que corre en producción, no un
 * duplicado.
 *
 * El invariante de la ventana se prueba contra el `fueAplicada` REAL de `convex/metricas.ts`
 * (importable: ese módulo solo tiene un import de tipo y no define funciones de Convex). Si
 * alguien mueve un criterio sin mover el otro, esta prueba cae — que es exactamente para lo
 * que existe.
 */
import {
  CONGELA,
  ESTADOS_QUE_CONGELAN,
  TRANSICIONES,
  estadoDeVentana,
  etiquetaTipo,
  normalizarTipo,
  resolverIntencionTipo,
  transicionPermitida,
  ventanaConcluida,
  type EstadoExamen,
} from "../convex/examenEstado";
import { fueAplicada } from "../convex/metricas";
import type { Doc } from "../convex/_generated/dataModel";

let ok = 0;
let fallos = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else {
    fallos++;
    console.error(`  ✘ ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("1 · CONGELA — qué estados comprometen el contenido");
// ─────────────────────────────────────────────────────────────────────────────

check("borrador NO congela", CONGELA.borrador === false);
check("publicado congela", CONGELA.publicado === true);
check(
  "⭐ archivado CONGELA (el bug central de LUI-20)",
  CONGELA.archivado === true,
  "un archivado conserva su historial de resultados; su contenido no puede cambiar",
);

// ⭐ DISCRIMINANTE sobre el DATO, con un alcance que conviene no exagerar: esto verifica que
// el arreglo derivado sea correcto, **no que `calcularBloqueo` lo use**. Una regresión que
// volviera a escribir el literal `["publicado"]` a mano en el consumidor seguiría pasando por
// aquí — ninguna prueba pura puede ver eso, porque el consumidor necesita `ctx`. Quien lo
// caza es el par de fixtures de la Entrega B (archivado con compromiso → congela / archivado
// libre → no congela).
check(
  "⭐ ESTADOS_QUE_CONGELAN incluye archivado",
  ESTADOS_QUE_CONGELAN.includes("archivado"),
  `recibido: [${ESTADOS_QUE_CONGELAN.join(", ")}]`,
);
check(
  "⭐ ESTADOS_QUE_CONGELAN NO incluye borrador",
  !ESTADOS_QUE_CONGELAN.includes("borrador"),
);
check(
  "ESTADOS_QUE_CONGELAN se DERIVA de CONGELA (no se escribe a mano)",
  ESTADOS_QUE_CONGELAN.length ===
    (Object.keys(CONGELA) as EstadoExamen[]).filter((e) => CONGELA[e]).length,
);

// ⭐ El congelado tiene que ser EFECTIVO, no solo tipado: `readonly` detiene el error honesto
// en compilación, pero no el acceso dinámico (un `as any`, un módulo JS, un índice calculado).
// Una defensa estructural que se puede mutar en caliente no es una defensa.
function mutacionRechazada(fn: () => void): boolean {
  try {
    fn();
    return false; // no lanzó → la mutación PASÓ
  } catch {
    return true; // TypeError de modo estricto (los módulos ES siempre lo son)
  }
}
check(
  "⭐ CONGELA está congelado: reasignar una entrada lanza",
  mutacionRechazada(() => {
    (CONGELA as Record<string, boolean>).archivado = false;
  }) && CONGELA.archivado === true,
);
check(
  "⭐ ESTADOS_QUE_CONGELAN está congelado: push('borrador') lanza",
  mutacionRechazada(() => {
    (ESTADOS_QUE_CONGELAN as EstadoExamen[]).push("borrador");
  }) && !ESTADOS_QUE_CONGELAN.includes("borrador"),
);
// Los DOS niveles se prueban por separado a propósito: con una sola aserción sobre el arreglo
// interno, retirar el `Object.freeze` EXTERIOR y conservar los interiores seguiría pasando.
// Testigo del freeze desde LUI-21: `publicado → borrador` ya es legal (despublicar), así
// que el camino que un `push` en caliente abriría sin guardas es `archivado → borrador` —
// el atajo que saltaría desarchivar+despublicar.
check(
  "⭐ TRANSICIONES: nivel interno congelado (push al arreglo lanza)",
  mutacionRechazada(() => {
    (TRANSICIONES.archivado as EstadoExamen[]).push("borrador");
  }) && !transicionPermitida("archivado", "borrador"),
);
check(
  "⭐ TRANSICIONES: nivel RAÍZ congelado (reemplazar la propiedad lanza)",
  mutacionRechazada(() => {
    (TRANSICIONES as Record<string, readonly EstadoExamen[]>).archivado = [
      "borrador",
    ];
  }) && !transicionPermitida("archivado", "borrador"),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2 · TRANSICIONES — el grafo del ciclo de edición");
// ─────────────────────────────────────────────────────────────────────────────

check("publicado → archivado (archivar)", transicionPermitida("publicado", "archivado"));
check("archivado → publicado (desarchivar)", transicionPermitida("archivado", "publicado"));
check(
  "⭐ publicado → borrador PERMITIDA (LUI-21 · despublicar)",
  transicionPermitida("publicado", "borrador"),
  "el camino existe en la tabla; la condición (sin asignaciones NI intentos) vive en las guardas de la mutation",
);
check(
  "⭐ archivado → borrador DIRECTA prohibida",
  !transicionPermitida("archivado", "borrador"),
  "primero debe desarchivarse (siempre a publicado) y después pasar por las guardas de despublicar",
);
check(
  "⭐ borrador NO se archiva directamente",
  !transicionPermitida("borrador", "archivado"),
  "un borrador nunca estuvo en uso: se borra, no se retira de uso",
);

// ⭐ DISCRIMINANTE: la tentación al implementar la idempotencia es declarar las
// autotransiciones como válidas para que `archivar` sobre un archivado «pase». Eso mezcla
// «transición válida» con «no cambió nada» y deja pasar como cambio legítimo algo que debe
// contestar `{cambiado:false}` en la salida idempotente ANTERIOR a esta comprobación.
for (const e of Object.keys(TRANSICIONES) as EstadoExamen[]) {
  check(
    `⭐ sin autotransición ${e} → ${e}`,
    !transicionPermitida(e, e),
    "la repetición es un no-op, no una transición",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3 · estadoDeVentana — intervalo semiabierto [abreEn, cierraEn)");
// ─────────────────────────────────────────────────────────────────────────────

const ABRE = 1_000;
const CIERRA = 2_000;

check("antes de abrir → programada", estadoDeVentana(ABRE, CIERRA, 500) === "programada");
check("en medio → abierta", estadoDeVentana(ABRE, CIERRA, 1_500) === "abierta");
check("después de cerrar → cerrada", estadoDeVentana(ABRE, CIERRA, 2_500) === "cerrada");

// ⭐ DISCRIMINANTES: los dos bordes exactos. Una implementación con las comparaciones
// invertidas (`<=` por `<`) pasa los tres casos de arriba y falla EXACTAMENTE aquí. Sin
// estas dos, el intervalo podría ser cerrado por ambos lados —y entonces un instante
// pertenecería a dos estados— o abierto por ambos —y ninguno lo cubriría—.
check(
  "⭐ borde: ahora === abreEn → ABIERTA (no programada)",
  estadoDeVentana(ABRE, CIERRA, ABRE) === "abierta",
);
check(
  "⭐ borde: ahora === cierraEn → CERRADA (no abierta)",
  estadoDeVentana(ABRE, CIERRA, CIERRA) === "cerrada",
);

// Totalidad: ninguna ventana malformada produce «abierta».
check(
  "⭐ ventana degenerada (abre === cierra) nunca está abierta",
  estadoDeVentana(1_000, 1_000, 1_000) !== "abierta",
);
check(
  "⭐ ventana invertida (abre > cierra) nunca está abierta",
  estadoDeVentana(2_000, 1_000, 1_500) !== "abierta",
  "validarVentana las rechaza al escribir (test-asignacion); esta función sigue TOTAL para lo persistido",
);

// El invariante que ata esta función a `metricas.fueAplicada`, contra el código REAL.
const asignacion = (abreEn: number, cierraEn: number) =>
  ({ abreEn, cierraEn }) as Doc<"asignaciones">;
let invarianteOk = true;
for (const ahora of [0, 999, 1_000, 1_001, 1_999, 2_000, 2_001, 9_999]) {
  const aplicada = fueAplicada(asignacion(ABRE, CIERRA), ahora);
  const noProgramada = estadoDeVentana(ABRE, CIERRA, ahora) !== "programada";
  if (aplicada !== noProgramada) invarianteOk = false;
}
check(
  "⭐ invariante: fueAplicada(a,t) ⟺ estadoDeVentana(a,t) !== «programada»",
  invarianteOk,
  "si cae, alguien movió el criterio de «aplicada» en metricas.ts sin mover este",
);

check("ventanaConcluida solo tras cierraEn", ventanaConcluida(ABRE, CIERRA, CIERRA));
check("ventanaConcluida es falsa mientras está abierta", !ventanaConcluida(ABRE, CIERRA, 1_500));
check(
  "⭐ ventanaConcluida es falsa para una ventana FUTURA",
  !ventanaConcluida(ABRE, CIERRA, 0),
  "una asignación futura compromete tanto como una abierta: no se puede archivar",
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4 · Tipo del examen");
// ─────────────────────────────────────────────────────────────────────────────

check(
  "AUSENTE = simulacro general (legado)",
  normalizarTipo(undefined).clase === "general",
);
check(
  "un tipo presente se respeta",
  normalizarTipo({ clase: "general" }).clase === "general",
);
check(
  "etiqueta del general",
  etiquetaTipo({ clase: "general" }, null) === "Simulacro general",
);
check(
  "etiqueta del módulo con nombre",
  etiquetaTipo(
    { clase: "modulo", seccionId: "x" as never },
    "Biología",
  ) === "Módulo: Biología",
);

// ⭐ DISCRIMINANTE: con la referencia colgada (sección borrada pese a la sonda, o dato
// importado), la implementación ingenua interpola `undefined` y pinta «Módulo: undefined»
// en pantalla. La etiqueta no debe inventar.
check(
  "⭐ etiqueta del módulo con la sección COLGADA → «Módulo: —», nunca «undefined»",
  etiquetaTipo({ clase: "modulo", seccionId: "x" as never }, null) === "Módulo: —",
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5 · resolverIntencionTipo — fragmento de patch (patrón para un actualizador parcial futuro)");
// ─────────────────────────────────────────────────────────────────────────────

const ausente = resolverIntencionTipo(undefined);
const quitar = resolverIntencionTipo({ op: "quitar" });
const reemplazar = resolverIntencionTipo({
  op: "reemplazar",
  tipo: { clase: "modulo", seccionId: "s1" as never },
});

// ⭐ DISCRIMINANTE, y hay que usar `Object.hasOwn`: con `===` los dos casos son
// INDISTINGUIBLES (`{}.tipo` y `{tipo: undefined}.tipo` valen ambos `undefined`), y esa
// indistinguibilidad es justo el bug — `ctx.db.patch` BORRA el campo cuando la clave está
// presente con `undefined`, y lo CONSERVA cuando la clave no está. Un argumento ausente
// (cliente viejo, pestaña abierta, rollback) debe MANTENER el tipo, no borrarlo.
check(
  "⭐ ausente → {} SIN la clave (patch conserva el tipo)",
  !Object.hasOwn(ausente, "tipo"),
  `recibido: ${JSON.stringify(ausente)}`,
);
check(
  "⭐ quitar → la clave PRESENTE con undefined (patch borra el campo)",
  Object.hasOwn(quitar, "tipo") && quitar.tipo === undefined,
);
check(
  "reemplazar → devuelve el tipo nuevo",
  reemplazar.tipo?.clase === "modulo",
);

console.log(`\n${ok} pruebas OK, ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
