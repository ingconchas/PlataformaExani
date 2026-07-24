import { ConvexError, getConvexSize, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { requireAlumna } from "./authz";
import { destinoDeFila } from "./asignacionDestino";
import { CONGELA, estadoDeVentana, etiquetaTipo } from "./examenEstado";
import { MAX_REACTIVOS } from "./constructorExamen";
import { lecturaParaEnlace, resolverLectura } from "./lecturaCompat";
import { sanearMaterial } from "./material";
import { sanear, textoPlanoAHtml } from "./sanitizar";
import { proyectarIntento } from "./lecturasAnalitica";
import {
  esDiagnosticoElegible,
  ganaPuntero,
  tituloDeCierre,
  type PunteroTupla,
} from "./inicioAlumna";
import {
  clasificacionesDistintas,
  derivarResultadoIntento,
  excedePresupuestoDeCatalogo,
  type CatalogoClasificaciones,
} from "./resultados";
import {
  CODIGO_TIEMPO_AGOTADO,
  MAX_FILAS_MIS_EXAMENES_DIRECTAS,
  MAX_FILAS_MIS_EXAMENES_GRUPO,
  MAX_INTENTOS_POR_SERIE,
  calcularPuntaje,
  desglosePorClasificacion,
  dentroDeTiempo,
  limiteDe,
  normalizarFormaCierre,
  validarTechoSerie,
} from "./simulacro";

/**
 * EL PLAYER de la alumna (LUI-25 «Mis exámenes» · LUI-26 simulacro en curso · LUI-27 cierre
 * por tiempo · LUI-104 repasos). PRIMER escritor de `intentos` en producto y ÚNICO escritor
 * de `respuestas` y `posiciones`.
 *
 * Reglas transversales del módulo:
 *
 *  · **Authz**: todo pasa por `requireAlumna` (staff no juega simulacros: generaría datos
 *    académicos que contaminan participación y promedios) y, además, por la PROPIEDAD del
 *    intento. Un intento ajeno se responde con `null` en las queries —cero oráculo de
 *    existencia— y con error en las mutations.
 *
 *  · **La respuesta correcta JAMÁS viaja**. `intento` proyecta campo por campo (nunca
 *    esparce el documento) y omite `opcionCorrecta` y `retroalimentacion`; `misRespuestas`
 *    omite `correcta`. La calificación ocurre server-side, en `responder`. Es la razón por
 *    la que `reactivos.obtener` (que sí los devuelve, tras `requireStaff`) no sirve aquí.
 *
 *  · **Nada derivado del reloj se estampa**: las queries entregan `iniciadoEn`,
 *    `duracionMin`, `cierraEn` y `ahoraServidor` CRUDOS y tanto el servidor como el cliente
 *    derivan el límite con `simulacro.limiteDe`. Una query de Convex no se re-invalida por
 *    el paso del tiempo (contrato de `examenEstado.estadoDeVentana`).
 *
 *  · **El cierre es DURABLE**: `iniciarIntento` agenda `cerrarVencido` para el límite en su
 *    misma transacción. El navegador es un acelerador, no la autoridad — si la alumna cierra
 *    la pestaña, el intento se entrega igual con lo respondido.
 *
 *  · **Idempotencia antes que transición**: `iniciarIntento` reanuda en vez de duplicar y
 *    `enviar` contesta `yaEnviado` en vez de recalcular. Convex reintenta mutations: sin
 *    esas salidas, un reintento de red pintaría error sobre una acción que sí funcionó.
 */

type Ctx = QueryCtx | MutationCtx;

/** HTML seguro de un campo del reactivo/lectura, bifurcado por `contenidoFormato`. Calcado
 *  de `examenes.comoHtmlSeguro`: el legado (sin formato) pasa por `textoPlanoAHtml` —
 *  sanearlo interpretaría markup dentro de texto plano y un `<` literal desaparecería. */
function comoHtmlSeguro(
  texto: string,
  contenidoFormato: "html" | undefined,
): string {
  return contenidoFormato === "html" ? sanear(texto) : textoPlanoAHtml(texto);
}

/**
 * El intento, verificado como PROPIO. Devuelve `null` ante id malformado, inexistente o
 * ajeno — indistinguibles a propósito: distinguirlos convertiría la query en un oráculo de
 * existencia de intentos de otras alumnas.
 */
async function intentoPropio(
  ctx: Ctx,
  userId: Id<"users">,
  intentoId: string,
): Promise<Doc<"intentos"> | null> {
  const id = ctx.db.normalizeId("intentos", intentoId);
  if (!id) return null;
  const intento = await ctx.db.get(id);
  if (!intento || intento.alumnoId !== userId) return null;
  return intento;
}

/** El límite del intento, resolviendo su asignación si la tiene (los directos —«práctica
 *  libre»— no tienen ventana que recorte). Una asignación borrada bajo un intento vivo es
 *  imposible (`cancelar` exige programada y sin intentos), pero la función es TOTAL. */
async function limiteDeIntento(
  ctx: Ctx,
  intento: Doc<"intentos">,
  examen: Doc<"examenes">,
): Promise<number> {
  const asignacion = intento.asignacionId
    ? await ctx.db.get(intento.asignacionId)
    : null;
  return limiteDe(intento.iniciadoEn, examen.duracionMin, asignacion?.cierraEn);
}

// ─────────────────────────────────────────────────────────────────────────────
// misExamenes — la lista de la alumna (LUI-25)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas las asignaciones que alcanzan a la alumna, CRUDAS, con el resultado de dos sondas
 * acotadas por fila. La clasificación (pendiente / completado / vencido / futura), la
 * urgencia «cierra hoy» y el orden los deriva el CLIENTE con su reloj anclado
 * (`misExamenes.derivarMisExamenes`).
 *
 * ⚠️ **La rama grupal solo corre si la alumna TIENE grupo.** En Convex, `eq(campo,
 * undefined)` selecciona los documentos que NO tienen el campo: con `perfil.grupoId`
 * ausente —legal en el schema y alcanzable desde `alumnos.crear`/`actualizar`—, un
 * `eq("grupoId", undefined)` devolvería TODAS las asignaciones individuales de la
 * institución, que son justamente las que no tienen `grupoId`. El guard es la frontera que
 * lo impide.
 *
 * ⚠️ **Presupuesto contractual** (límites duros de Convex: 4,096 rangos · 32,000 docs ·
 * 16 MiB · 1 MiB/doc):
 *   · rangos: 2 (`requireAlumna`) + 2 (las dos ramas) + 2×180 (sondas) = **366**
 *   · docs:   2 + **182 leídos** (121 + 61 con centinela; ≤180 procesados) + 3×180
 *             (dos enviados + un en curso por fila) + ≤180 secciones distintas para el
 *             chip = **≤ 904**
 *   · bytes:  perfil de sesión (≤1 MiB) + filas de forma FIJA (título ≤160, sin arreglos)
 *             ≈ 0.5 KiB c/u + intentos sin texto libre ≈ 0.2 KiB c/u + secciones diminutas
 *             ⇒ **< 2.5 MiB**
 * Cero `.paginate()` y cero `.collect()` de tablas que crecen. **No lee `examenes`** —los
 * read-models de la asignación (`tituloExamen`, `numReactivos`, `duracionMin`,
 * `tipoExamen`) existen exactamente para eso— ni `posiciones`.
 */
export const misExamenes = query({
  args: {},
  handler: async (ctx) => {
    const { userId, perfil } = await requireAlumna(ctx);
    // Ancla de INICIO: el runtime de Convex congela `Date.now()` al inicio de la función.
    // Viaja CRUDO para que el cliente ancle su reloj; no se deriva nada de él aquí.
    const ahoraServidor = Date.now();

    // Orden DESCENDENTE por cierre en ambas ramas: las vivas encabezan siempre (y están
    // acotadas por las fronteras de escritura de `asignar`), así que el centinela solo
    // puede dejar fuera historial cerrado antiguo. El flag lo reporta igual.
    const grupoId = perfil.grupoId;
    const deGrupo = grupoId
      ? await ctx.db
          .query("asignaciones")
          .withIndex("by_grupo_cierra", (q) => q.eq("grupoId", grupoId))
          .order("desc")
          .take(MAX_FILAS_MIS_EXAMENES_GRUPO + 1)
      : [];
    const historialGrupoIncompleto = deGrupo.length > MAX_FILAS_MIS_EXAMENES_GRUPO;

    const directas = await ctx.db
      .query("asignaciones")
      .withIndex("by_alumno_cierra", (q) => q.eq("alumnoId", userId))
      .order("desc")
      .take(MAX_FILAS_MIS_EXAMENES_DIRECTAS + 1);
    const directasIncompletas = directas.length > MAX_FILAS_MIS_EXAMENES_DIRECTAS;

    const candidatas = [
      ...deGrupo.slice(0, MAX_FILAS_MIS_EXAMENES_GRUPO),
      ...directas.slice(0, MAX_FILAS_MIS_EXAMENES_DIRECTAS),
    ];

    // El chip del tipo necesita el NOMBRE de la sección (el read-model guarda el id, para
    // que renombrar en el temario no haga mentir al chip): se resuelve una vez por sección
    // DISTINTA — documentos diminutos, jamás uno por fila.
    const nombreSeccion = new Map<Id<"secciones">, string | null>();
    let asignacionesLegadasOmitidas = false;
    const filas = [];

    for (const a of candidatas) {
      // Una fila anterior a los read-models no se puede pintar sin leer `examenes` (un
      // examen legado carga miles de `reactivoIds` y el límite es 1 MiB por documento), que
      // es justo lo que el presupuesto prohíbe. Se OMITE y se reporta; jamás se inventa.
      if (
        a.tituloExamen === undefined ||
        a.numReactivos === undefined ||
        a.duracionMin === undefined ||
        a.tipoExamen === undefined
      ) {
        asignacionesLegadasOmitidas = true;
        continue;
      }

      const [enviados, enCurso] = await Promise.all([
        // DOS filas bastan: la primera en orden de creación ES el diagnóstico (invariante
        // de `iniciarIntento`) y la existencia de la segunda demuestra que hubo repaso.
        ctx.db
          .query("intentos")
          .withIndex("by_asignacion_alumno_estado", (q) =>
            q
              .eq("asignacionId", a._id)
              .eq("alumnoId", userId)
              .eq("estado", "enviado"),
          )
          .take(2),
        ctx.db
          .query("intentos")
          .withIndex("by_asignacion_alumno_estado", (q) =>
            q
              .eq("asignacionId", a._id)
              .eq("alumnoId", userId)
              .eq("estado", "en_curso"),
          )
          .first(),
      ]);

      const tipo = a.tipoExamen;
      if (tipo.clase === "modulo" && !nombreSeccion.has(tipo.seccionId)) {
        const s = await ctx.db.get(tipo.seccionId);
        nombreSeccion.set(tipo.seccionId, s?.nombre ?? null);
      }

      filas.push({
        asignacionId: a._id,
        examenId: a.examenId,
        titulo: a.tituloExamen,
        numReactivos: a.numReactivos,
        duracionMin: a.duracionMin,
        esModulo: tipo.clase === "modulo",
        tipoEtiqueta: etiquetaTipo(
          tipo,
          tipo.clase === "modulo"
            ? (nombreSeccion.get(tipo.seccionId) ?? null)
            : null,
        ),
        abreEn: a.abreEn,
        cierraEn: a.cierraEn,
        enviados: enviados.map((i) => ({
          intentoId: i._id,
          enviadoEn: i.enviadoEn ?? null,
          puntaje: i.puntaje ?? null,
          numeroIntento: i.numeroIntento ?? null,
        })),
        enCurso: enCurso
          ? { intentoId: enCurso._id, iniciadoEn: enCurso.iniciadoEn }
          : null,
      });
    }

    return {
      ahoraServidor,
      filas,
      historialGrupoIncompleto,
      directasIncompletas,
      asignacionesLegadasOmitidas,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// iniciarIntento — el único origen de un intento (LUI-26 · LUI-104)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Empieza (o REANUDA) el simulacro de una asignación.
 *
 * Orden de guardas —permiso antes que contenido, no-op antes que creación—:
 *  1. sesión de alumna;
 *  2. la asignación EXISTE (contrato transaccional con `asignaciones.cancelar`);
 *  3. trae read-models (una fila legada se rechaza con mensaje propio: omitirla de la lista
 *     no impide llamar esta mutation con su id);
 *  4. su DESTINO alcanza a esta alumna (vía `destinoDeFila`, jamás leyendo los campos a
 *     mano: el invariante XOR es de `asignacionDestino`);
 *  5. la ventana está ABIERTA **dentro de esta transacción** — esto ES el rechazo de
 *     «no se puede iniciar un repaso con la ventana cerrada» de LUI-104;
 *  6. el examen existe, congela (defensa: un borrador asignado es imposible por
 *     construcción, pero confiar en «no debería» es el agujero que LUI-20 cerró) y tiene
 *     reactivos dentro de la cota del constructor;
 *  7. **no-op**: si ya hay un intento vivo se REANUDA (jamás se duplica ni se reinicia);
 *  8. techo de la serie y numeración;
 *  9. insert + agendado del cierre durable, en la misma transacción.
 *
 * **Carrera del doble clic**: los pasos 7 y 8 LEEN el mismo rango del índice en el que el
 * paso 9 ESCRIBE. Dos ejecuciones simultáneas se intersectan, así que la serialización de
 * Convex hace commitear a una y REINTENTAR a la otra desde cero — y en el reintento la
 * sonda del paso 7 encuentra el intento y devuelve `reanudado: true`. La sonda previa es lo
 * que convierte el conflicto en convergencia en vez de en error.
 */
export const iniciarIntento = mutation({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args) => {
    const { userId, perfil } = await requireAlumna(ctx);
    const ahora = Date.now();

    const a = await ctx.db.get(args.asignacionId);
    if (!a) {
      throw new ConvexError(
        "Esta asignación ya no existe; vuelve a «Mis exámenes».",
      );
    }
    if (
      a.tituloExamen === undefined ||
      a.numReactivos === undefined ||
      a.duracionMin === undefined
    ) {
      throw new ConvexError(
        "Esta asignación es de una versión anterior de la plataforma; " +
          "pide a tu instructor que la vuelva a crear.",
      );
    }

    const destino = destinoDeFila(a);
    const alcanza =
      destino.tipo === "alumno"
        ? destino.alumnoId === userId
        : perfil.grupoId === destino.grupoId;
    if (!alcanza) throw new ConvexError("Este examen no está asignado a ti.");

    const ventana = estadoDeVentana(a.abreEn, a.cierraEn, ahora);
    if (ventana === "programada") {
      throw new ConvexError("Este simulacro todavía no abre.");
    }
    if (ventana === "cerrada") {
      throw new ConvexError("La ventana de este simulacro ya cerró.");
    }

    const examen = await ctx.db.get(a.examenId);
    if (!examen) throw new ConvexError("El examen ya no existe.");
    if (!CONGELA[examen.estado]) {
      throw new ConvexError("Este examen no está disponible para presentarse.");
    }
    if (examen.reactivoIds.length === 0) {
      throw new ConvexError("Este examen no tiene preguntas.");
    }
    if (examen.reactivoIds.length > MAX_REACTIVOS) {
      throw new ConvexError(
        "Este examen excede el tamaño permitido; avisa a tu instructor.",
      );
    }

    const vivo = await ctx.db
      .query("intentos")
      .withIndex("by_asignacion_alumno_estado", (q) =>
        q
          .eq("asignacionId", a._id)
          .eq("alumnoId", userId)
          .eq("estado", "en_curso"),
      )
      .first();
    if (vivo) return { intentoId: vivo._id, reanudado: true as const };

    const enviados = await ctx.db
      .query("intentos")
      .withIndex("by_asignacion_alumno_estado", (q) =>
        q.eq("asignacionId", a._id).eq("alumnoId", userId).eq("estado", "enviado"),
      )
      .take(MAX_INTENTOS_POR_SERIE + 1);
    validarTechoSerie(a.tituloExamen, enviados.length);

    // `numeroIntento > 1 ⟹ ∃ enviado previo` queda garantizado POR CONSTRUCCIÓN: el número
    // sale de contar enviados y el paso 7 impide crear mientras haya uno vivo. De ahí se
    // sigue (por descenso) que «∃ enviado ⟺ el intento 1 está enviado», que es lo que
    // mantiene válidas las dos sondas del panel del instructor sin tocarlas.
    const intentoId = await ctx.db.insert("intentos", {
      examenId: a.examenId,
      alumnoId: userId,
      asignacionId: a._id,
      estado: "en_curso",
      iniciadoEn: ahora,
      numeroIntento: enviados.length + 1,
    });

    // Cursor INICIAL explícito. Sin esta fila, una alumna que contesta la pregunta 1 y
    // cierra el navegador SIN navegar reabriría en la «primera sin responder» —la 2—, que
    // no es donde se quedó: el criterio de LUI-26 es reanudar en la MISMA pregunta. La
    // posición solo se persistía al navegar, así que el caso «contestar sin moverse» no
    // tenía dónde guardarse.
    await ctx.db.insert("posiciones", { intentoId, posicion: 0 });

    // Cierre DURABLE (LUI-27): agendado en ESTA transacción, así que o existen los dos
    // (intento y job) o ninguno. El límite es constante desde ya —el candado congela
    // `duracionMin` y `cierraEn` mientras el intento viva—, por eso puede fijarse aquí.
    const cierreJobId = await ctx.scheduler.runAt(
      limiteDe(ahora, examen.duracionMin, a.cierraEn),
      internal.player.cerrarVencido,
      { intentoId },
    );
    await ctx.db.patch(intentoId, { cierreJobId });

    return { intentoId, reanudado: false as const };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierre del intento — compartido por el envío manual, el automático y el durable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Califica y cierra un intento VIVO. Único lugar donde `en_curso → enviado` ocurre.
 *
 *  · `N` = reactivos que TODAVÍA existen. Un id colgante (el fixture «Simulacro legado»
 *    tiene uno) no puede contar como pregunta fallada: no se le pudo mostrar. Coherente con
 *    `intento`, que también los omite.
 *  · Las preguntas sin responder cuentan como incorrectas SIN contarlas: solo suman las
 *    filas de `respuestas` con `correcta === true`.
 *  · `formaCierre` la DERIVA el reloj congelado del servidor contra el límite — jamás llega
 *    del cliente.
 *  · `N === 0` (todos los reactivos borrados) cierra SIN puntaje en vez de lanzar: lanzar
 *    dejaría a la alumna atrapada en un intento que no puede enviarse y haría reintentar al
 *    job durable para siempre. `puntaje` ausente ya significa «sin calificar» para
 *    `panel`/`resultado`.
 */
async function finalizarIntento(
  ctx: MutationCtx,
  intento: Doc<"intentos">,
  ahora: number,
): Promise<{ puntaje: number | null; formaCierre: "manual" | "tiempo_agotado" }> {
  const examen = await ctx.db.get(intento.examenId);
  const docs = examen
    ? await Promise.all(examen.reactivoIds.map((rid) => ctx.db.get(rid)))
    : [];
  const vivos = docs.filter((r): r is Doc<"reactivos"> => r !== null);

  const respuestas = await ctx.db
    .query("respuestas")
    .withIndex("by_intento_reactivo", (q) => q.eq("intentoId", intento._id))
    .take(MAX_REACTIVOS + 1);

  const idsVivos = new Set<string>(vivos.map((r) => r._id));
  const correctas = new Set<string>(
    respuestas
      .filter((r) => r.correcta && idsVivos.has(r.reactivoId))
      .map((r) => r.reactivoId),
  );

  // Sin examen no hay plazo que se haya podido agotar: el cierre es «manual» por descarte.
  const limite = examen ? await limiteDeIntento(ctx, intento, examen) : null;
  const formaCierre =
    limite === null || dentroDeTiempo(ahora, limite)
      ? ("manual" as const)
      : ("tiempo_agotado" as const);

  const puntaje =
    vivos.length === 0 ? null : calcularPuntaje(correctas.size, vivos.length);
  const desglose = desglosePorClasificacion(
    vivos.map((r) => ({ id: r._id, seccionId: r.seccionId, areaId: r.areaId })),
    correctas,
  );

  await ctx.db.patch(intento._id, {
    estado: "enviado",
    enviadoEn: ahora,
    formaCierre,
    ...(puntaje === null ? {} : { puntaje }),
    aciertosPorSeccion: desglose.porSeccion,
    aciertosPorArea: desglose.porArea,
    cierreJobId: undefined, // el job ya no tiene nada que hacer
  });

  // READ-MODEL de «aplicada» (LUI-30): el primer cierre de la asignación estampa
  // `envioRegistradoEn` UNA sola vez (los envíos siguientes ven el campo y no tocan el
  // doc — sin tormenta reactiva sobre las queries que leen `asignaciones`). Se estampa en
  // CADA cierre si está ausente —no solo en el intento 1— a propósito: es la
  // AUTO-REPARACIÓN del fasado de la migración (un repaso sobre una asignación anterior
  // al deploy A la repara; las que no tengan actividad nueva las cubre el backfill de
  // `migracionesMetricas`). Contrato del campo: SOLO existencia — docblock en schema.ts.
  if (intento.asignacionId !== undefined) {
    const asignacion = await ctx.db.get(intento.asignacionId);
    if (asignacion && asignacion.envioRegistradoEn === undefined) {
      await ctx.db.patch(intento.asignacionId, { envioRegistradoEn: ahora });
    }
  }

  // READ-MODEL del ÚLTIMO DIAGNÓSTICO (LUI-24): el cierre de un DIAGNÓSTICO
  // (`numeroIntento === 1`) hace competir su tupla por el puntero de la alumna. Un repaso
  // ni siquiera lee el puntero (guard antes de la sonda).
  await estamparPunteroDiagnostico(ctx, intento, ahora);

  // El cursor es UX de un intento vivo; cerrado, es basura.
  const posicion = await ctx.db
    .query("posiciones")
    .withIndex("by_intento", (q) => q.eq("intentoId", intento._id))
    .first();
  if (posicion) await ctx.db.delete(posicion._id);

  return { puntaje, formaCierre };
}

/**
 * Hace competir el diagnóstico recién cerrado por el puntero `ultimosDiagnosticos` de su
 * alumna (LUI-24). El puntaje puede ser `null` (examen sin reactivos vivos) sin afectar la
 * elegibilidad: lo que importa es que sea un diagnóstico enviado con fecha.
 *
 * GUARD antes de la sonda: un repaso (`numeroIntento !== 1`) sale sin leer ni escribir nada
 * (+0 rangos, +0 writes en su hot path — regla del dictamen). Un cierre legado sin
 * `numeroIntento` tampoco estampa: no afirmamos «diagnóstico» sobre lo que no sabemos.
 *
 * Upsert por la tupla `(intentoId, enviadoEn)` vía `ganaPuntero`: escribe SOLO si el nuevo
 * GANA, para no invalidar la query de Inicio de todas las alumnas en cada cierre ajeno.
 */
async function estamparPunteroDiagnostico(
  ctx: MutationCtx,
  intento: Doc<"intentos">,
  ahora: number,
): Promise<void> {
  if (intento.numeroIntento !== 1) return;

  const alumnoId = intento.alumnoId;
  const nuevo: PunteroTupla = { intentoId: intento._id, enviadoEn: ahora };

  const actual = await ctx.db
    .query("ultimosDiagnosticos")
    .withIndex("by_user", (q) => q.eq("alumnoId", alumnoId))
    .first();

  if (!actual) {
    await ctx.db.insert("ultimosDiagnosticos", {
      alumnoId,
      intentoId: nuevo.intentoId,
      enviadoEn: nuevo.enviadoEn,
    });
    return;
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
  }
}

/**
 * Cierre DURABLE por tiempo agotado (LUI-27). Lo agenda `iniciarIntento` para el límite
 * exacto del intento, así que el examen se entrega con lo respondido **aunque la alumna
 * haya cerrado el navegador**: sin esto, un intento abandonado quedaría `en_curso` para
 * siempre — sin puntaje, contando como pendiente en la participación y bloqueando
 * `examenes.archivar` (el pasivo que `examenes.ts` declaraba como deuda de LUI-27).
 *
 * ⚠️ Esto NO es «un cron que materializa el estado», lo que `examenEstado.estadoDeVentana`
 * prohíbe: aquello sería copiar periódicamente una derivación del reloj a un campo. Esto es
 * un one-shot por EVENTO real —la transición del intento y su calificación, que solo pueden
 * ocurrir una vez— agendado en la misma transacción que lo origina.
 *
 * Idempotente y TOTAL: intento borrado o ya enviado → no-op; llamado antes de tiempo (solo
 * posible si el límite se movió en dev) → RE-AGENDA y actualiza `cierreJobId`, de modo que
 * nunca queda más de un job pendiente por intento vivo.
 */
export const cerrarVencido = internalMutation({
  args: { intentoId: v.id("intentos") },
  handler: async (ctx, args) => {
    const intento = await ctx.db.get(args.intentoId);
    if (!intento || intento.estado === "enviado") return { cerrado: false };

    const ahora = Date.now();
    const examen = await ctx.db.get(intento.examenId);
    if (examen) {
      const limite = await limiteDeIntento(ctx, intento, examen);
      if (dentroDeTiempo(ahora, limite)) {
        const cierreJobId = await ctx.scheduler.runAt(
          limite,
          internal.player.cerrarVencido,
          { intentoId: intento._id },
        );
        await ctx.db.patch(intento._id, { cierreJobId });
        return { cerrado: false };
      }
    }

    await finalizarIntento(ctx, intento, ahora);
    return { cerrado: true };
  },
});

/**
 * Envío del simulacro: manual («Enviar ahora») o automático cuando el cronómetro del cliente
 * llega a cero. UNA sola mutation para ambos porque la diferencia —`formaCierre`— la deriva
 * el servidor de su propio reloj: aceptarla como argumento sería dejar que el navegador
 * etiquete cómo terminó el examen.
 *
 * No exige ventana ni tiempo vigentes: ES el mecanismo de cierre. La salida idempotente va
 * ANTES de cualquier guarda de transición (precedente `examenes.archivar`).
 */
export const enviar = mutation({
  args: { intentoId: v.id("intentos") },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const ahora = Date.now();

    const intento = await ctx.db.get(args.intentoId);
    if (!intento || intento.alumnoId !== userId) {
      throw new ConvexError("Este intento no es tuyo.");
    }
    if (intento.estado === "enviado") {
      return {
        yaEnviado: true as const,
        puntaje: intento.puntaje ?? null,
        formaCierre: normalizarFormaCierre(intento.formaCierre),
      };
    }

    const { puntaje, formaCierre } = await finalizarIntento(ctx, intento, ahora);
    return { yaEnviado: false as const, puntaje, formaCierre };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// intento — el CONTENIDO del examen para presentarlo (LUI-26)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que el player necesita para pintar el simulacro… **menos las respuestas de la
 * alumna**, que viven en `misRespuestas`. La separación es deliberada: cada `responder`
 * invalida la query que leyó `respuestas`, y si esa query fuera esta, cada clic volvería a
 * transferir hasta 240 reactivos con su HTML.
 *
 * PROYECCIÓN EXPLÍCITA campo por campo —jamás `...r`—: `opcionCorrecta` y
 * `retroalimentacion` NO salen de aquí. Es la aserción número uno de la revisión de este
 * paquete.
 *
 * ⚠️ **Presupuesto** (peor caso bajo las cotas, TODAS las lecturas contadas):
 *   · rangos: 2 (`requireAlumna`) + 1 (asignación) = **3**; las respuestas NO se leen aquí
 *   · docs: 2 (sesión) + 1 (intento) + 1 (examen) + ≤240 (reactivos, tope
 *     `MAX_REACTIVOS` re-verificado arriba) + ≤240 (lecturas distintas, en la práctica ≪)
 *     + ≤240 (secciones distintas) + 1 (asignación) = **≤ 725 ≪ 32,000**
 *   · bytes: cada reactivo cae bajo el límite DURO de **1 MiB/doc** de Convex (lo rechaza
 *     al escribirse), así que la cota física —240 MiB— es teórica, no útil. La cota
 *     PRÁCTICA la dan las fronteras de CONTENIDO: el enunciado está acotado a
 *     `MAX_HTML = 10 KB` en `reactivos.crear` (240 × 10 KB = ≤2.4 MiB); las **opciones**,
 *     en cambio, tienen la CANTIDAD acotada (3-4) pero NO la longitud del texto —deuda
 *     declarada, misma clase que la de los lectores acumulativos de `examenes.listar`—,
 *     así que una cifra «< X MiB» sería una falsa promesa y no se afirma. En el uso real
 *     (opciones de una línea) un examen de 240 reactivos ronda 3-5 MiB, holgado bajo los
 *     16 MiB; el cierre definitivo es una cota de longitud de opción en el escritor,
 *     anotada para cuando LUI-15 lo aborde.
 * `ctx.storage.getUrl` no lee la base de datos.
 */
export const intento = query({
  args: { intentoId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const ahoraServidor = Date.now();

    const i = await intentoPropio(ctx, userId, args.intentoId);
    if (!i) return null;
    if (i.estado === "enviado") {
      // La FORMA de cierre viaja con el problema para que el cliente elija destino sin
      // adivinar: un intento que venció mientras la alumna lo tenía abierto merece la
      // pantalla «Se acabó el tiempo» (Diseño 25), y uno entregado a mano no.
      // Es determinista: sin esto, quién cierra primero —el cierre durable del servidor o
      // el cronómetro del cliente— decidiría qué ve la alumna.
      return {
        problema: "enviado" as const,
        intentoId: i._id,
        formaCierre: normalizarFormaCierre(i.formaCierre),
      };
    }

    const examen = await ctx.db.get(i.examenId);
    if (!examen) return { problema: "examenAusente" as const, intentoId: i._id };
    if (examen.reactivoIds.length > MAX_REACTIVOS) {
      return { problema: "fueraDeCota" as const, intentoId: i._id };
    }

    const docs = await Promise.all(
      examen.reactivoIds.map((rid) => ctx.db.get(rid)),
    );
    const vivos = docs.filter((r): r is Doc<"reactivos"> => r !== null);

    // Lecturas de los bloques presentes (LUI-17), con proyección igual de explícita.
    const refs = new Set<Id<"lecturas">>();
    for (const r of vivos) {
      const ref = lecturaParaEnlace(resolverLectura(r));
      if (ref) refs.add(ref);
    }
    const lecturaDocs = await Promise.all([...refs].map((lid) => ctx.db.get(lid)));
    const lecturas = lecturaDocs
      .filter((l): l is Doc<"lecturas"> => l !== null)
      .map((l) => ({
        id: l._id,
        titulo: l.titulo, // texto PLANO por contrato del schema
        contenidoHtml: comoHtmlSeguro(l.contenido, l.contenidoFormato),
      }));

    const items = await Promise.all(
      vivos.map(async (r) => ({
        id: r._id,
        enunciadoHtml: comoHtmlSeguro(r.enunciado, r.contenidoFormato),
        opciones: r.opciones.map((o) => ({ id: o.id, texto: o.texto })),
        material: r.material ? sanearMaterial(r.material) : null,
        imagenUrl: r.imagenId ? await ctx.storage.getUrl(r.imagenId) : null,
        seccionId: r.seccionId,
        lecturaId: lecturaParaEnlace(resolverLectura(r)),
      })),
    );

    const asignacion = i.asignacionId ? await ctx.db.get(i.asignacionId) : null;

    // Nombres de las secciones presentes (encabezado del header y grupos del mapa). Una
    // por sección DISTINTA — documentos diminutos —, no una por pregunta.
    const idsSeccion = [...new Set(items.map((it) => it.seccionId))];
    const seccionDocs = await Promise.all(idsSeccion.map((sid) => ctx.db.get(sid)));
    const secciones = idsSeccion.map((sid, k) => ({
      id: sid,
      nombre: seccionDocs[k]?.nombre ?? "Sin sección",
    }));

    return {
      problema: null,
      intentoId: i._id,
      titulo: asignacion?.tituloExamen ?? examen.titulo,
      numeroIntento: i.numeroIntento ?? null,
      items,
      lecturas,
      secciones,
      // Diferencia entre lo que el autor compuso y lo que se puede mostrar: se REPORTA.
      reactivosFaltantes: docs.length - vivos.length,
      // CRUDOS: el límite lo deriva quien los recibe (`simulacro.limiteDe`), servidor y
      // cliente por igual. Nada de «restante» ni «vencido» estampado.
      ahoraServidor,
      iniciadoEn: i.iniciadoEn,
      duracionMin: examen.duracionMin,
      cierraEn: asignacion?.cierraEn ?? null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// misRespuestas / responder — el autoguardado (LUI-26)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las respuestas de la alumna en su intento. Query PROPIA (y diminuta) porque es la única
 * que `responder` invalida: separarla de `intento` es lo que evita re-transferir el examen
 * completo en cada clic.
 *
 * **`correcta` NO viaja**: durante el examen la alumna no sabe si acertó. La calificación
 * se estampa server-side y se revela en los resultados (LUI-28).
 */
export const misRespuestas = query({
  args: { intentoId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const ahoraServidor = Date.now();
    const i = await intentoPropio(ctx, userId, args.intentoId);
    if (!i) return null;

    const filas = await ctx.db
      .query("respuestas")
      .withIndex("by_intento_reactivo", (q) => q.eq("intentoId", i._id))
      .take(MAX_REACTIVOS + 1);

    return {
      ahoraServidor,
      respuestas: filas.map((r) => ({
        reactivoId: r.reactivoId,
        opcionElegida: r.opcionElegida,
        respondidoEn: r.respondidoEn,
      })),
    };
  },
});

/**
 * Guarda (o cambia) la respuesta de una pregunta. Se llama en el momento de contestar —el
 * autoguardado que LUI-26 exige— y devuelve SOLO el timestamp: nunca si acertó.
 *
 * Rechaza con `codigo: "tiempo_agotado"` una vez pasado el límite: es el criterio de
 * aceptación de LUI-27 («el sistema no acepta respuestas nuevas después de que el tiempo
 * venció») y, a la vez, la señal con la que el cliente sabe que debe pasar a la pantalla
 * terminal. Sin tolerancia: el margen de red lo absorbe el cliente disparando el envío con
 * su reloj anclado antes del límite.
 *
 * El upsert es sonda + `patch|insert` en la misma transacción (un índice de Convex no es
 * constraint único); dos clics simultáneos sobre la misma pregunta los serializa la OCC.
 */
export const responder = mutation({
  args: {
    intentoId: v.id("intentos"),
    reactivoId: v.id("reactivos"),
    opcionElegida: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const ahora = Date.now();

    // Entrada CRUDA antes de tocar la base: los ids de opción son `a|b|c|d` (canónicos del
    // formulario) y la pertenencia real se comprueba abajo contra el documento.
    const opcion = args.opcionElegida.trim();
    if (opcion.length === 0 || opcion.length > 8) {
      throw new ConvexError("Opción inválida.");
    }

    const i = await ctx.db.get(args.intentoId);
    if (!i || i.alumnoId !== userId) {
      throw new ConvexError("Este intento no es tuyo.");
    }
    if (i.estado === "enviado") {
      throw new ConvexError("Este simulacro ya fue enviado.");
    }

    const examen = await ctx.db.get(i.examenId);
    if (!examen) throw new ConvexError("El examen ya no existe.");

    const limite = await limiteDeIntento(ctx, i, examen);
    if (!dentroDeTiempo(ahora, limite)) {
      // Forma `{code, message}` (precedente `auth.ts`): el cliente ramifica por el código
      // para saltar a la pantalla terminal, no por el texto.
      throw new ConvexError({
        code: CODIGO_TIEMPO_AGOTADO,
        message: "Se acabó el tiempo de este simulacro.",
      });
    }

    // Pertenencia al examen: acota las filas de `respuestas` de un intento a ≤ N.
    if (!examen.reactivoIds.includes(args.reactivoId)) {
      throw new ConvexError("Esta pregunta no es de este examen.");
    }
    const r = await ctx.db.get(args.reactivoId);
    if (!r) throw new ConvexError("Esta pregunta ya no está disponible.");
    if (!r.opciones.some((o) => o.id === opcion)) {
      throw new ConvexError("Esa opción no existe en esta pregunta.");
    }

    // La calificación es SERVER-SIDE y se estampa al contestar: así el cierre solo suma y
    // el cliente nunca ve `opcionCorrecta`.
    const correcta = opcion === r.opcionCorrecta;

    const previa = await ctx.db
      .query("respuestas")
      .withIndex("by_intento_reactivo", (q) =>
        q.eq("intentoId", i._id).eq("reactivoId", args.reactivoId),
      )
      .first();
    if (previa) {
      await ctx.db.patch(previa._id, {
        opcionElegida: opcion,
        correcta,
        respondidoEn: ahora,
      });
    } else {
      await ctx.db.insert("respuestas", {
        intentoId: i._id,
        reactivoId: args.reactivoId,
        opcionElegida: opcion,
        correcta,
        respondidoEn: ahora,
      });
    }

    return { respondidoEn: ahora };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Cursor de navegación (LUI-26) — tabla propia, ver el docblock de `posiciones`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recuerda en qué pregunta va la alumna. El cliente la llama INMEDIATAMENTE al navegar
 * (sin debounce: escribe un documento diminuto en una tabla que ninguna query pesada lee,
 * así que no hay nada que amortiguar) y espera su confirmación antes de considerar la
 * posición persistida.
 *
 * Contrato de errores, deliberadamente asimétrico:
 *  · intento AJENO o inexistente → error, como en `responder` (nadie puede escribir sobre
 *    el intento de otra);
 *  · intento propio pero YA ENVIADO, o índice fuera de rango → **no-op silencioso**: una
 *    navegación en vuelo cuando el cierre durable acaba de entregar el examen no debe
 *    pintar un error a la alumna. No se modifica nada (probado).
 */
export const marcarPosicion = mutation({
  args: { intentoId: v.id("intentos"), indice: v.number() },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);

    if (!Number.isInteger(args.indice) || args.indice < 0) {
      throw new ConvexError("Posición inválida.");
    }

    const i = await ctx.db.get(args.intentoId);
    if (!i || i.alumnoId !== userId) {
      throw new ConvexError("Este intento no es tuyo.");
    }
    if (i.estado !== "en_curso") return { guardada: false as const };

    const examen = await ctx.db.get(i.examenId);
    if (!examen || args.indice >= examen.reactivoIds.length) {
      return { guardada: false as const };
    }

    const previa = await ctx.db
      .query("posiciones")
      .withIndex("by_intento", (q) => q.eq("intentoId", i._id))
      .first();
    if (previa) {
      await ctx.db.patch(previa._id, { posicion: args.indice });
    } else {
      await ctx.db.insert("posiciones", {
        intentoId: i._id,
        posicion: args.indice,
      });
    }
    return { guardada: true as const };
  },
});

/**
 * La posición guardada, para arrancar el player donde se quedó. Query aparte y LIGERA: es
 * la única que `marcarPosicion` invalida (ver el docblock de la tabla `posiciones`).
 *
 * `null` cuando el intento no es suyo o no existe; `{posicion: null}` cuando nunca navegó
 * (el player cae entonces en la primera pregunta sin responder).
 */
export const posicionDe = query({
  args: { intentoId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const i = await intentoPropio(ctx, userId, args.intentoId);
    if (!i) return null;
    const fila = await ctx.db
      .query("posiciones")
      .withIndex("by_intento", (q) => q.eq("intentoId", i._id))
      .first();
    return { posicion: fila?.posicion ?? null };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// resultado — Resultados del simulacro (LUI-28)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El resultado de UN intento enviado: puntaje, cuándo se entregó, qué clase de intento fue
 * y su DESGLOSE por sección y área temática.
 *
 * El desglose lo estampa el cierre (LUI-27) y aquí se resuelve a nombres y porcentajes con
 * las MISMAS funciones que la pantalla del instructor (`resultados.derivarResultadoIntento`,
 * que reusa `agregarDesgloses`, `ordenDeColumnas` y `construirAcordeon`): es lo que impide
 * que la alumna y su instructor vean cifras distintas del mismo intento.
 *
 * La META no viaja aquí: vive en `perfilAlumna.mio` y la pantalla combina ambas queries con
 * `useQueries`. Así, editar la meta invalida solo la query de la meta y no obliga a releer
 * el intento con su desglose.
 *
 * El aviso «esto es un repaso, tu resultado oficial es el del primer intento» lo deriva el
 * CLIENTE de `numeroIntento` y de la ventana cruda — aquí no se estampa nada del reloj.
 */
export const resultado = query({
  args: { intentoId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);
    const ahoraServidor = Date.now();
    const i = await intentoPropio(ctx, userId, args.intentoId);
    if (!i) return null;
    if (i.estado !== "enviado") {
      return { problema: "enCurso" as const, intentoId: i._id };
    }

    const asignacion = i.asignacionId ? await ctx.db.get(i.asignacionId) : null;
    const examen = await ctx.db.get(i.examenId);
    const titulo = asignacion?.tituloExamen ?? examen?.titulo ?? "Simulacro";
    // Orden DECLARADO de secciones (LUI-21). Examen borrado ⇒ null: las secciones caen al
    // orden del catálogo, jamás se inventa uno.
    const ordenSecciones = examen?.secciones?.map((s) => s.seccionId) ?? null;

    // ¿Hay un repaso VIVO de esta serie? Espejo EXACTO de `CardCompletado.repasoEnCurso` de
    // «Mis exámenes»: misma sonda, mismo índice. Es un HECHO (existe o no), no un estado de
    // reloj — quién puede repetir lo decide el cliente con su reloj anclado a `ahoraServidor`
    // y las fronteras crudas de abajo. Solo aplica a intentos ASIGNADOS: uno directo no tiene
    // ventana y por tanto no ofrece repaso.
    const repasoEnCurso = i.asignacionId
      ? ((
          await ctx.db
            .query("intentos")
            .withIndex("by_asignacion_alumno_estado", (q) =>
              q
                .eq("asignacionId", i.asignacionId)
                .eq("alumnoId", userId)
                .eq("estado", "en_curso"),
            )
            .first()
        )?._id ?? null)
      : null;

    const base = {
      intentoId: i._id,
      titulo,
      puntaje: i.puntaje ?? null,
      enviadoEn: i.enviadoEn ?? null,
      formaCierre: normalizarFormaCierre(i.formaCierre),
      numeroIntento: i.numeroIntento ?? null,
      asignacionId: i.asignacionId ?? null,
      abreEn: asignacion?.abreEn ?? null,
      cierraEn: asignacion?.cierraEn ?? null,
      repasoEnCurso,
      ahoraServidor,
    };

    // ══ DESGLOSE (LUI-28) ══ Mismo procedimiento que `resultadosExamen.intentosDe`, con la
    // población reducida a un intento: proyección canónica → conjunto distinto de
    // clasificaciones → catálogo con PARO TEMPRANO por bytes → derivación compartida.
    //
    // PRESUPUESTO: 2 docs (sesión) + 1 (intento) + ≤1 (asignación) + 1 (examen) + 1 rango
    // (sonda de repaso) + gets del catálogo, acotados por la forma del examen: ≤20 secciones
    // (`MAX_SECCIONES`) + ≤240 áreas (`MAX_REACTIVOS`) = ≤260 ≪ 500
    // (`MAX_CLASIFICACIONES_RESULTADOS`) y ≪ 4,096 rangos / 32,000 docs. Bytes: sesión ~2 MiB
    // + intento ≤1 MiB (su desglose ~40 KiB) + catálogo ≤1.5 MiB (paro temprano) ≪ 16 MiB.
    const proyeccion = proyectarIntento(i);
    const clas = clasificacionesDistintas([proyeccion], [], ordenSecciones);
    if (clas.desbordado) {
      return { ...base, problema: "clasificaciones" as const, desglose: null };
    }

    let acumulado = 0;
    const catalogo: CatalogoClasificaciones = { secciones: [], areas: [] };
    for (const seccionId of clas.seccionIds) {
      const doc = await ctx.db.get(seccionId);
      acumulado += doc ? getConvexSize(doc) : 0;
      if (excedePresupuestoDeCatalogo(acumulado)) {
        return { ...base, problema: "clasificaciones" as const, desglose: null };
      }
      // Un get nulo produce `nombre: null` — fantasma HONESTO: la cubeta «Sin clasificación
      // vigente» del cliente, jamás «Módulo: undefined».
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
        return { ...base, problema: "clasificaciones" as const, desglose: null };
      }
      catalogo.areas.push({
        areaId,
        nombre: doc?.nombre ?? null,
        orden: doc?.orden ?? null,
        seccionId: doc?.seccionId ?? null,
      });
    }

    return {
      ...base,
      problema: null,
      desglose: derivarResultadoIntento(proyeccion, catalogo, ordenSecciones),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ultimoDiagnostico — el puntaje que encabeza Inicio (LUI-24)
// ─────────────────────────────────────────────────────────────────────────────

/** Estado imposible del read-model: se prefiere un fallo RUIDOSO (boundary de /inicio con
 *  «Reintentar») a servir un dato ajeno o rancio. Mensaje CONSTANTE: no filtra nada. */
const MSG_PUNTERO_INCOHERENTE =
  "No pudimos cargar tu último resultado. Intenta de nuevo.";

/**
 * El diagnóstico más reciente de la alumna, para la tarjeta «Tu avance hacia la meta»
 * (LUI-24). Sin argumentos: solo la sesión propia, sin parámetro por donde nombrar a otra
 * alumna.
 *
 * El puntero NO es autorización (mayor 1 del dictamen v2→v3): tener el `intentoId` en el
 * read-model no demuestra que ese intento sea de quien pregunta. Antes de serializar UN
 * SOLO campo se valida TODO el dominio —igual que `player.resultado` pasa por
 * `intentoPropio`—:
 *   1. el intento existe;
 *   2. `alumnoId === userId` (dueño);
 *   3. `esDiagnosticoElegible` (el predicado canónico: enviado, `numeroIntento === 1`,
 *      `formaCierre` presente, `enviadoEn` FINITO);
 *   4. `enviadoEn === puntero.enviadoEn` (candado de FRESCURA contra punteros rancios).
 * Cualquier violación LANZA con mensaje constante, sin datos del documento.
 *
 * El TÍTULO se deriva al leer con `tituloDeCierre` —no hay copia denormalizada que pueda
 * divergir del examen—: camino de producto = 1 get (asignación con su snapshot
 * `tituloExamen`); peor caso = 2 gets (asignación sin snapshot ⇒ cae al `titulo` del
 * examen; sin ninguno ⇒ «Simulacro»).
 *
 * PRESUPUESTO: 2 (`requireAlumna`) + 1 (puntero) + 1 (intento) + ≤2 (asignación y examen)
 * = ≤6 docs; 3 rangos + hasta 3 gets tras sesión/puntero. O(1) respecto a historial,
 * repasos y cambios de grupo.
 */
export const ultimoDiagnostico = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAlumna(ctx);

    const puntero = await ctx.db
      .query("ultimosDiagnosticos")
      .withIndex("by_user", (q) => q.eq("alumnoId", userId))
      .first();
    if (!puntero) return { ultimo: null };

    const i = await ctx.db.get(puntero.intentoId);
    if (
      !i ||
      i.alumnoId !== userId ||
      !esDiagnosticoElegible(i) ||
      i.enviadoEn !== puntero.enviadoEn
    ) {
      throw new ConvexError(MSG_PUNTERO_INCOHERENTE);
    }

    // Título derivado. Solo leemos el examen si la asignación no aporta el snapshot.
    let tituloAsignacion: string | null = null;
    if (i.asignacionId) {
      const asignacion = await ctx.db.get(i.asignacionId);
      tituloAsignacion = asignacion?.tituloExamen ?? null;
    }
    let tituloExamen: string | null = null;
    if (tituloAsignacion === null) {
      const examen = await ctx.db.get(i.examenId);
      tituloExamen = examen?.titulo ?? null;
    }

    return {
      ultimo: {
        intentoId: i._id,
        titulo: tituloDeCierre(tituloAsignacion, tituloExamen),
        puntajeCrudo: i.puntaje ?? null,
        enviadoEn: i.enviadoEn as number, // finito por `esDiagnosticoElegible`
        numeroIntento: i.numeroIntento ?? null,
      },
    };
  },
});
