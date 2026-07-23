import { v, getConvexSize } from "convex/values";
import { query } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { type QueryCtx } from "./_generated/server";
import { requireStaff } from "./authz";
import { destinoDeFila, MAX_ASIGNACIONES_POR_EXAMEN } from "./asignacionDestino";
import {
  CATALOGO_BYTES_PANEL,
  MAX_GRUPOS_CATALOGO_PANEL,
  MAX_GRUPOS_POR_INSTRUCTOR,
  MAX_PERFILES_PANEL_POR_GRUPO,
  ROSTER_BYTES_PANEL,
} from "./participacion";
import {
  clasificacionesDistintas,
  corteDePagina,
  excedePresupuestoDeCatalogo,
  type AsignacionDeResultados,
  type CatalogoClasificaciones,
  type ResultadosQ1,
  type ResultadosQ2,
  type ResultadosQ3,
} from "./resultados";
import { leerIntentosParaAnalitica, proyectarIntento } from "./lecturasAnalitica";
import { fechaCortaConAnioMx } from "./fechas";

/**
 * RESULTADOS DEL EXAMEN — vista del instructor y gemela admin (LUI-30 · LUI-31 integrada).
 * TRES queries, no una: Convex admite UN `.paginate()` por ejecución, y esta pantalla
 * necesita tres lecturas byte-capped independientes — el catálogo de grupos (Q1), el roster
 * (Q2) y los diagnósticos con desglose (Q3, vía `lecturasAnalitica`). Precedente directo:
 * `panelInstructor.ts` («TRES queries, no una», LUI-19).
 *
 * ══ AUTORIZACIÓN (hallazgo M3 del 1er dictamen del plan) ══ `requireStaff` + relación
 * PERSISTENTE: instructor ⇒ unión en `grupoInstructores` y el grupo EXISTE — `activo` NO se
 * exige (esa política es del panel operativo): cerrar el ciclo no puede costarle a
 * Alejandro su histórico de resultados. `grupoActivo` viaja solo como rótulo. Admin ve todo
 * (la variante solo-lectura es del frontend). Cada query valida su acceso COMPLETO por su
 * cuenta — ninguna confía en que solo la monte la pantalla.
 *
 * ══ DESTINOS ══ JAMÁS se consulta `eq("grupoId", undefined)` (la fuga documentada en
 * player.ts); Q1 selecciona por `by_examen_abre` y cada fila se interpreta con
 * `destinoDeFila`. Las filas-alumno (LUI-22) quedan FUERA de v1 por decisión de producto:
 * viaja solo su CONTEO (`individualesOmitidas`), sin PII.
 *
 * ══ RELOJ ══ Cada query muestrea `Date.now()` UNA vez y devuelve fronteras CRUDAS; NADA
 * derivado del reloj se estampa (`fechaAbre` es formateo de un dato persistido, no un
 * estado temporal). La partición programada/elegible y el estado «No contestó» los deriva
 * el CLIENTE con su reloj anclado (`resultados.derivarSelectorResultados` /
 * `derivarResultados`).
 */

function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/**
 * Escalera de acceso COMPARTIDA de Q2/Q3: asignación existe → destino GRUPO (una
 * fila-alumno, aunque el id llegue fabricado, es `null`: el selector jamás la ofreció) →
 * membresía del instructor (sonda acotada; si el legado la satura, el grupo puede no estar
 * entre las 101 y se niega — Q1 ya reporta `membresia`) → el grupo EXISTE (basta: histórico
 * sobrevive al cierre). Cualquier fallo → `null`, indistinguible de «no existe» (política
 * de no-enumeración, como `panelInstructor.participacionDeGrupo`).
 */
async function autorizarAsignacionDeGrupo(
  ctx: QueryCtx,
  asignacionId: Id<"asignaciones">,
): Promise<{
  esAdmin: boolean;
  asignacion: Doc<"asignaciones">;
  grupo: Doc<"grupos">;
} | null> {
  const sesion = await requireStaff(ctx);
  const esAdmin = sesion.perfil.rol === "admin";

  const asignacion = await ctx.db.get(asignacionId);
  if (!asignacion) return null;
  const destino = destinoDeFila(asignacion);
  if (destino.tipo !== "grupo") return null;

  if (!esAdmin) {
    const uniones = await ctx.db
      .query("grupoInstructores")
      .withIndex("by_instructor", (q) => q.eq("instructorId", sesion.userId))
      .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
    if (!uniones.some((u) => u.grupoId === destino.grupoId)) return null;
  }

  const grupo = await ctx.db.get(destino.grupoId);
  if (!grupo) return null;

  return { esAdmin, asignacion, grupo };
}


