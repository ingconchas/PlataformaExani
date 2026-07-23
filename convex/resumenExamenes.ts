import { ConvexError, v, getConvexSize } from "convex/values";
import { query } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import {
  destinoDeFila,
  MAX_HISTORIAL_ASIGNACIONES_GRUPO,
} from "./asignacionDestino";
import {
  CATALOGO_BYTES_PANEL,
  MAX_GRUPOS_CATALOGO_PANEL,
  MAX_PERFILES_PANEL_POR_GRUPO,
  ROSTER_BYTES_PANEL,
} from "./participacion";
import {
  corteDePagina,
  excedePresupuestoDeCatalogo,
  type IntentoCrudoResultados,
  type SeccionId,
} from "./resultados";
import { leerIntentosParaAnalitica } from "./lecturasAnalitica";
import { primerIntentoPorAlumna, promedioDeAsignacion } from "./simulacro";
import {
  agregadoSeccionesResumen,
  filasDeGrupoResumen,
  MAX_SECCIONES_CIFRAS,
  PAGINA_BLOQUES,
  type FilaDeResumen,
  type GrupoDeCatalogo,
  type SeccionAgregadaResumen,
} from "./resumen";

/**
 * RESUMEN DE EXÁMENES APLICADOS — vista de la administradora (LUI-32). CUATRO queries, todas
 * `requireAdmin` (la pantalla es SOLO de admin — el drill-down a Resultados del examen
 * conserva su authz de LUI-30) y con ≤1 `.paginate()` cada una:
 *
 *  · `catalogo`   — el catálogo de grupos (ciclos, filtros y bloques salen de él, JAMÁS de
 *                   una ventana global). FAIL-CLOSED si desborda.
 *  · `bloquesDe`  — BATCHED: el historial aplicado de los ≤`PAGINA_BLOQUES` grupos de la
 *                   página visible, en UNA query (la sesión se paga una vez).
 *  · `rosterDe`   — los ids del roster activo del bloque EXPANDIDO (el «B» de «A de B»).
 *  · `cifrasDe`   — la agregación EN SERVIDOR de UNA fila (promedio + participación + aciertos
 *                   por sección). Payload SOLO cifras: cero intentos crudos al navegador.
 *
 * La paridad con Resultados del examen (LUI-30) es POR CONSTRUCCIÓN: `cifrasDe` computa con
 * `leerIntentosParaAnalitica` + `primerIntentoPorAlumna` + `promedioDeAsignacion` + los
 * agregados de `resumen.ts`, los MISMOS helpers de la pantalla del instructor.
 *
 * `Date.now()` no se usa: todo lo que lista es PASADO (aplicaciones ya con envíos); ningún
 * estado del reloj viaja.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Q-A · catalogo — grupos/ciclos (fuente única de bloques y filtros)
// ─────────────────────────────────────────────────────────────────────────────

type CatalogoResumen = {
  grupos: GrupoDeCatalogo[];
  problema: "catalogo" | null;
};

/**
 * El catálogo de grupos, en un paginate byte-capped (la tabla no tiene índices; strings sin
 * cota ⇒ tope de bytes obligatorio, precedente `panel.grupos`). Corte → FAIL-CLOSED: sin
 * catálogo no hay ciclos ni bloques.
 *
 * PRESUPUESTO: rangos ~3 (2 requireAdmin + 1 paginate) · docs ≤203 · bytes sesión ≤2 MiB +
 * catálogo ≤`CATALOGO_BYTES_PANEL` ⇒ <4.6 MiB.
 */
