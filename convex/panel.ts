import { v } from "convex/values";
import { query } from "./_generated/server";
import { destinoDeFila } from "./asignacionDestino";
import { requireAdmin } from "./authz";
import { fechaCortaMx, fechaLargaMx, inicioDeMesMx } from "./fechas";
import { promedioDeAsignacion } from "./simulacro";
import {
  ALUMNOS_BYTES_PANEL,
  MAX_ALUMNOS_CONTEO_PANEL,
  MAX_APLICADAS_MES_PANEL,
  SCAN_ULTIMOS_PANEL,
  contarAplicadasMes,
  ultimosAplicados,
} from "./metricas";
import {
  CATALOGO_BYTES_PANEL,
  MAX_GRUPOS_CATALOGO_PANEL,
} from "./participacion";
import { corteDePagina } from "./resultados";
import { leerIntentosParaAnalitica } from "./lecturasAnalitica";

/**
 * PANEL DE LA ADMINISTRADORA (LUI-9), migrado por LUI-30 a **CUATRO queries, no una** —
 * la misma lección que partió el panel del instructor (LUI-19): Convex admite UN
 * `.paginate()` por ejecución, y este panel necesita varios con `maximumBytesRead`
 * (catálogo de grupos, censo de alumnas) porque `grupos.nombre` y los strings de
 * `perfiles` no tienen tope de longitud — el viejo `.collect()` de ambos no tenía
 * presupuesto defendible sobre el dominio VÁLIDO (hallazgo M2 del 2º dictamen del plan
 * LUI-30). El cliente une con `useQueries` (contrato de 4 estados, patrón LUI-19).
 *
 * ══ «APLICADA» (migración LUI-30) ══ ya NO es «la ventana abrió»: es «tiene al menos un
 * intento enviado», el predicado PURO de `metricas.fueAplicada` sobre el read-model
 * `envioRegistradoEn` (backfill verificado en prod). El rango de `by_abre` de abajo solo
 * ACOTA el periodo; aplicada se decide fila a fila sobre los docs ya leídos — cero
 * lecturas extra, cero sondas.
 *
 * ══ PROMEDIOS ══ salieron de `resumen` (hallazgo M1 del 1er dictamen: 5 asignaciones ×
 * 802 intentos con desglose ≈ 39 MiB contractuales dentro de ESTA transacción): cada
 * fila de «Últimos aplicados» pide el suyo a `promedioDe` vía `useQueries` — que lee con
 * el MISMO helper byte-capped que Q3 de Resultados (`lecturasAnalitica`), así que el
 * panel y LUI-30 no pueden dar dos números para la misma asignación.
 */

/**
 * Q1 — encabezado + métrica del mes + «Últimos exámenes aplicados» (SIN promedios).
 *
 * PRESUPUESTO CONTRACTUAL (peor caso bajo cotas; 4,096 rangos · 32,000 docs · 16 MiB):
 *  · Rangos: 2 (requireAdmin) + 1 (mes take 201) + 1 (scan take 30) = **4**.
 *  · Docs: ~2 + ≤201 + ≤30 + ≤10 gets de hidratación (5 filas × examen+grupo) = **≤243**.
 *  · Bytes: sesión ≤2 MiB + ≤231 asignaciones de forma acotada POR ESCRITURA
 *    (`tituloExamen` ≤160 ⇒ ~0.7 KiB c/u ≈ 0.16 MiB) + ≤10 gets × 1 MiB (límite duro
 *    por doc) ⇒ **<12.3 MiB ≪ 16 MiB** — por primera vez honesto en las 3 dimensiones.
 */
export const resumen = query({
  args: {},
  handler: async (ctx) => {
    const { perfil } = await requireAdmin(ctx);

    // UNA sola lectura del reloj (el runtime la congela) alimenta la fecha del
    // encabezado Y el rango del mes: imposible que el encabezado diga «1 de agosto»
    // mientras la métrica cuenta julio.
    const ahora = Date.now();
    const inicioMes = inicioDeMesMx(ahora);

    // «Exámenes aplicados este mes»: el rango ACOTA el periodo (abrió dentro del mes,
    // tope `ahora` — una programada para el 28 no está aplicada el día 6); «aplicada»
    // la decide `fueAplicada` fila a fila DENTRO de `contarAplicadasMes`. El centinela
    // `take(MAX + 1)` lleno ⇒ `{valor: null, incompleto}` — jamás el conteo del prefijo.
    const delMes = await ctx.db
      .query("asignaciones")
      .withIndex("by_abre", (q) =>
        q.gte("abreEn", inicioMes).lte("abreEn", ahora),
      )
      .take(MAX_APLICADAS_MES_PANEL + 1);
    const aplicadasMes = contarAplicadasMes(delMes);

    // «Últimos aplicados»: se ESCANEA una ventana acotada del índice (desc) y se toman
    // los 5 primeros APLICADOS. Ventana agotada con <5 ⇒ `ultimosIncompletos` (puede
    // haber aplicaciones más antiguas sin listar) — la UI lo enuncia.
    const escaneadas = await ctx.db
      .query("asignaciones")
      .withIndex("by_abre", (q) => q.lte("abreEn", ahora))
      .order("desc")
      .take(SCAN_ULTIMOS_PANEL);
    const ultimos = ultimosAplicados(escaneadas);

    // Hidratación de ≤5 filas (N+1 acotado por construcción). SIN promedios: cada fila
    // los pide a `promedioDe` desde el cliente.
    const ultimosExamenes = await Promise.all(
      ultimos.filas.map(async (a) => {
        // El destino se interpreta SOLO vía `destinoDeFila` (invariante XOR de LUI-22).
        const destino = destinoDeFila(a);
        const [examen, grupo] = await Promise.all([
          ctx.db.get(a.examenId),
          destino.tipo === "grupo"
            ? ctx.db.get(destino.grupoId)
            : Promise.resolve(null),
        ]);
        return {
          id: a._id,
          examen: examen?.titulo ?? "Examen eliminado",
          grupo:
            destino.tipo === "alumno"
              ? "Asignación individual"
              : (grupo?.nombre ?? "Grupo eliminado"),
          fecha: fechaCortaMx(a.abreEn),
          fechaMs: a.abreEn,
        };
      }),
    );

    return {
      // Nombre de PILA para el saludo («Hola, Mayra»).
      nombre: perfil.nombre,
      // Formateada en el SERVIDOR: la zona (America/Mexico_City) es regla del PRD, no
      // preferencia del dispositivo.
      fechaLarga: fechaLargaMx(ahora),
      metricas: {
        examenesAplicadosMes: aplicadasMes.valor,
        aplicadasMesIncompleto: aplicadasMes.incompleto,
      },
      ultimosExamenes,
      ultimosIncompletos: ultimos.incompleto,
    };
  },
});

