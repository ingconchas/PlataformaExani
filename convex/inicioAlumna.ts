import { type GenericId } from "convex/values";
import {
  derivarMisExamenes,
  type CardPendiente,
  type MisExamenesCrudo,
} from "./misExamenes";
import { redondearPuntaje } from "./simulacro";

/**
 * Reglas PURAS de la pantalla Inicio de la alumna (LUI-24), en un módulo importable por
 * `tsx` (misma razón de existir que `misExamenes.ts` / `simulacro.ts`: solo importa otros
 * módulos puros, jamás `_generated/server`, para que `scripts/test-inicio-alumna.ts` las
 * pruebe sin BD).
 *
 * Aquí vive la DEFINICIÓN CANÓNICA de «diagnóstico elegible» y su ORDEN. El read-model
 * `ultimosDiagnosticos` (una fila por alumna, apuntando al diagnóstico ENVIADO con tupla
 * máxima) lo escriben CINCO actores —`finalizarIntento`, el backfill, el verificador, el
 * recómputo del seed y el candado de la query `player.ultimoDiagnostico`— y TODOS reusan
 * `esDiagnosticoElegible` y `ganaPuntero` desde aquí: un predicado divergente entre
 * escritor y lector dejaría un puntero que la query rechaza para siempre (tumbando /inicio)
 * o desplazaría a un diagnóstico realmente elegible.
 */

export type IntentoId = GenericId<"intentos">;

// ─────────────────────────────────────────────────────────────────────────────
// Contrato de página de los recorredores de `intentos` (backfill · verificador · recómputo)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los TRES recorredores de `intentos` (backfill, fase 1 del verificador y el recómputo del
 * seed) comparten estas constantes para que `SplitRequired` sea **imposible por aritmética**,
 * no por esperanza: al alcanzar `maximumBytesRead` una página puede volver INCOMPLETA
 * (`pageStatus: "SplitRequired"`) y procesarla como completa saltaría documentos en silencio
 * —backfill y verificador podrían omitir el MISMO diagnóstico y dar 0 discrepancias sobre un
 * puntero no-máximo—.
 *
 * ⚠️ La cota se razona contra el LÍMITE DURO por documento de Convex (1 MiB), NO contra una
 * estimación del tamaño nominal: `intentos.aciertosPorSeccion`/`aciertosPorArea` son arreglos
 * SIN cota estructural en el schema, y una fila legada, directa o de otro escritor podría
 * pasar del tamaño típico (~40 KiB). Con `LOTE_PUNTEROS × LIMITE_DOC_CONVEX` (8 MiB)
 * estrictamente por debajo de `BYTES_POR_PAGINA_PUNTEROS` (12 MiB), el límite de bytes NUNCA
 * se alcanza antes que `numItems` filas AUNQUE cada fila mida el máximo físico ⇒ la base no
 * divide. Y `BYTES_POR_PAGINA_PUNTEROS` queda por debajo del techo de 16 MiB por transacción.
 * Aun así cada recorredor LANZA si `pageStatus === "SplitRequired"`: si el contrato de Convex
 * derivara, el fallo es ruidoso, jamás un salto silencioso. `splitRequiredImposible()` es la
 * desigualdad, probada en `test-inicio`.
 */
export const LOTE_PUNTEROS = 8;
export const LIMITE_DOC_CONVEX = 1024 * 1024; // 1 MiB: límite DURO por documento de Convex
export const BYTES_POR_PAGINA_PUNTEROS = 12 * 1024 * 1024; // 12 MiB
export const LIMITE_TX_BYTES_CONVEX = 16 * 1024 * 1024; // techo duro por transacción

