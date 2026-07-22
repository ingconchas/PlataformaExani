import { query } from "./_generated/server";
import { type Id } from "./_generated/dataModel";
import { destinoDeFila } from "./asignacionDestino";
import { requireAdmin } from "./authz";
import { fechaCortaMx, fechaLargaMx, inicioDeMesMx } from "./fechas";
import {
  MAX_INTENTOS_PANEL_POR_ASIGNACION,
  promedioDeAsignacion,
} from "./simulacro";
import { type QueryCtx } from "./_generated/server";

/** Cuántas filas muestra «Últimos exámenes aplicados» (LUI-9). */
const ULTIMOS = 5;

/**
 * Los intentos de una asignación que ALIMENTAN la analítica: solo diagnósticos.
 *
 * Cumple el contrato que esta función tenía pendiente desde LUI-9: «cuando LUI-104 agregue
 * `numeroIntento`, esto se reemplaza por un filtro `numeroIntento === 1`». Y lo hace en el
 * RANGO del índice, no en memoria: con repasos, una asignación acumula alumnas × intentos y
 * un `.collect()` de sus intentos (5 asignaciones × 200 alumnas × 30 intentos) rebasaría los
 * 32,000 documentos por transacción de Convex. Aquí se leen ≤ 2 × (400+1) por asignación.
 *
 * Dos rangos porque hay dos poblaciones: los intentos NUMERADOS (todo lo que nace por
 * `player.iniciarIntento`) y el LEGADO sin el campo, que en Convex se selecciona con
 * `eq("numeroIntento", undefined)` — la misma semántica que en otros contextos es una
 * trampa, aquí es exactamente la herramienta correcta. El promedio los combina en
 * `simulacro.promedioDeAsignacion`, que aplica el proxy histórico SOLO al legado.
 *
 * El centinela (`take(MAX + 1)` lleno) NO se promedia: se propaga como `incompleto`. No
 * existe frontera de escritura que limite las alumnas de una asignación, así que el
 * desborde es alcanzable con datos válidos y un promedio sobre las primeras 400 filas sería
 * preciso y falso a la vez.
 */
async function intentosParaAnalitica(
  ctx: QueryCtx,
  asignacionId: Id<"asignaciones">,
) {
  const [diagnosticos, legado] = await Promise.all([
    ctx.db
      .query("intentos")
      .withIndex("by_asignacion_numero", (q) =>
        q.eq("asignacionId", asignacionId).eq("numeroIntento", 1),
      )
      .take(MAX_INTENTOS_PANEL_POR_ASIGNACION + 1),
    ctx.db
      .query("intentos")
      .withIndex("by_asignacion_numero", (q) =>
        q.eq("asignacionId", asignacionId).eq("numeroIntento", undefined),
      )
      .take(MAX_INTENTOS_PANEL_POR_ASIGNACION + 1),
  ]);
  return promedioDeAsignacion({
    diagnosticos,
    legado,
    desbordado:
      diagnosticos.length > MAX_INTENTOS_PANEL_POR_ASIGNACION ||
      legado.length > MAX_INTENTOS_PANEL_POR_ASIGNACION,
  });
}

/**
 * Todo lo que pinta el panel de la administradora (LUI-9), en UNA sola query.
 *
 * Por qué una y no cuatro: las 4 piezas exigen `requireAdmin` (4 queries = 4×
 * `getAuthUserId` + 4× lectura de `perfiles`); la métrica del mes y la tabla
 * **comparten la lectura de `asignaciones`**; Convex cachea y suscribe *por
 * query* (una entrada de caché, una suscripción); y la pantalla se lee como una
 * unidad — 4 estados de carga independientes producen un esqueleto irregular.
 * El nombre de pila sale gratis: `requireAdmin` ya devuelve el perfil completo.
 *
 * Contrapartida asumida: el conjunto de invalidación es la unión de las 5 tablas
 * leídas. Para un dashboard en vivo eso es exactamente lo deseado.
 */
