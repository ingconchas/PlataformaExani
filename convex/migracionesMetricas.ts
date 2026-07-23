import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";

/**
 * MIGRACIÓN OPERATIVA del read-model `asignaciones.envioRegistradoEn` (LUI-30, plan v4).
 *
 * Viven aquí —y no en `metricas.ts`— porque aquel módulo es PURO e importable por scripts
 * (`test-examenes.ts`), y una internalMutation lo contaminaría de `_generated/server`.
 *
 * ══ EL FASADO QUE ESTAS FUNCIONES SOSTIENEN ══
 *  · **PR A** (este código) despliega el campo, su índice, el escritor auto-reparador
 *    (`finalizarIntento`) y estas dos funciones. NINGÚN lector de «aplicada» cambia aún.
 *  · **Backfill operativo**: `reconciliarEnvioRegistrado` se corre por lotes hasta
 *    `isDone` — en dev (esperado: 0 reparaciones tras el seed) y en PROD tras el merge de A
 *    (esperado 0; SEGURO si hubo envíos entre la verificación y el deploy) — y después
 *    `verificarEnvioRegistrado` hasta `isDone` con **0 `discrepanciasPresencia`**. Ambas
 *    corridas van al reporte, con autorización explícita de Luis.
 *  · **PR B** cambia TODOS los lectores en un deploy, ya con el campo completo y
 *    verificado: en ningún instante un lector observa presencia parcial.
 *
 * Son `internal*`: solo invocables con la llave del deployment (CLI/dashboard), jamás desde
 * clientes. No llevan el guard SOLO_DEV a propósito — el backfill corre TAMBIÉN en prod;
 * la protección es el ciclo operativo (autorización literal + reporte), no el entorno.
 */

/** Lote de asignaciones procesadas por corrida — mantiene cada transacción diminuta
 *  (≤100 filas + ≤100 sondas + ≤100 patches) y la migración REANUDABLE por cursor. */
const LOTE_RECONCILIACION = 100;

/** ¿La asignación tiene AL MENOS un intento enviado? Sonda O(1) sobre el índice
 *  `by_asignacion_estado` (nace en este PR con este lector). Cualquier enviado sirve: por
 *  el invariante `numeroIntento > 1 ⟹ ∃ enviado previo` (panelInstructor.ts), «∃ enviado»
 *  ⟺ «el intento 1 está enviado» — la sonda no necesita `numeroIntento`. */
async function primerEnviadoDe(
  ctx: QueryCtx | MutationCtx,
  asignacionId: Id<"asignaciones">,
): Promise<Doc<"intentos"> | null> {
  return await ctx.db
    .query("intentos")
    .withIndex("by_asignacion_estado", (q) =>
      q.eq("asignacionId", asignacionId).eq("estado", "enviado"),
    )
    .first();
}

/**
 * BACKFILL idempotente de `envioRegistradoEn`: recorre `asignaciones` por lotes de
 * `LOTE_RECONCILIACION` desde `cursor`; por cada fila SIN campo, sonda «∃ enviado» y, si
 * existe, estampa `probe.enviadoEn ?? probe.iniciadoEn`. Fila con campo → skip (correr dos
 * veces no cambia nada). Devuelve `{continueCursor, isDone, reparadas}` — el operador
 * repite con el cursor hasta `isDone`.
 */
export const reconciliarEnvioRegistrado = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const pagina = await ctx.db.query("asignaciones").paginate({
      numItems: LOTE_RECONCILIACION,
      cursor: args.cursor,
    });
    let reparadas = 0;
    for (const a of pagina.page) {
      if (a.envioRegistradoEn !== undefined) continue;
      const enviado = await primerEnviadoDe(ctx, a._id);
      if (enviado) {
        await ctx.db.patch(a._id, {
          envioRegistradoEn: enviado.enviadoEn ?? enviado.iniciadoEn,
        });
        reparadas += 1;
      }
    }
    return {
      continueCursor: pagina.continueCursor,
      isDone: pagina.isDone,
      reparadas,
    };
  },
});

/**
 * VERIFICADOR del backfill — DOS contadores con papeles distintos (plan v6, baja):
 *  · `discrepanciasPresencia` — `campo presente ⊕ ∃ enviado`: las ÚNICAS que BLOQUEAN el
 *    paso a PR B (los lectores consumen SOLO existencia).
 *  · `discrepanciasTemporales` — `envioRegistradoEn < abreEn`: INFORMATIVAS. La
 *    desigualdad `envioRegistradoEn ≥ abreEn` está garantizada POR CONSTRUCCIÓN (guarda 5
 *    de `iniciarIntento`: todo intento nace con la ventana abierta, y
 *    `enviadoEn ≥ iniciadoEn ≥ abreEn`); este contador es su testigo adicional, no el
 *    gate.
 */
export const verificarEnvioRegistrado = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const pagina = await ctx.db.query("asignaciones").paginate({
      numItems: LOTE_RECONCILIACION,
      cursor: args.cursor,
    });
    let discrepanciasPresencia = 0;
    let discrepanciasTemporales = 0;
    for (const a of pagina.page) {
      const enviado = await primerEnviadoDe(ctx, a._id);
      const tieneCampo = a.envioRegistradoEn !== undefined;
      if (tieneCampo !== (enviado !== null)) discrepanciasPresencia += 1;
      if (tieneCampo && (a.envioRegistradoEn as number) < a.abreEn) {
        discrepanciasTemporales += 1;
      }
    }
    return {
      continueCursor: pagina.continueCursor,
      isDone: pagina.isDone,
      discrepanciasPresencia,
      discrepanciasTemporales,
    };
  },
});