/**
 * Q1 — encabezado + selector: el examen y TODAS sus asignaciones de grupo, CRUDAS
 * (programadas incluidas — el cliente particiona con `derivarSelectorResultados`).
 * Instructor: solo las de sus grupos (por unión, sin exigir `activo`); ningún nombre ni id
 * ajeno viaja — `ajenasOmitidas` es solo un conteo. Ante cualquier corte responde con
 * `problema` y arreglos VACÍOS (pantalla de LECTURA: estado de problema, no throw — difiere
 * a propósito de `exigirMembresiaSana`, que protege flujos de escritura).
 *
 * PRESUPUESTO CONTRACTUAL (peor caso bajo las cotas; límites 4,096 rangos · 32,000 docs ·
 * 16 MiB · 1 MiB/doc):
 *  · Rangos: 2 (requireStaff) + 1 (uniones take 101) + 1 (paginate catálogo) +
 *    1 (take 601) = **5 ≪ 4,096**.
 *  · Docs: ~2 + 1 (examen) + ≤101 + ≤201 + ≤601 = **≤906 ≪ 32,000**.
 *  · Bytes: sesión ≤2 MiB (2 × 1 MiB duro) + examen ≤1 MiB + uniones ~10 KiB + catálogo
 *    ≤`CATALOGO_BYTES_PANEL` (512 KiB, runtime) + 601 asignaciones de forma acotada POR
 *    ESCRITURA (`tituloExamen` ≤160 ⇒ ~0.7 KiB c/u ≈ 0.42 MiB) ⇒ **<4 MiB ≪ 16 MiB**.
 */
export const deExamen = query({
  args: { examenId: v.string() },
  handler: async (ctx, args): Promise<ResultadosQ1 | null> => {
    const sesion = await requireStaff(ctx);
    const esAdmin = sesion.perfil.rol === "admin";
    const ahora = Date.now();

    const id = ctx.db.normalizeId("examenes", args.examenId);
    if (!id) return null;
    const examen = await ctx.db.get(id);
    if (!examen) return null;

    const base: ResultadosQ1 = {
      ahoraServidor: ahora,
      esAdmin,
      examen: { id: examen._id, titulo: examen.titulo, estado: examen.estado },
      asignaciones: [],
      individualesOmitidas: 0,
      ajenasOmitidas: 0,
      problema: null,
    };

    const misGrupos = new Set<Id<"grupos">>();
    if (!esAdmin) {
      const uniones = await ctx.db
        .query("grupoInstructores")
        .withIndex("by_instructor", (q) => q.eq("instructorId", sesion.userId))
        .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
      if (uniones.length > MAX_GRUPOS_POR_INSTRUCTOR) {
        return { ...base, problema: "membresia" };
      }
      for (const u of uniones) misGrupos.add(u.grupoId);
    }

    // El ÚNICO paginate de esta query: el catálogo de grupos, para nombres y actividad en
    // una lectura (jamás N gets de 1 MiB) — mismo patrón y mismas cotas que Q1 de LUI-19.
    const catalogo = await ctx.db.query("grupos").paginate({
      numItems: MAX_GRUPOS_CATALOGO_PANEL + 1,
      cursor: null,
      maximumRowsRead: MAX_GRUPOS_CATALOGO_PANEL + 1,
      maximumBytesRead: CATALOGO_BYTES_PANEL,
    });
    if (
      corteDePagina({
        numFilas: catalogo.page.length,
        isDone: catalogo.isDone,
        cap: MAX_GRUPOS_CATALOGO_PANEL,
      })
    ) {
      return { ...base, problema: "catalogo" };
    }
    const grupoPorId = new Map(catalogo.page.map((g) => [g._id, g]));

    // Orden `abreEn` desc del índice — el mismo contrato del selector. El take(601) es el
    // centinela de la frontera de escritura `MAX_ASIGNACIONES_POR_EXAMEN`: >600 solo puede
    // ser legado anterior a la cota ⇒ problema explícito, jamás un selector parcial.
    const filas = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen_abre", (q) => q.eq("examenId", id))
      .order("desc")
      .take(MAX_ASIGNACIONES_POR_EXAMEN + 1);
    if (filas.length > MAX_ASIGNACIONES_POR_EXAMEN) {
      return { ...base, problema: "asignaciones" };
    }

    const asignaciones: AsignacionDeResultados[] = [];
    let individualesOmitidas = 0;
    let ajenasOmitidas = 0;
    for (const f of filas) {
      const destino = destinoDeFila(f);
      if (destino.tipo === "alumno") {
        individualesOmitidas += 1;
        continue;
      }
      if (!esAdmin && !misGrupos.has(destino.grupoId)) {
        ajenasOmitidas += 1;
        continue;
      }
      const g = grupoPorId.get(destino.grupoId);
      asignaciones.push({
        asignacionId: f._id,
        grupoId: destino.grupoId,
        grupoNombre: g?.nombre ?? null,
        grupoActivo: g?.activo ?? false,
        abreEn: f.abreEn,
        cierraEn: f.cierraEn,
        fechaAbre: fechaCortaConAnioMx(f.abreEn),
      });
    }

    return { ...base, asignaciones, individualesOmitidas, ajenasOmitidas };
  },
});

