import { query } from "./_generated/server";
import { type Doc } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import { fechaCortaMx, fechaLargaMx, inicioDeMesMx } from "./fechas";

/** Cuántas filas muestra «Últimos exámenes aplicados» (LUI-9). */
const ULTIMOS = 5;

/**
 * Promedio del PRIMER intento de cada alumna en una asignación.
 *
 * ⚠️ **CONTRATO PROVISIONAL** — el modelo NO tiene `intentos.numeroIntento` (lo
 * introduce **LUI-104**, dueño de la regla transversal «solo el intento 1 cuenta
 * para la analítica»). Aquí «primer intento» se aproxima con el `iniciadoEn` MÁS
 * ANTIGUO por alumna, en memoria. Cuando LUI-104 agregue el campo, esta función se
 * reemplaza por un filtro `numeroIntento === 1` y este comentario muere con ella.
 *
 * Precisión del proxy: el universo se acota ANTES a los intentos CALIFICADOS
 * (`enviado` y con `puntaje`). Así, una alumna que abandonó su intento #1 y
 * entregó el #2 sí aporta su #2 — de lo contrario un intento fantasma sin puntaje
 * la borraría del promedio en silencio. Una columna que dice «Puntaje promedio»
 * promedia puntajes, no intentos vacíos.
 *
 * Devuelve `null` (no `0`) si no hay ningún intento calificado: la celda muestra
 * «—». Un `0` sería un puntaje imposible en la escala 700–1300.
 */
function puntajePromedio(intentos: Doc<"intentos">[]): number | null {
  const primeros = new Map<string, { iniciadoEn: number; puntaje: number }>();
  for (const i of intentos) {
    if (i.estado !== "enviado" || i.puntaje === undefined) continue;
    const previo = primeros.get(i.alumnoId);
    if (!previo || i.iniciadoEn < previo.iniciadoEn) {
      primeros.set(i.alumnoId, { iniciadoEn: i.iniciadoEn, puntaje: i.puntaje });
    }
  }
  const puntajes = [...primeros.values()].map((x) => x.puntaje);
  if (puntajes.length === 0) return null;
  return Math.round(puntajes.reduce((s, p) => s + p, 0) / puntajes.length);
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
        const [examen, grupo, intentos] = await Promise.all([
          ctx.db.get(a.examenId),
          ctx.db.get(a.grupoId),
          ctx.db
            .query("intentos")
            .withIndex("by_asignacion", (q) => q.eq("asignacionId", a._id))
            .collect(),
        ]);
        return {
          id: a._id,
          examen: examen?.titulo ?? "Examen eliminado",
          grupo: grupo?.nombre ?? "Grupo eliminado",
          fecha: fechaCortaMx(a.abreEn),
          fechaMs: a.abreEn,
          puntajePromedio: puntajePromedio(intentos),
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