export function splitRequiredImposible(): boolean {
  return (
    LOTE_PUNTEROS * LIMITE_DOC_CONVEX < BYTES_POR_PAGINA_PUNTEROS &&
    BYTES_POR_PAGINA_PUNTEROS < LIMITE_TX_BYTES_CONVEX
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicado y orden canónicos del read-model
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo que `esDiagnosticoElegible` inspecciona; lo cumple tanto un `Doc<"intentos">`
 *  como un fixture de prueba. */
export type IntentoParaElegibilidad = {
  estado: string;
  numeroIntento?: number | null;
  formaCierre?: string | null;
  enviadoEn?: number | null;
};

/**
 * ¿Este intento es un DIAGNÓSTICO elegible para el read-model? Definición ÚNICA compartida
 * por escritor, backfill, verificador, seed y el candado de la query.
 *
 * `Number.isFinite`, NO `typeof === "number"` (el dictamen v5→v6): `v.number()` admite `NaN`
 * e infinitos, y una fila con `enviadoEn: NaN` rompería el candado de frescura para siempre
 * (`NaN === NaN` es falso) mientras que `Infinity` sería un máximo que ningún cierre real
 * desplaza. Una fila enviada y numerada 1 pero sin `formaCierre`, sin `enviadoEn` o con
 * fecha no finita es MALFORMADA: nunca estampa ni desplaza, y backfill/verificador la
 * cuentan aparte.
 */
export function esDiagnosticoElegible(i: IntentoParaElegibilidad): boolean {
  return (
    i.estado === "enviado" &&
    i.numeroIntento === 1 &&
    i.formaCierre != null &&
    Number.isFinite(i.enviadoEn)
  );
}

/** La tupla que identifica y ordena un puntero: el intento y su fecha de envío (finita). */
export type PunteroTupla = { intentoId: IntentoId; enviadoEn: number };

/**
 * Orden TOTAL sobre tuplas elegibles: gana la de mayor `(enviadoEn, intentoId)`
 * lexicográfico. Devuelve la tupla ganadora (o `null` solo si ambas son `null`). Es el
 * embudo de comparación para toda ESCRITURA nueva del puntero; el caso «mismo id con datos
 * nuevos» NO pasa por aquí —es de `decisionTrasParche`—, así que un empate exacto de id
 * devuelve `actual` (no-op para el llamador).
 */
export function ganaPuntero(
  actual: PunteroTupla | null,
  nuevo: PunteroTupla | null,
): PunteroTupla | null {
  if (actual === null) return nuevo;
  if (nuevo === null) return actual;
  if (nuevo.enviadoEn !== actual.enviadoEn) {
    return nuevo.enviadoEn > actual.enviadoEn ? nuevo : actual;
  }
  return nuevo.intentoId > actual.intentoId ? nuevo : actual;
}

/**
 * Qué hacer con el puntero cuando un helper dev PARCHEA un intento (re-anclaje de
 * `enviadoEn`, `envejecerIntento`). Puro y con test discriminante — cierra el mayor 1 del
 * dictamen v4→v5.
 *
 *  · id parchado ≠ apuntado ⇒ `"comparar"`: puede promoverlo `ganaPuntero`, no puede
 *    destronar al vigente por sí solo.
 *  · id parchado = apuntado y AVANZA (sigue elegible, `enviadoEn` ≥ el del puntero) ⇒
 *    `"actualizar"` O(1): adelantar conserva la dominancia que el puntero ya tenía.
 *  · id parchado = apuntado y RETROCEDE o deja de ser elegible ⇒ `"borrarYRecomputar"`:
 *    retroceder puede caer por debajo de OTRO candidato (A@200 apuntado, B@150, A→100 ⇒ el
 *    máximo verdadero es B@150; «actualizar hacia atrás» dejaría A@100). El candado de
 *    frescura no ve este caso porque intento y puntero coinciden; esta regla es quien lo
 *    cierra, con el recómputo global de red.
 */
export function decisionTrasParche(
  puntero: PunteroTupla | null,
  parchado: { intentoId: IntentoId; elegible: boolean; enviadoEn: number | null },
): "comparar" | "actualizar" | "borrarYRecomputar" {
  if (puntero === null || puntero.intentoId !== parchado.intentoId) return "comparar";
  if (
    parchado.elegible &&
    parchado.enviadoEn !== null &&
    Number.isFinite(parchado.enviadoEn) &&
    parchado.enviadoEn >= puntero.enviadoEn
  ) {
    return "actualizar";
  }
  return "borrarYRecomputar";
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Título del último resultado, TOTAL: preferimos el snapshot de la asignación
 * (`tituloExamen`), caemos al `titulo` del examen si aquel falta (asignación borrada o
 * legada sin read-model) y, sin ninguno, a «Simulacro». El finalizador cierra un intento
 * aunque su examen haya desaparecido, así que el título jamás puede ser la razón de dejarlo
 * atrapado (media del dictamen v4→v5). Se deriva al LEER; no hay copia denormalizada que
 * pueda divergir del examen real.
 */
export function tituloDeCierre(
  tituloAsignacion: string | null | undefined,
  tituloExamen: string | null | undefined,
): string {
  return tituloAsignacion ?? tituloExamen ?? "Simulacro";
}

/**
 * La línea del banner «Tu último resultado». Con puntaje sin calificar (`null`) NUNCA se
 * invoca `redondearPuntaje` (su contrato es `number`): se dice «sin calificación» en vez de
 * inventar un 700 o pintar `NaN`.
 */
export function lineaUltimoResultado(
  titulo: string,
  puntajeCrudo: number | null,
): string {
  return puntajeCrudo === null
    ? `${titulo} — sin calificación`
    : `${titulo} — ${redondearPuntaje(puntajeCrudo)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// La derivación de la pantalla
// ─────────────────────────────────────────────────────────────────────────────

/** El diagnóstico más reciente, tal como lo entrega `player.ultimoDiagnostico`. */
export type UltimoDiagnostico = {
  intentoId: IntentoId;
  titulo: string;
  /** CRUDO: el embudo `compararConMeta` de la tarjeta redondea dentro. */
  puntajeCrudo: number | null;
  enviadoEn: number;
  numeroIntento: number | null;
} | null;

/**
 * Las cuatro variantes de la pantalla, decididas por DOS existencias exactas: `U` = hay
 * diagnóstico (read-model), `P` = hay próximo pendiente (`derivarMisExamenes`). Ninguna es
 * un vacío mentiroso: ambas fuentes son exactas para lo que Inicio pinta (el historial
 * cerrado recortado no alimenta ningún dato de esta pantalla, así que `incompleto` de «Mis
 * exámenes» no se usa aquí).
 */
export type VarianteInicio =
  | "completa"
  | "sinPendientes"
  | "sinContestados"
  | "bienvenida";

export type DerivadoInicio = {
  proximo: CardPendiente | null;
  ultimo: UltimoDiagnostico;
  variante: VarianteInicio;
  /** Instantes futuros en que algo cambia: el timer anclado del cliente despierta ahí. */
  fronteras: number[];
  /** Hay asignaciones que aún no abren: ajusta el COPY de los estados vacíos, no la
   *  variante (decir «no tienes» cuando hay una programada sería falso). */
  hayFuturas: boolean;
};

export function derivarInicio(
  crudo: MisExamenesCrudo,
  ultimo: UltimoDiagnostico,
  ahora: number,
): DerivadoInicio {
  const d = derivarMisExamenes(crudo, ahora);
  const proximo = d.pendientes[0] ?? null;
  const U = ultimo !== null;
  const P = proximo !== null;
  const variante: VarianteInicio =
    U && P ? "completa" : U ? "sinPendientes" : P ? "sinContestados" : "bienvenida";
  return { proximo, ultimo, variante, fronteras: d.fronteras, hayFuturas: d.hayFuturas };
}