/**
 * Q2 — el ROSTER de la asignación seleccionada: el Y de «X de Y» y las filas de la tabla.
 * Fronteras crudas (`abreEn`/`cierraEn`) para que el cliente derive «No contestó» al cruzar
 * el cierre. Ante corte del roster → `problema: "roster"` SIN alumnas (jamás un Y
 * fabricado).
 *
 * PRESUPUESTO: rangos 2 + 1 (uniones) + 1 (paginate roster) = **4** · docs ~2 + 1
 * (asignación) + ≤101 + 1 (grupo) + ≤201 = **≤306** · bytes sesión 2 MiB + asignación
 * ≤1 MiB + uniones ~10 KiB + grupo ≤1 MiB + roster ≤`ROSTER_BYTES_PANEL` (256 KiB,
 * runtime) ⇒ **<4.3 MiB ≪ 16 MiB**.
 */
export const deAsignacion = query({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args): Promise<ResultadosQ2 | null> => {
    const acceso = await autorizarAsignacionDeGrupo(ctx, args.asignacionId);
    if (!acceso) return null;
    const { asignacion, grupo } = acceso;
    const ahora = Date.now();

    const base: ResultadosQ2 = {
      ahoraServidor: ahora,
      grupoId: grupo._id,
      grupoNombre: grupo.nombre,
      grupoActivo: grupo.activo,
      tituloExamen: asignacion.tituloExamen ?? null,
      numReactivos: asignacion.numReactivos ?? null,
      abreEn: asignacion.abreEn,
      cierraEn: asignacion.cierraEn,
      alumnas: [],
      problema: null,
    };

    // El ÚNICO paginate: roster con tope de filas Y bytes (patrón Q2 de LUI-19; la cota
    // cuenta PERFILES del índice, inactivos incluidos — protege la lectura).
    const roster = await ctx.db
      .query("perfiles")
      .withIndex("by_grupo", (q) => q.eq("grupoId", grupo._id))
      .paginate({
        numItems: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        cursor: null,
        maximumRowsRead: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        maximumBytesRead: ROSTER_BYTES_PANEL,
      });
    if (
      corteDePagina({
        numFilas: roster.page.length,
        isDone: roster.isDone,
        cap: MAX_PERFILES_PANEL_POR_GRUPO,
      })
    ) {
      return { ...base, problema: "roster" };
    }

    const alumnas = roster.page
      .filter((p) => p.rol === "alumno" && p.activo)
      .map((p) => ({ alumnoId: p.userId, nombre: nombreCompleto(p) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return { ...base, alumnas };
  },
});

/**
 * Q3 — los intentos-para-analítica de la asignación (diagnósticos + legado, SEPARADOS: los
 * dos argumentos del selector canónico) + el catálogo de nombres de las clasificaciones
 * estampadas. La lectura pesada va por `lecturasAnalitica.leerIntentosParaAnalitica` — LA
 * MISMA función que usará `panel.promedioDe` (paridad de poblaciones y cortes por
 * construcción). Todo corte es FAIL-CLOSED sin datos: `problema: "intentos"` (filas o bytes
 * del paginate; contrato anti-prefijo de `promedioDeAsignacion`) o
 * `problema: "clasificaciones"` (conjunto distinto > 500, o el presupuesto de bytes del
 * catálogo agotado a media resolución).
 *
 * ══ CATÁLOGO CON PARO TEMPRANO (hallazgo M3 del 2º dictamen) ══ Los `ctx.db.get` de
 * secciones/áreas se hacen en secuencia ACUMULANDO `getConvexSize(doc)`; al superar
 * `CATALOGO_CLASIF_BYTES` se DEJA DE LEER — el peor caso leído es 512 KiB + el doc que
 * cruza (≤1 MiB). Un get nulo produce `{id, nombre: null}` (fantasma honesto — la cubeta
 * «Sin clasificación vigente» del cliente, jamás «Módulo: undefined»).
 *
 * PRESUPUESTO: lecturas = 2 (requireStaff) + 1 (uniones) + 2 (helper: paginate + take) +
 * ~3 gets (asignación/grupo/examen) + ≤500 gets del catálogo ≈ **≤508 ≪ 4,096** · docs
 * ~2 + ≤101 + 3 + ≤802 + ≤500 = **≤1,408 ≪ 32,000** · bytes sesión 2 MiB + asignación
 * ≤1 MiB + grupo ≤1 MiB + examen ≤1 MiB + uniones ~10 KiB + diagnósticos ≤6 MiB (runtime)
 * + legado ~160 KiB (invariante temporal) + catálogo ≤1.5 MiB (paro temprano) ⇒
 * **<12.7 MiB ≪ 16 MiB**.
 */
export const intentosDe = query({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args): Promise<ResultadosQ3 | null> => {
    const acceso = await autorizarAsignacionDeGrupo(ctx, args.asignacionId);
    if (!acceso) return null;
    const { asignacion } = acceso;
    const ahora = Date.now();

    // SOLO para el orden declarado de columnas (LUI-21); examen borrado → null (las
    // columnas caen al orden del catálogo — jamás se inventa).
    const examen = await ctx.db.get(asignacion.examenId);
    const ordenSecciones =
      examen?.secciones?.map((s) => s.seccionId) ?? null;

    const base: ResultadosQ3 = {
      ahoraServidor: ahora,
      ordenSecciones,
      diagnosticos: [],
      legado: [],
      catalogo: { secciones: [], areas: [] },
      problema: null,
    };

    const lectura = await leerIntentosParaAnalitica(ctx, asignacion._id);
    if (lectura.corte) return { ...base, problema: "intentos" };

    const diagnosticos = lectura.diagnosticos.map(proyectarIntento);
    const legado = lectura.legado.map(proyectarIntento);

    const clas = clasificacionesDistintas(diagnosticos, legado, ordenSecciones);
    if (clas.desbordado) return { ...base, problema: "clasificaciones" };

    let acumulado = 0;
    const catalogo: CatalogoClasificaciones = { secciones: [], areas: [] };
    for (const seccionId of clas.seccionIds) {
      const doc = await ctx.db.get(seccionId);
      acumulado += doc ? getConvexSize(doc) : 0;
      if (excedePresupuestoDeCatalogo(acumulado)) {
        return { ...base, problema: "clasificaciones" };
      }
      catalogo.secciones.push({
        seccionId,
        nombre: doc?.nombre ?? null,
        orden: doc?.orden ?? null,
      });
    }
    for (const areaId of clas.areaIds) {
      const doc = await ctx.db.get(areaId);
      acumulado += doc ? getConvexSize(doc) : 0;
      if (excedePresupuestoDeCatalogo(acumulado)) {
        return { ...base, problema: "clasificaciones" };
      }
      catalogo.areas.push({
        areaId,
        nombre: doc?.nombre ?? null,
        orden: doc?.orden ?? null,
        seccionId: doc?.seccionId ?? null,
      });
    }

    return { ...base, diagnosticos, legado, catalogo };
  },
});