/**
 * Q2 — conteo de GRUPOS activos. Su propio paginate byte-capped (mismas cotas que el
 * catálogo del panel del instructor): `grupos.nombre` no tiene tope de longitud, así que
 * el corte protege la LECTURA. Corte → `{gruposActivos: null, incompleto: true}` — la UI
 * muestra «—» con nota, jamás el conteo de un prefijo.
 *
 * PRESUPUESTO: rangos 2 + 1 = **3** · docs ~2 + ≤201 = **≤203** · bytes 2 MiB +
 * ≤`CATALOGO_BYTES_PANEL` (512 KiB, runtime) ⇒ **<2.6 MiB**.
 */
export const grupos = query({
  args: {},
  handler: async (ctx) => {
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
      return { gruposActivos: null, incompleto: true };
    }
    return {
      gruposActivos: pagina.page.filter((g) => g.activo).length,
      incompleto: false,
    };
  },
});

/**
 * Q3 — censo de ALUMNAS registradas (activas, según define el issue de LUI-9: una
 * alumna dada de baja ya no es alumnado). Su propio paginate byte-capped sobre
 * `perfiles.by_rol`: los strings del perfil no tienen tope de longitud contractual.
 * Corte → `{alumnosRegistrados: null, incompleto: true}` — jamás un prefijo.
 *
 * PRESUPUESTO: rangos 2 + 1 = **3** · docs ~2 + ≤2,001 = **≤2,003** · bytes 2 MiB +
 * ≤`ALUMNOS_BYTES_PANEL` (1 MiB, runtime) ⇒ **<3.1 MiB**.
 */
export const alumnos = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const pagina = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .paginate({
        numItems: MAX_ALUMNOS_CONTEO_PANEL + 1,
        cursor: null,
        maximumRowsRead: MAX_ALUMNOS_CONTEO_PANEL + 1,
        maximumBytesRead: ALUMNOS_BYTES_PANEL,
      });
    if (
      corteDePagina({
        numFilas: pagina.page.length,
        isDone: pagina.isDone,
        cap: MAX_ALUMNOS_CONTEO_PANEL,
      })
    ) {
      return { alumnosRegistrados: null, incompleto: true };
    }
    return {
      alumnosRegistrados: pagina.page.filter((p) => p.activo).length,
      incompleto: false,
    };
  },
});

/**
 * Q4 — el PROMEDIO de una asignación (regla del primer intento, LUI-104), pedido por
 * fila desde el cliente vía `useQueries`. Lee con `lecturasAnalitica` — EL MISMO helper
 * byte-capped de Q3 de Resultados del examen (LUI-30): mismas poblaciones, mismos
 * cortes, misma `promedioDeAsignacion` ⇒ paridad de cifras por construcción. Asignación
 * inexistente → `null` (fila borrada entre snapshots).
 *
 * PRESUPUESTO: rangos 2 + 1 (get) + 2 (helper) = **5** · docs ~2 + 1 + ≤802 = **≤805** ·
 * bytes 2 MiB + 1 MiB (asignación) + ≤6 MiB (paginate, runtime) + ~160 KiB (legado,
 * invariante temporal de `lecturasAnalitica`) ⇒ **<9.3 MiB**.
 */
export const promedioDe = query({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const asignacion = await ctx.db.get(args.asignacionId);
    if (!asignacion) return null;
    const lectura = await leerIntentosParaAnalitica(ctx, args.asignacionId);
    return promedioDeAsignacion({
      diagnosticos: lectura.diagnosticos,
      legado: lectura.legado,
      desbordado: lectura.corte,
    });
  },
});