export const catalogo = query({
  args: {},
  handler: async (ctx): Promise<CatalogoResumen> => {
    await requireAdmin(ctx);
    const pagina = await ctx.db.query("grupos").paginate({
      numItems: MAX_GRUPOS_CATALOGO_PANEL + 1,
      cursor: null,
      maximumRowsRead: MAX_GRUPOS_CATALOGO_PANEL + 1,
      maximumBytesRead: CATALOGO_BYTES_PANEL,
    });
    if (
      corteDePagina({
        numFilas: pagina.page.length,
        isDone: pagina.isDone,
        cap: MAX_GRUPOS_CATALOGO_PANEL,
      })
    ) {
      return { grupos: [], problema: "catalogo" };
    }
    return {
      grupos: pagina.page.map((g) => ({
        grupoId: g._id,
        nombre: g.nombre,
        ciclo: g.ciclo ?? null,
        turno: g.turno ?? null,
        activo: g.activo,
      })),
      problema: null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-B · bloquesDe — historial aplicado de los grupos de la página (BATCHED)
// ─────────────────────────────────────────────────────────────────────────────

type BloqueDeGrupo = { filas: FilaDeResumen[]; problema: "asignaciones" | null };
type BloquesResumen = { porGrupo: Record<string, BloqueDeGrupo> };

/**
 * Las asignaciones APLICADAS de cada grupo de la página, en UNA query (la sesión se paga una
 * sola vez). No re-lee los docs de grupo: viajan en `catalogo`; el cliente une por id e
 * ignora ids fuera de su snapshot del catálogo (costura por snapshot — el catálogo y este
 * batch pueden diferir un tick, sin fabricar nada).
 *
 * Frontera de args: ≤`PAGINA_BLOQUES` ids y SIN duplicados (precedente `validarDestinoCrudo`)
 * — diez repeticiones del mismo id serían diez lecturas y un Record que se sobrescribe.
 *
 * PRESUPUESTO: rangos ~2 (requireAdmin) + ≤10 (un take por grupo) = ≤12 · docs ≤2 + ≤10 × 101
 * = ≤1,012 · bytes sesión ≤2 MiB + 10 × ~0.15 MiB (asignaciones acotadas por escritura) ⇒
 * <3.6 MiB.
 */
export const bloquesDe = query({
  args: { grupoIds: v.array(v.id("grupos")) },
  handler: async (ctx, args): Promise<BloquesResumen> => {
    await requireAdmin(ctx);
    if (args.grupoIds.length > PAGINA_BLOQUES) {
      throw new ConvexError("Se solicitaron demasiados bloques a la vez.");
    }
    if (new Set(args.grupoIds).size !== args.grupoIds.length) {
      throw new ConvexError("La lista de bloques tiene grupos repetidos.");
    }
    const porGrupo: Record<string, BloqueDeGrupo> = {};
    for (const grupoId of args.grupoIds) {
      const escaneadas = await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo", (q) => q.eq("grupoId", grupoId))
        .take(MAX_HISTORIAL_ASIGNACIONES_GRUPO + 1);
      const { filas, incompleto } = filasDeGrupoResumen(
        escaneadas.map((a) => ({
          asignacionId: a._id,
          examenId: a.examenId,
          titulo: a.tituloExamen ?? null,
          abreEn: a.abreEn,
          envioRegistradoEn: a.envioRegistradoEn,
        })),
      );
      porGrupo[grupoId] = incompleto
        ? { filas: [], problema: "asignaciones" }
        : { filas, problema: null };
    }
    return { porGrupo };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-C · rosterDe — el «B» de «A de B» del bloque expandido
// ─────────────────────────────────────────────────────────────────────────────

type RosterDeGrupo = {
  alumnoIds: Id<"users">[];
  deTotal: number;
  problema: "roster" | null;
};

/**
 * Los ids del roster ACTIVO de un grupo (payload = ids + conteo, nada de perfiles). Un
 * paginate byte-capped (patrón `panel.alumnos`); corte → `problema: "roster"`. Grupo
 * inexistente entre snapshots → `null` (el cliente lo trata como no disponible).
 *
 * PRESUPUESTO: rangos ~4 · docs ≤2 + 1 + ≤201 = ≤204 · bytes sesión ≤2 MiB + grupo ≤1 MiB +
 * roster ≤`ROSTER_BYTES_PANEL` ⇒ <3.3 MiB.
 */
export const rosterDe = query({
  args: { grupoId: v.id("grupos") },
  handler: async (ctx, args): Promise<RosterDeGrupo | null> => {
    await requireAdmin(ctx);
    const grupo = await ctx.db.get(args.grupoId);
    if (!grupo) return null;
    const pagina = await ctx.db
      .query("perfiles")
      .withIndex("by_grupo", (q) => q.eq("grupoId", args.grupoId))
      .paginate({
        numItems: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        cursor: null,
        maximumRowsRead: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        maximumBytesRead: ROSTER_BYTES_PANEL,
      });
    if (
      corteDePagina({
        numFilas: pagina.page.length,
        isDone: pagina.isDone,
        cap: MAX_PERFILES_PANEL_POR_GRUPO,
      })
    ) {
      return { alumnoIds: [], deTotal: 0, problema: "roster" };
    }
    const activas = pagina.page.filter((p) => p.rol === "alumno" && p.activo);
    return {
      alumnoIds: activas.map((p) => p.userId),
      deTotal: activas.length,
      problema: null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-D · cifrasDe — agregación EN SERVIDOR de UNA fila (payload solo-cifras)
// ─────────────────────────────────────────────────────────────────────────────

type CifrasDeAsignacion = {
  titulo: string | null;
  promedio: number | null;
  secciones: SeccionAgregadaResumen[];
  sinDesglose: number;
  enviadasAlumnoIds: Id<"users">[];
  problema: "intentos" | "clasificaciones" | null;
};

/** Proyección de un intento a la forma analítica pura (SOLO el contrato de
 *  `IntentoCrudoResultados`; jamás `_id`, `respuestas` ni estados de reloj). */
function proyectar(d: Doc<"intentos">): IntentoCrudoResultados {
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

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Promedio, participación (ids de las enviadas) y aciertos por SECCIÓN de UNA asignación,
 * agregados EN SERVIDOR — el payload solo transporta cifras + ids (≤ ~20 KiB), nunca los
 * intentos crudos. Los MISMOS helpers de LUI-30 ⇒ cifras idénticas por construcción.
 *
 * Solo se resuelven SECCIONES (jamás áreas), con cota `MAX_SECCIONES_CIFRAS` (240, derivada
 * de `MAX_REACTIVOS`) y paro por bytes en los gets de nombres (`CATALOGO_CLASIF_BYTES`).
 * Filas-alumno → `null` (individual, no listada); grupo/examen borrados se toleran (título y
 * nombres a `null`, jamás un valor inventado).
 *
 * PRESUPUESTO: rangos ≤2 + 2 (helper) + ≤240 (gets de secciones) ≈ ≤250 · docs ≤ ~1,050 ·
 * bytes sesión 2 + gets 3 + intentos ≤6 + legado ~0.16 + secciones ≤0.5 (paro) ⇒ <12.7 MiB.
 */
export const cifrasDe = query({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args): Promise<CifrasDeAsignacion | null> => {
    await requireAdmin(ctx);
    const asignacion = await ctx.db.get(args.asignacionId);
    if (!asignacion) return null;
    const destino = destinoDeFila(asignacion);
    if (destino.tipo !== "grupo") return null;
    const grupo = await ctx.db.get(destino.grupoId);
    if (!grupo) return null;

    const examen = await ctx.db.get(asignacion.examenId);
    const titulo = asignacion.tituloExamen ?? examen?.titulo ?? null;
    const ordenSecciones = examen?.secciones?.map((s) => s.seccionId) ?? [];

    const base: CifrasDeAsignacion = {
      titulo,
      promedio: null,
      secciones: [],
      sinDesglose: 0,
      enviadasAlumnoIds: [],
      problema: null,
    };

    const lectura = await leerIntentosParaAnalitica(ctx, asignacion._id);
    if (lectura.corte) return { ...base, problema: "intentos" };

    const diagnosticos = lectura.diagnosticos.map(proyectar);
    const legado = lectura.legado.map(proyectar);

    const seleccion = primerIntentoPorAlumna(diagnosticos, legado);
    const seleccionados = [...seleccion.values()];
    const enviadasAlumnoIds = seleccionados
      .filter((i) => i.estado === "enviado")
      .map((i) => i.alumnoId);

    const promedio = promedioDeAsignacion({
      diagnosticos,
      legado,
      desbordado: false,
    });

    const { porSeccion, sinDesglose } = agregadoSeccionesResumen(seleccionados);
    const seccionIds = [...porSeccion.keys()];
    if (seccionIds.length > MAX_SECCIONES_CIFRAS) {
      return { ...base, problema: "clasificaciones" };
    }

    // Resolver nombres de sección con acumulador de bytes y paro temprano.
    let acumulado = 0;
    const resueltas = new Map<
      SeccionId,
      { nombre: string | null; orden: number | null }
    >();
    for (const seccionId of seccionIds) {
      const doc = await ctx.db.get(seccionId);
      acumulado += doc ? getConvexSize(doc) : 0;
      if (excedePresupuestoDeCatalogo(acumulado)) {
        return { ...base, problema: "clasificaciones" };
      }
      resueltas.set(seccionId, {
        nombre: doc?.nombre ?? null,
        orden: doc?.orden ?? null,
      });
    }

    // Orden de presentación: las secciones DECLARADAS del examen primero (en su orden), luego
    // el resto por `orden` del catálogo (null al final) → id — la MISMA regla que `columnas`
    // de LUI-30.
    const declaradas = ordenSecciones.filter((id) => porSeccion.has(id));
    const restantes = seccionIds
      .filter((id) => !ordenSecciones.includes(id))
      .sort((x, y) => {
        const ox = resueltas.get(x)?.orden ?? Number.POSITIVE_INFINITY;
        const oy = resueltas.get(y)?.orden ?? Number.POSITIVE_INFINITY;
        return ox !== oy ? ox - oy : cmpId(x, y);
      });
    const ordenFinal = [...new Set([...declaradas, ...restantes])];

    const secciones: SeccionAgregadaResumen[] = ordenFinal.map((seccionId) => {
      const agg = porSeccion.get(seccionId) as NonNullable<
        ReturnType<typeof porSeccion.get>
      >;
      const r = resueltas.get(seccionId);
      return {
        seccionId,
        nombre: r?.nombre ?? null,
        sumaAciertos: agg.sumaAciertos,
        sumaTotales: agg.sumaTotales,
        k: agg.k,
        totalComun: agg.totalComun,
      };
    });

    return { ...base, promedio: promedio.valor, secciones, sinDesglose, enviadasAlumnoIds };
  },
});