export const resumen = query({
  args: {},
  handler: async (ctx) => {
    const { perfil } = await requireAdmin(ctx);

    // `Date.now()` es válido en una query de Convex: el runtime lo congela al
    // inicio de la transacción. Mismo criterio que `grupos.obtener`.
    //
    // UNA sola lectura del reloj alimenta la fecha del encabezado Y la métrica del
    // mes: así es IMPOSIBLE por construcción que el encabezado diga «1 de agosto»
    // mientras la métrica sigue contando julio.
    const ahora = Date.now();
    const inicioMes = inicioDeMesMx(ahora);

    // `grupos` no tiene ningún índice; a escala de la institución (decenas)
    // `.collect()` es lo correcto — mismo criterio que `grupos.listar`.
    const grupos = await ctx.db.query("grupos").collect();
    const gruposActivos = grupos.filter((g) => g.activo).length;

    // El issue define esta métrica como «Total de alumnos registrados (activos)»:
    // se cuentan SOLO los activos, aunque la etiqueta del diseño diga «Alumnos
    // registrados». Un alumno dado de baja ya no es alumnado de la institución.
    const alumnos = await ctx.db
      .query("perfiles")
      .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
      .collect();
    const alumnosRegistrados = alumnos.filter((p) => p.activo).length;

    // «Exámenes aplicados este mes» = asignaciones cuya ventana ya ABRIÓ dentro del
    // mes calendario en curso (hora del centro de México). El tope superior es
    // `ahora`, NO el fin de mes: una asignación programada para el día 28 no está
    // «aplicada» el día 6. Regla canónica de «aplicada»: `convex/metricas.ts`.
    const delMes = await ctx.db
      .query("asignaciones")
      .withIndex("by_abre", (q) =>
        q.gte("abreEn", inicioMes).lte("abreEn", ahora),
      )
      .collect();
    const examenesAplicadosMes = delMes.length;

    // Los más recientes, fecha descendente. El rango `lte("abreEn", ahora)` es la
    // MISMA regla de `fueAplicada` expresada como rango de índice: sin él, un
    // examen programado para la semana entrante encabezaría «Últimos exámenes
    // APLICADOS». El índice acota la lectura a exactamente `ULTIMOS` documentos.
    const ultimas = await ctx.db
      .query("asignaciones")
      .withIndex("by_abre", (q) => q.lte("abreEn", ahora))
      .order("desc")
      .take(ULTIMOS);

    // N+1 ACOTADO POR CONSTRUCCIÓN: N ≤ 5 lo fija el `take` de arriba, así que son
    // 15 lecturas como máximo, en paralelo. Mismo patrón que `grupos.listarGestion`.
    const ultimosExamenes = await Promise.all(
      ultimas.map(async (a) => {
        // El destino se interpreta SOLO vía `destinoDeFila` (invariante XOR de LUI-22):
        // «Grupo eliminado» queda reservado a una fila-grupo cuyo doc desapareció.
        const destino = destinoDeFila(a);
        const [examen, grupo, promedio] = await Promise.all([
          ctx.db.get(a.examenId),
          destino.tipo === "grupo"
            ? ctx.db.get(destino.grupoId)
            : Promise.resolve(null),
          intentosParaAnalitica(ctx, a._id),
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
          puntajePromedio: promedio.valor,
          // `null` con esto en `true` significa «no pudimos calcularlo», no «sin
          // intentos»: la tabla los distingue («Datos incompletos» vs «—»).
          promedioIncompleto: promedio.incompleto,
        };
      }),
    );

    return {
      // Nombre de PILA para el saludo («Hola, Mayra»). `sesion.actual` no sirve
      // aquí: devuelve nombre + apellidos concatenados.
      nombre: perfil.nombre,
      // Se formatea en el SERVIDOR: la zona (America/Mexico_City) es una regla de
      // negocio del PRD, no una preferencia del dispositivo. Formatearla en el
      // cliente usaría la zona del navegador — la respuesta equivocada si Mayra
      // abre el panel desde otro país — y metería un segundo reloj.
      fechaLarga: fechaLargaMx(ahora),
      metricas: { gruposActivos, alumnosRegistrados, examenesAplicadosMes },
      ultimosExamenes,
    };
  },
});
