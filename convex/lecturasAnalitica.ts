import { type QueryCtx } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { MAX_INTENTOS_PANEL_POR_ASIGNACION } from "./simulacro";
import {
  corteDePagina,
  INTENTOS_BYTES_RESULTADOS,
  type IntentoCrudoResultados,
} from "./resultados";

/**
 * Proyección de un intento hacia el cliente — SOLO los campos del contrato
 * `IntentoCrudoResultados`; los opcionales ausentes se OMITEN (no viajan `null`s, que
 * `metaDe`-style tendrían que distinguirse de «ausente»).
 *
 * Vive aquí, junto al lector canónico, porque la usan DOS pantallas con poblaciones
 * distintas: `resultadosExamen.intentosDe` (la asignación completa, LUI-30) y
 * `player.resultado` (UN intento, LUI-28). Si cada una proyectara por su cuenta, bastaría
 * con que una olvidara `aciertosPorArea` para que el acordeón de la alumna y el de su
 * instructor dejaran de coincidir sin que nada fallara.
 */
export function proyectarIntento(d: Doc<"intentos">): IntentoCrudoResultados {
  return {
    alumnoId: d.alumnoId,
    estado: d.estado,
    ...(d.numeroIntento !== undefined ? { numeroIntento: d.numeroIntento } : {}),
    iniciadoEn: d.iniciadoEn,
    ...(d.enviadoEn !== undefined ? { enviadoEn: d.enviadoEn } : {}),
    ...(d.puntaje !== undefined ? { puntaje: d.puntaje } : {}),
    ...(d.aciertosPorSeccion !== undefined
      ? { aciertosPorSeccion: d.aciertosPorSeccion }
      : {}),
    ...(d.aciertosPorArea !== undefined
      ? { aciertosPorArea: d.aciertosPorArea }
      : {}),
  };
}

/**
 * Lectura CANÓNICA de los intentos-para-analítica de una asignación (LUI-30, plan v5-M1).
 *
 * Es EL único lector de las dos poblaciones de la regla del primer intento — los
 * diagnósticos (`numeroIntento === 1`) y el legado sin campo — para consumo analítico:
 * lo estrena `resultadosExamen.intentosDe` (Q3) y en la entrega B lo importa
 * `panel.promedioDe`. Una sola implementación ⇒ la paridad «mismo promedio en el panel del
 * admin y en Resultados del examen» no es una promesa de disciplina sino la misma función
 * sobre los mismos rangos, con los mismos cortes.
 *
 * ══ POR QUÉ PAGINATE Y NO `take(401)` ══ Un intento enviado post-LUI-27 carga su desglose
 * (`aciertosPorSeccion` + `aciertosPorArea`): contractualmente 2 × 240 entradas × ~80 B ≈
 * **40 KiB/doc**, y dos `take(401)` (≈31 MiB) morirían contra el límite de 16 MiB de la
 * transacción ANTES de poder devolver un flag. El paginate con `maximumBytesRead` es
 * garantía del RUNTIME: corta la página y este helper responde `corte: true` — fail-closed,
 * jamás un prefijo presentado como total (`promedioDeAsignacion` prohíbe promediar
 * prefijos; una tabla parcial mentiría igual).
 *
 * ══ POR QUÉ EL LEGADO SÍ USA `take(401)` ══ Su cota de bytes es un invariante TEMPORAL
 * demostrable: un doc sin `numeroIntento` es anterior al paquete player (todo intento que
 * nace por `iniciarIntento` lo lleva) y por tanto anterior a LUI-27 ⇒ SIN desglose ⇒ forma
 * fija ~0.4 KiB (el escritor «desglose ∧ sin número» nunca existió; prod arrancó con
 * `intentos` vacía). 401 × 0.4 KiB ≈ 160 KiB.
 *
 * ══ CORTE ══ `corteDePagina` (resultados.ts) con sus DOS señales — filas > cap ∨ `!isDone`
 * (bytes) — probadas en las cuatro combinaciones por `test-resultados.ts`. Ante corte:
 * `{diagnosticos: [], legado: [], corte: true}` SIN datos.
 *
 * PRESUPUESTO (lo que este helper aporta a su query): rangos 1 (paginate) + 1 (take) = 2 ·
 * docs ≤401 + ≤401 = ≤802 · bytes ≤`INTENTOS_BYTES_RESULTADOS` (6 MiB, runtime) + ~160 KiB.
 */
export async function leerIntentosParaAnalitica(
  ctx: QueryCtx,
  asignacionId: Id<"asignaciones">,
): Promise<{
  diagnosticos: Doc<"intentos">[];
  legado: Doc<"intentos">[];
  corte: boolean;
}> {
  const cap = MAX_INTENTOS_PANEL_POR_ASIGNACION;

  const diagnosticos = await ctx.db
    .query("intentos")
    .withIndex("by_asignacion_numero", (q) =>
      q.eq("asignacionId", asignacionId).eq("numeroIntento", 1),
    )
    .paginate({
      numItems: cap + 1,
      cursor: null,
      maximumRowsRead: cap + 1,
      maximumBytesRead: INTENTOS_BYTES_RESULTADOS,
    });
  if (
    corteDePagina({
      numFilas: diagnosticos.page.length,
      isDone: diagnosticos.isDone,
      cap,
    })
  ) {
    return { diagnosticos: [], legado: [], corte: true };
  }

  // Semántica de Convex: `eq("numeroIntento", undefined)` casa los docs SIN el campo.
  const legado = await ctx.db
    .query("intentos")
    .withIndex("by_asignacion_numero", (q) =>
      q.eq("asignacionId", asignacionId).eq("numeroIntento", undefined),
    )
    .take(cap + 1);
  if (legado.length > cap) {
    return { diagnosticos: [], legado: [], corte: true };
  }

  return { diagnosticos: diagnosticos.page, legado, corte: false };
}
