import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { exigirDeploymentDeDesarrollo } from "./entorno";
import {
  BYTES_POR_PAGINA_PUNTEROS,
  LOTE_PUNTEROS,
  esDiagnosticoElegible,
  ganaPuntero,
} from "./inicioAlumna";

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

// ─────────────────────────────────────────────────────────────────────────────
// Read-model `ultimosDiagnosticos` (LUI-24): backfill + verificador bifásico
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guard de `SplitRequired`: procesar una página INCOMPLETA como completa saltaría documentos
 * en silencio y el verificador podría dar 0 discrepancias sobre un puntero no-máximo. La
 * aritmética de `inicioAlumna` lo hace imposible con los límites de producción; este throw
 * es la red por si el contrato de Convex derivara — y el punto que el testigo solo-dev
 * fuerza con `limiteBytesOverride`.
 */
function exigirPaginaCompleta(
  pageStatus: "SplitRecommended" | "SplitRequired" | null | undefined,
  donde: string,
): void {
  if (pageStatus === "SplitRequired") {
    throw new Error(
      `${donde}: página incompleta (SplitRequired). La aritmética de límites de ` +
        `inicioAlumna debe impedirlo; revisa LOTE_PUNTEROS / LIMITE_DOC_CONVEX.`,
    );
  }
}

/**
 * BACKFILL idempotente de `ultimosDiagnosticos`: recorre `intentos` por páginas de
 * `LOTE_PUNTEROS` desde `cursor`; por cada DIAGNÓSTICO elegible (`esDiagnosticoElegible`,
 * el predicado canónico) hace competir su tupla por el puntero de su alumna vía
 * `ganaPuntero`. Monótono ⇒ correr dos veces converge, y solaparse con el escritor vivo
 * (`finalizarIntento`) es seguro. Cuenta aparte los `malformados` (enviado y numerado 1
 * pero sin `formaCierre` o con `enviadoEn` no finito): nunca estampan ni desplazan.
 *
 * `limiteBytesOverride` es SOLO-DEV (fuerza `SplitRequired` en el testigo de `e2e:lui24`).
 */
export const backfillUltimosDiagnosticos = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limiteBytesOverride: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.limiteBytesOverride !== undefined) exigirDeploymentDeDesarrollo();
    const pagina = await ctx.db.query("intentos").paginate({
      numItems: LOTE_PUNTEROS,
      cursor: args.cursor,
      maximumRowsRead: LOTE_PUNTEROS,
      maximumBytesRead: args.limiteBytesOverride ?? BYTES_POR_PAGINA_PUNTEROS,
    });
    exigirPaginaCompleta(pagina.pageStatus, "backfillUltimosDiagnosticos");

    let estampados = 0;
    let malformados = 0;
    for (const i of pagina.page) {
      // Solo los candidatos (enviado + numeroIntento===1) se miran; los demás ni cuentan.
      if (i.estado !== "enviado" || i.numeroIntento !== 1) continue;
      if (!esDiagnosticoElegible(i)) {
        malformados += 1;
        continue;
      }
      if (await upsertPunteroBackfill(ctx, i)) estampados += 1;
    }
    return {
      continueCursor: pagina.continueCursor,
      isDone: pagina.isDone,
      estampados,
      malformados,
    };
  },
});

/** Upsert de un diagnóstico elegible por `ganaPuntero`; devuelve si escribió (para contar).
 *  Mismo glue que `player.estamparPunteroDiagnostico`, ambos sobre el orden canónico. */
async function upsertPunteroBackfill(
  ctx: MutationCtx,
  intento: Doc<"intentos">,
): Promise<boolean> {
  const nuevo = { intentoId: intento._id, enviadoEn: intento.enviadoEn as number };
  const actual = await ctx.db
    .query("ultimosDiagnosticos")
    .withIndex("by_user", (q) => q.eq("alumnoId", intento.alumnoId))
    .first();
  if (!actual) {
    await ctx.db.insert("ultimosDiagnosticos", {
      alumnoId: intento.alumnoId,
      intentoId: nuevo.intentoId,
      enviadoEn: nuevo.enviadoEn,
    });
    return true;
  }
  const ganador = ganaPuntero(
    { intentoId: actual.intentoId, enviadoEn: actual.enviadoEn },
    nuevo,
  );
  if (
    ganador &&
    (ganador.intentoId !== actual.intentoId || ganador.enviadoEn !== actual.enviadoEn)
  ) {
    await ctx.db.patch(actual._id, {
      intentoId: ganador.intentoId,
      enviadoEn: ganador.enviadoEn,
    });
    return true;
  }
  return false;
}

/**
 * VERIFICADOR BIFÁSICO de `ultimosDiagnosticos` — una propiedad GLOBAL no se demuestra con
 * contadores locales de página. Cada llamada procesa UNA página de UNA fase y devuelve
 * `{siguiente: {fase, cursor} | null, discrepancias, malformados}`; el driver reinyecta
 * `{fase, cursor}` y SUMA hasta `siguiente === null`.
 *
 *  · **Fase 1 — intentos**: cada candidato elegible debe tener puntero de su alumna con
 *    tupla IGUAL o SUPERIOR (orden de `ganaPuntero`). No hace falta acumular máximos entre
 *    páginas: si el puntero domina a TODOS los candidatos (fase 1) y corresponde a uno real
 *    (fase 2), ES el máximo, sin importar cómo se repartieron las páginas.
 *  · **Fase 2 — punteros**: unicidad por alumna, no colgante, del MISMO dueño, elegible y
 *    con `enviadoEn` coincidente (frescura). Caza duplicado, colgante, ajeno, extra e
 *    inelegible; el «no-máximo» lo caza la fase 1.
 *
 * 0 discrepancias + 0 malformados en TODAS las páginas de AMBAS fases ⇒ el read-model es
 * exacto. `limiteBytesOverride` es SOLO-DEV (testigo de `SplitRequired`).
 */
export const verificarUltimosDiagnosticos = internalQuery({
  args: {
    fase: v.union(v.literal(1), v.literal(2)),
    cursor: v.union(v.string(), v.null()),
    limiteBytesOverride: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.limiteBytesOverride !== undefined) exigirDeploymentDeDesarrollo();

    if (args.fase === 1) {
      const pagina = await ctx.db.query("intentos").paginate({
        numItems: LOTE_PUNTEROS,
        cursor: args.cursor,
        maximumRowsRead: LOTE_PUNTEROS,
        maximumBytesRead: args.limiteBytesOverride ?? BYTES_POR_PAGINA_PUNTEROS,
      });
      exigirPaginaCompleta(pagina.pageStatus, "verificarUltimosDiagnosticos:fase1");

      let discrepancias = 0;
      let malformados = 0;
      for (const i of pagina.page) {
        if (i.estado !== "enviado" || i.numeroIntento !== 1) continue;
        if (!esDiagnosticoElegible(i)) {
          malformados += 1;
          continue;
        }
        const puntero = await ctx.db
          .query("ultimosDiagnosticos")
          .withIndex("by_user", (q) => q.eq("alumnoId", i.alumnoId))
          .first();
        if (!puntero) {
          discrepancias += 1; // candidato elegible sin puntero
          continue;
        }
        // El puntero debe DOMINAR a este candidato: ganaPuntero(puntero, candidato) === puntero.
        const ganador = ganaPuntero(
          { intentoId: puntero.intentoId, enviadoEn: puntero.enviadoEn },
          { intentoId: i._id, enviadoEn: i.enviadoEn as number },
        );
        if (!ganador || ganador.intentoId !== puntero.intentoId) discrepancias += 1;
      }
      const siguiente = pagina.isDone
        ? ({ fase: 2 as const, cursor: null })
        : ({ fase: 1 as const, cursor: pagina.continueCursor });
      return { siguiente, discrepancias, malformados };
    }

    // FASE 2 — punteros (documentos diminutos: sin presupuesto de bytes especial).
    const pagina = await ctx.db.query("ultimosDiagnosticos").paginate({
      numItems: LOTE_PUNTEROS,
      cursor: args.cursor,
      maximumRowsRead: LOTE_PUNTEROS,
    });
    exigirPaginaCompleta(pagina.pageStatus, "verificarUltimosDiagnosticos:fase2");

    let discrepancias = 0;
    for (const p of pagina.page) {
      // Unicidad por alumna (la sonda es independiente de la paginación: un duplicado
      // repartido entre páginas se detecta igual).
      const delMismo = await ctx.db
        .query("ultimosDiagnosticos")
        .withIndex("by_user", (q) => q.eq("alumnoId", p.alumnoId))
        .take(2);
      if (delMismo.length > 1) discrepancias += 1;

      const i = await ctx.db.get(p.intentoId);
      if (
        !i ||
        i.alumnoId !== p.alumnoId ||
        !esDiagnosticoElegible(i) ||
        i.enviadoEn !== p.enviadoEn
      ) {
        discrepancias += 1; // colgante / ajeno / inelegible / rancio
      }
    }
    const siguiente = pagina.isDone
      ? null
      : ({ fase: 2 as const, cursor: pagina.continueCursor });
    return { siguiente, discrepancias, malformados: 0 };
  },
});
