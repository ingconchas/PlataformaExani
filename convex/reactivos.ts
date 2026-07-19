import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireStaff } from "./authz";
import { resolverClasificacion } from "./temario";
import { sanear, aTextoPlano, textoPlanoAHtml, MAX_HTML } from "./sanitizar";
import { validarImagen, borrarSiHuerfano, barrer, GRACIA_MS, LOTE } from "./imagenes";
import {
  intencionMaterialValidator,
  materialValidator,
  resolverIntencionMaterial,
  sanearMaterial,
  validarMaterial,
} from "./material";
import {
  esDeBloque,
  lecturaParaBloqueo,
  lecturaParaEnlace,
  resolverLectura,
} from "./lecturaCompat";
import { consumirCuotas, CUOTAS, textoEspera } from "./cuotas";
import { ESTADOS_QUE_CONGELAN } from "./examenEstado";

type Ctx = QueryCtx | MutationCtx;

/**
 * Banco de reactivos (LUI-14) — la lista institucional. Todo el staff (admin e
 * instructor) ve el banco COMPLETO; cada reactivo muestra su autor. El filtrado,
 * el orden y la paginación viven en el CLIENTE (molde uniforme del repo, ver
 * `app/admin/alumnos/alumnos-client.tsx`): estas queries entregan los datos crudos
 * enriquecidos y el cliente los recorta.
 *
 * Por qué el candado va en `enUso` y no dentro de `listar`: son dos presupuestos de
 * lectura INDEPENDIENTES (cada query tiene los suyos: 16 MiB leídos / 32 000
 * documentos / 4 096 rangos). `listar` lee `reactivos`; `enUso` lee los exámenes
 * COMPROMETIDOS (publicados y archivados, ver `calcularBloqueo`). Además `enUso` no
 * depende del usuario → misma respuesta para todos, más cacheable.
 */

/** Nombre visible de un perfil (mismo formato que `sesion.actual`). */
function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/**
 * Los reactivos con edición BLOQUEADA: los que pertenecen a un examen **cuyo estado
 * COMPROMETE el contenido** (`examenEstado.CONGELA`) y que tiene **al menos una
 * asignación**. Regla del AC (congelamiento por compromiso del examen). NO se filtra
 * por `abreEn`: una asignación futura ya compromete el examen, así que basta su
 * EXISTENCIA por `by_examen` (distinto del `metricas.fueAplicada = abreEn <= ahora`,
 * que es «aplicado», no «comprometido»).
 *
 * ⚠️ **`archivado` congela igual que `publicado`** (LUI-20). Un examen archivado «conserva
 * todo su historial de resultados», y esos resultados solo son interpretables si el contenido
 * que los produjo no cambia. Si `archivado` hubiera entrado al schema sin tocar esta función,
 * archivar un examen habría DESCONGELADO sus reactivos en silencio y la primera edición
 * posterior corrompería intentos ya rendidos — una alumna con la revisión abierta vería un
 * reactivo distinto del que contestó, sin un solo error en ningún lado. La lista sale de
 * `ESTADOS_QUE_CONGELAN`, derivada de `CONGELA`, para que un estado futuro no exija tocar
 * este archivo (y para que no compile hasta que alguien decida su semántica de candado).
 *
 * ⚠️ **El candado se PROPAGA AL BLOQUE COMPLETO** (LUI-17): si una sola pregunta de una
 * lectura está comprometida, se congelan TODAS sus hermanas y la lectura misma. El bloque es
 * la unidad que entra a un examen («la lectura se agrega completa»), así que es la unidad que
 * se congela. Sin esta expansión, editar el texto base con una pregunta ya asignada dejaría a
 * una alumna con un intento abierto leyendo un pasaje que ya no sustenta su pregunta.
 *
 * **Coste y peor caso.** Lecturas por llamada: (E_publicados + E_archivados) exámenes + otras
 * tantas sondas de asignación + D reactivos comprometidos DISTINTOS + L lecturas afectadas.
 * El aumento de sondas respecto de mirar solo `publicado` es INTRÍNSECO: para saber si un
 * archivado tiene asignaciones hay que preguntarlo. Aun así **nunca se lee más que un
 * `.collect()` de la tabla, y casi siempre menos**, porque los BORRADORES —el conjunto sucio
 * y sin cota: cada examen a medio armar que alguien abandonó vive ahí para siempre— no
 * contribuyen jamás al candado.
 *
 * **No es gratis**: `obtener` lo invoca en CADA preview del banco. Los límites por
 * transacción son 16 MiB leídos / 32 000 documentos / 4 096 rangos, y `.collect()` lee
 * documentos COMPLETOS, así que el techo real depende del tamaño del contenido y no se puede
 * expresar como un número de exámenes. Los `get` y las sondas van en paralelo, lo que recorta
 * la latencia pero NO el número de lecturas; si algún día pesa, la salida estructural es
 * denormalizar la pertenencia (un campo mantenido al publicar/asignar) en vez de derivarla.
 */
export async function calcularBloqueo(ctx: Ctx): Promise<{
  reactivos: Set<Id<"reactivos">>;
  lecturas: Set<Id<"lecturas">>;
}> {
  // Dos consultas y no un `.collect()` filtrado: `by_estado` es un índice de IGUALDAD (no
  // admite `in`), y cada `.collect()` indexado lee EXACTAMENTE los documentos que hacen
  // match. Van en un `Promise.all` — una sola transacción, dos viajes; Convex cobra y limita
  // por documentos leídos, no por número de escaneos.
  const porEstado = await Promise.all(
    ESTADOS_QUE_CONGELAN.map((estado) =>
      ctx.db
        .query("examenes")
        .withIndex("by_estado", (q) => q.eq("estado", estado))
        .collect(),
    ),
  );
  const comprometidos = porEstado.flat();
  const asignados = await Promise.all(
    comprometidos.map((examen) =>
      ctx.db
        .query("asignaciones")
        .withIndex("by_examen", (q) => q.eq("examenId", examen._id))
        .first(),
    ),
  );
  const reactivos = new Set<Id<"reactivos">>();
  comprometidos.forEach((examen, i) => {
    if (!asignados[i]) return; // comprometido SIN asignaciones → no bloquea
    for (const rid of examen.reactivoIds) reactivos.add(rid);
  });

  // Expansión al bloque, en UNA sola pasada: se resuelven las lecturas afectadas y se
  // añaden TODAS sus preguntas, incluidas las que no están en ningún examen.
  const docs = await Promise.all([...reactivos].map((rid) => ctx.db.get(rid)));
  const lecturas = new Set<Id<"lecturas">>();
  for (const r of docs) {
    if (!r) continue; // id fantasma en `examenes.reactivoIds` (el array no tiene FK)
    const lecturaId = lecturaParaBloqueo(resolverLectura(r));
    if (lecturaId) lecturas.add(lecturaId);
  }
  const bloques = await Promise.all(
    [...lecturas].map((lecturaId) =>
      ctx.db
        .query("reactivos")
        .withIndex("by_bloque", (q) => q.eq("bloque.lecturaId", lecturaId))
        .collect(),
    ),
  );
  for (const bloque of bloques)
    for (const hermana of bloque) reactivos.add(hermana._id);

  return { reactivos, lecturas };
}

/** Los reactivos congelados (ver `calcularBloqueo`). */
export async function reactivosBloqueados(
  ctx: Ctx,
): Promise<Set<Id<"reactivos">>> {
  return (await calcularBloqueo(ctx)).reactivos;
}

/** Las lecturas congeladas. Salen de la MISMA pasada que los reactivos, así que las dos
 *  vistas del candado no pueden discrepar.
 *
 *  ⚠️ Quien necesite AMBOS conjuntos debe llamar `calcularBloqueo` UNA vez: encadenar estos
 *  dos envoltorios recorrería la base dos veces (era el defecto que tenía este archivo). */
export async function lecturasBloqueadas(
  ctx: Ctx,
): Promise<Set<Id<"lecturas">>> {
  return (await calcularBloqueo(ctx)).lecturas;
}

/**
 * El banco completo, en filas LEAN para la lista. Se DEJAN FUERA
 * `opciones`/`opcionCorrecta`/`retroalimentacion`/`imagenId` (van en `obtener`, el
 * preview): aligera el payload al cliente. `esEditable` lo estampa el servidor
 * (admin edita todo; instructor solo lo propio) — el cliente no compara ids.
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const sesion = await requireStaff(ctx);
    const reactivos = await ctx.db.query("reactivos").collect();

    // Mapas id→nombre de la clasificación (3 tablas pequeñas del temario).
    const [secciones, areas, subtemas] = await Promise.all([
      ctx.db.query("secciones").collect(),
      ctx.db.query("areasTematicas").collect(),
      ctx.db.query("subtemas").collect(),
    ]);
    const nombreSeccion = new Map<Id<"secciones">, string>(
      secciones.map((s) => [s._id, s.nombre]),
    );
    const nombreArea = new Map<Id<"areasTematicas">, string>(
      areas.map((a) => [a._id, a.nombre]),
    );
    const nombreSubtema = new Map<Id<"subtemas">, string>(
      subtemas.map((s) => [s._id, s.nombre]),
    );

    // Autores: solo los DISTINTOS presentes (staff, conjunto chico), no toda la
    // tabla `perfiles` (que incluye a los alumnos).
    const autorIds = [...new Set(reactivos.map((r) => r.autorId))];
    const autorPerfiles = await Promise.all(
      autorIds.map((id) =>
        ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first(),
      ),
    );
    const nombrePorAutor = new Map<Id<"users">, string>();
    autorIds.forEach((id, i) => {
      const p = autorPerfiles[i];
      nombrePorAutor.set(id, p ? nombreCompleto(p) : "Autor desconocido");
    });

    // Títulos de lectura (solo las referenciadas). La referencia se resuelve con
    // `lecturaCompat`, que durante la Fase A entiende tanto `bloque` como el `lecturaId`
    // deprecado y SUPRIME la referencia cuando los dos discrepan.
    const refPorReactivo = new Map<Id<"reactivos">, Id<"lecturas"> | null>(
      reactivos.map((r) => [r._id, lecturaParaEnlace(resolverLectura(r))]),
    );
    const lecturaIds = [
      ...new Set([...refPorReactivo.values()].filter((id) => id !== null)),
    ];
    const lecturas = await Promise.all(lecturaIds.map((id) => ctx.db.get(id)));
    const tituloPorLectura = new Map<Id<"lecturas">, string>();
    lecturaIds.forEach((id, i) => {
      const l = lecturas[i];
      if (l) tituloPorLectura.set(id, l.titulo);
    });

    const esAdmin = sesion.perfil.rol === "admin";
    return reactivos.map((r) => ({
      id: r._id,
      // La lista muestra/busca TEXTO PLANO: si es HTML → strip; si es legado → tal cual.
      enunciado:
        r.contenidoFormato === "html" ? aTextoPlano(r.enunciado) : r.enunciado,
      dificultad: r.dificultad,
      // Ids de clasificación para el filtro EN CASCADA del cliente (compara por id,
      // no por nombre → inmune a homónimos bajo padres distintos).
      seccionId: r.seccionId,
      areaId: r.areaId,
      subtemaId: r.subtemaId,
      seccionNombre: nombreSeccion.get(r.seccionId) ?? "—",
      areaNombre: nombreArea.get(r.areaId) ?? "—",
      subtemaNombre: nombreSubtema.get(r.subtemaId) ?? "—",
      autorId: r.autorId,
      autorNombre: nombrePorAutor.get(r.autorId) ?? "Autor desconocido",
      // `tieneLectura` y `lecturaTitulo` se CONSERVAN con su forma de siempre: el frontend
      // anterior los usa para el chip y durante la ventana de despliegue convive con este
      // backend. `lecturaId` se AÑADE (para que el chip pueda volverse enlace en la Fase B)
      // y `lecturaInconsistente` marca el documento con los dos campos en desacuerdo, cuya
      // referencia se suprime en vez de adivinarse.
      tieneLectura: refPorReactivo.get(r._id) != null,
      lecturaId: refPorReactivo.get(r._id) ?? null,
      lecturaTitulo: (() => {
        const ref = refPorReactivo.get(r._id);
        return ref ? (tituloPorLectura.get(ref) ?? null) : null;
      })(),
      lecturaInconsistente: resolverLectura(r).tipo === "inconsistente",
      activo: r.activo,
      esEditable: esAdmin || r.autorId === sesion.userId,
      // Solo el DISCRIMINANTE de presentación (≤13 bytes) para la insignia del banco. Los
      // renglones JAMÁS: `listar` es LEAN a propósito (§ arriba) y el material puede pesar
      // tanto como un enunciado. La búsqueda del banco sigue operando solo sobre el
      // enunciado — el material NO es buscable.
      presentacion: r.material?.tipo ?? "directa",
    }));
  },
});

/**
 * Los ids de reactivos con edición bloqueada (§`reactivosBloqueados`). El cliente
 * arma un `Set` y consulta pertenencia por fila. Query aparte a propósito.
 */
export const enUso = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    return [...(await reactivosBloqueados(ctx))];
  },
});

/**
 * Un reactivo COMPLETO para la vista de solo lectura (preview de LUI-14, «revisar
 * antes de usarlo en un examen»). Recibe el id como `string` y lo normaliza → `null`
 * si es malformado o no existe (misma gracia que `grupos.obtener`). Incluye opciones,
 * respuesta correcta, retroalimentación e imagen; y `esEditable`/`enUso` para que el
 * modal ofrezca un enlace a editar cuando aplique.
 */
export const obtener = query({
  args: { reactivoId: v.string() },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const id = ctx.db.normalizeId("reactivos", args.reactivoId);
    if (!id) return null;
    const r = await ctx.db.get(id);
    if (!r) return null;

    const refLectura = lecturaParaEnlace(resolverLectura(r));
    const [seccion, area, subtema, autorPerfil, lectura] = await Promise.all([
      ctx.db.get(r.seccionId),
      ctx.db.get(r.areaId),
      ctx.db.get(r.subtemaId),
      ctx.db
        .query("perfiles")
        .withIndex("by_user", (q) => q.eq("userId", r.autorId))
        .first(),
      refLectura ? ctx.db.get(refLectura) : Promise.resolve(null),
    ]);
    const imagenUrl = r.imagenId ? await ctx.storage.getUrl(r.imagenId) : null;
    // `reactivosBloqueados` YA viene expandido al bloque, así que el candado del modal
    // coincide con el del banco y con el que impone el servidor: una hermana de una
    // pregunta comprometida no puede ofrecer «Editar».
    const enUso = (await reactivosBloqueados(ctx)).has(id);

    return {
      id: r._id,
      // Enunciado/explicación SIEMPRE como HTML SEGURO para el editor y el preview: si ya
      // es HTML → `sanear` (defensa en profundidad ante import/edición manual de BD); si es
      // legado (sin `contenidoFormato`) → `textoPlanoAHtml` (escapa el `<` literal).
      enunciado:
        r.contenidoFormato === "html"
          ? sanear(r.enunciado)
          : textoPlanoAHtml(r.enunciado),
      opciones: r.opciones,
      opcionCorrecta: r.opcionCorrecta,
      retroalimentacion:
        r.retroalimentacion == null
          ? null
          : r.contenidoFormato === "html"
            ? sanear(r.retroalimentacion)
            : textoPlanoAHtml(r.retroalimentacion),
      // Material de columnas/ordenamiento (LUI-16) re-saneado renglón por renglón, o `null`
      // si el reactivo es de presentación directa. Ver `sanearMaterial`: NO se bifurca por
      // `contenidoFormato`.
      material: r.material ? sanearMaterial(r.material) : null,
      dificultad: r.dificultad,
      // Ids para prellenar el formulario de edición (LUI-15); el preview los ignora.
      seccionId: r.seccionId,
      areaId: r.areaId,
      subtemaId: r.subtemaId,
      imagenId: r.imagenId ?? null,
      seccionNombre: seccion?.nombre ?? "—",
      areaNombre: area?.nombre ?? "—",
      subtemaNombre: subtema?.nombre ?? "—",
      autorNombre: autorPerfil ? nombreCompleto(autorPerfil) : "Autor desconocido",
      // `lecturaId` lo necesita el modal para enlazar a la lectura (Fase B); `lecturaTitulo`
      // se conserva para el frontend anterior durante la ventana de despliegue.
      lecturaId: refLectura,
      lecturaTitulo: lectura?.titulo ?? null,
      lecturaInconsistente: resolverLectura(r).tipo === "inconsistente",
      imagenUrl,
      activo: r.activo,
      esEditable: sesion.perfil.rol === "admin" || r.autorId === sesion.userId,
      enUso,
    };
  },
});

// ── Mutations (LUI-15 · Entrega 1) ───────────────────────────────────────────
// Primer escritor de `reactivos`. Toda escritura: `requireStaff` primero, propiedad
// (instructor solo lo suyo; admin todo) y mantenimiento INCREMENTAL de
// `reactivosCount` (el contrato que LUI-18 dejó para acá, temario.ts:141).

/** Suma `delta` al contador denormalizado de los 3 ancestros. Cada reactivo cae en
 *  EXACTAMENTE una hoja → preserva `count(sección)=Σcount(áreas)`.
 *
 *  `delta` es un `number` y no `±1` porque mover una LECTURA mueve su bloque entero
 *  (LUI-17): se llama UNA vez con ±n en vez de n veces con ±1. Llamarlo en bucle sería
 *  correcto (read-your-writes) pero invita a «optimizarlo» sacando el `get` del bucle, que
 *  reintroduce el lost update. */
export async function ajustarContadores(
  ctx: MutationCtx,
  clasif: {
    seccionId: Id<"secciones">;
    areaId: Id<"areasTematicas">;
    subtemaId: Id<"subtemas">;
  },
  delta: number,
): Promise<void> {
  const seccion = await ctx.db.get(clasif.seccionId);
  if (seccion)
    await ctx.db.patch(clasif.seccionId, {
      reactivosCount: seccion.reactivosCount + delta,
    });
  const area = await ctx.db.get(clasif.areaId);
  if (area)
    await ctx.db.patch(clasif.areaId, {
      reactivosCount: area.reactivosCount + delta,
    });
  const subtema = await ctx.db.get(clasif.subtemaId);
  if (subtema)
    await ctx.db.patch(clasif.subtemaId, {
      reactivosCount: subtema.reactivosCount + delta,
    });
}

const LETRAS = ["a", "b", "c", "d"] as const;
const opcionValidator = v.object({ id: v.string(), texto: v.string() });
const dificultadValidator = v.union(
  v.literal("facil"),
  v.literal("medio"),
  v.literal("dificil"),
);

/**
 * Valida el contenido de un reactivo (opción múltiple) y lo devuelve NORMALIZADO
 * (trims). El cliente refleja estas reglas, pero el servidor es la autoridad: un
 * cliente manipulado no las salta.
 */
export function validarContenido(args: {
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  retroalimentacion: string;
}) {
  if (args.enunciado.length > MAX_HTML || args.retroalimentacion.length > MAX_HTML)
    throw new ConvexError("El contenido es demasiado largo.");
  // Enunciado y explicación son HTML enriquecido (E2): se SANEAN a la whitelist y se
  // valida «no vacío» sobre el TEXTO PLANO (un `<p></p>`/solo-espacios no cuenta). Las
  // OPCIONES siguen siendo texto plano.
  const enunciado = sanear(args.enunciado);
  if (!aTextoPlano(enunciado).trim())
    throw new ConvexError("El enunciado es obligatorio.");

  if (args.opciones.length < 3 || args.opciones.length > 4)
    throw new ConvexError("Un reactivo debe tener entre 3 y 4 opciones.");
  const opciones = args.opciones.map((o) => ({ id: o.id, texto: o.texto.trim() }));
  const ids = new Set<string>();
  for (const o of opciones) {
    if (!o.texto) throw new ConvexError("Cada opción debe tener texto.");
    // Ids canónicos a|b|c|d: son la referencia de las respuestas (LUI-104), no se
    // aceptan vacíos ni arbitrarios de un cliente manipulado.
    if (!(LETRAS as readonly string[]).includes(o.id))
      throw new ConvexError("Id de opción inválido.");
    if (ids.has(o.id)) throw new ConvexError("Ids de opción duplicados.");
    ids.add(o.id);
  }
  if (!ids.has(args.opcionCorrecta))
    throw new ConvexError("Debes marcar cuál es la opción correcta.");

  const retroalimentacion = sanear(args.retroalimentacion);
  if (!aTextoPlano(retroalimentacion).trim())
    throw new ConvexError(
      "La explicación de la respuesta correcta es obligatoria.",
    );

  return { enunciado, opciones, opcionCorrecta: args.opcionCorrecta, retroalimentacion };
}

/**
 * Autoriza una subida de imagen: staff + cuota por usuario. La invoca el HTTP action
 * `/reactivos/imagen` (`convex/http.ts`) DESPUÉS de validar el tamaño real y ANTES de
 * `storage.store`. Es `internalMutation` (no client-facing); el `userId` ya viene
 * autenticado por el HTTP action (`getAuthUserId`). **La barrera de TAMAÑO vive en el HTTP
 * action** (la URL de subida de Convex no la tiene); esta cuota acota el VOLUMEN de
 * operaciones y el sweeper la DURACIÓN — capas adicionales, no la barrera de bytes.
 */
export const autorizarSubida = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!perfil || !perfil.activo || perfil.rol === "alumno")
      throw new ConvexError({
        tipo: "rol",
        mensaje: "Requiere permisos de instructor o administrador.",
      });
    const cuota = await consumirCuotas(ctx, [
      { clave: `subida_imagen:${userId}`, def: CUOTAS.subidaImagenUsuario },
    ]);
    if (!cuota.ok)
      throw new ConvexError({
        tipo: "cuota",
        mensaje: `Demasiadas subidas seguidas; intenta de nuevo en ${textoEspera(cuota.esperaMs)}.`,
      });
    return null;
  },
});

export const crear = mutation({
  args: {
    subtemaId: v.id("subtemas"),
    enunciado: v.string(),
    opciones: v.array(opcionValidator),
    opcionCorrecta: v.string(),
    dificultad: dificultadValidator,
    retroalimentacion: v.string(),
    imagenId: v.optional(v.id("_storage")),
    // Material de columnas/ordenamiento (LUI-16). AUSENTE = presentación DIRECTA. En un
    // insert no hay nada previo que preservar, así que aquí el opcional plano sí basta
    // (en `actualizar` NO — ver `intencionMaterialValidator`).
    material: v.optional(materialValidator),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStaff(ctx);
    const limpio = validarContenido(args);
    // Se valida ANTES de escribir nada (mismo criterio que la imagen): renglones saneados,
    // cotas por lista/renglón y cota agregada en BYTES.
    const material = args.material ? validarMaterial(args.material) : undefined;
    // Imagen opcional (E3): el `storageId` llega del cliente → se VALIDA (metadata real,
    // tipo raster, tamaño, exclusividad) antes de adjuntarlo.
    if (args.imagenId) await validarImagen(ctx, args.imagenId);
    // Camino ESTRICTO (default `exigirDisponible:true`): no se clasifica contenido
    // NUEVO en una rama retirada. La clasificación se DERIVA de `subtemaId`.
    const clasificacion = await resolverClasificacion(ctx, args.subtemaId);
    const id = await ctx.db.insert("reactivos", {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      ...clasificacion,
      dificultad: args.dificultad,
      retroalimentacion: limpio.retroalimentacion,
      contenidoFormato: "html", // enunciado/explicación ya saneados (E2)
      imagenId: args.imagenId,
      material, // ausente = pregunta directa
      autorId: userId, // el autor sale de la sesión, nunca del cliente
      activo: true,
    });
    await ajustarContadores(ctx, clasificacion, 1);
    return { id };
  },
});

export const actualizar = mutation({
  args: {
    id: v.id("reactivos"),
    subtemaId: v.id("subtemas"),
    enunciado: v.string(),
    opciones: v.array(opcionValidator),
    opcionCorrecta: v.string(),
    dificultad: dificultadValidator,
    retroalimentacion: v.string(),
    // Op discriminada de imagen (E3): conservar / quitar / reemplazar. Un opcional NO
    // distinguiría «conservar» de «quitar».
    imagen: v.union(
      v.object({ op: v.literal("mantener") }),
      v.object({ op: v.literal("quitar") }),
      v.object({ op: v.literal("reemplazar"), imagenId: v.id("_storage") }),
    ),
    // Intención de material (LUI-16). ⚠️ AUSENTE = MANTENER, no «quitar»: un
    // `v.optional(materialValidator)` plano sería incompatible hacia atrás — un cliente
    // viejo (ventana de despliegue, pestaña abierta, rollback) omitiría el argumento y el
    // `patch` BORRARÍA el material en silencio. Ver `intencionMaterialValidator`.
    material: v.optional(intencionMaterialValidator),
  },
  handler: async (ctx, args) => {
    const { userId, perfil } = await requireStaff(ctx);
    const r = await ctx.db.get(args.id);
    if (!r) throw new ConvexError("El reactivo no existe.");
    if (perfil.rol !== "admin" && r.autorId !== userId)
      throw new ConvexError("Solo puedes editar tus propios reactivos.");
    // Candado: no se edita el CONTENIDO de un reactivo en un examen vivo (lo
    // corrompería). Desactivarlo sí se permite — eso es `cambiarEstado`.
    // Puerta ÚNICA (LUI-17): una pregunta de bloque NO se edita por aquí. La frontera es
    // esta mutation y no la redirección de la UI — si viviera solo en el enrutado, un
    // cliente manipulado clasificaría la pregunta fuera de su lectura o la sacaría del
    // bloque. Va ANTES del candado para dar el mensaje que orienta a dónde ir.
    const refBloqueo = lecturaParaBloqueo(resolverLectura(r));
    if (refBloqueo) {
      const l = await ctx.db.get(refBloqueo);
      throw new ConvexError(
        `Esta pregunta pertenece a la lectura «${l?.titulo ?? "—"}»; edítala desde la lectura.`,
      );
    }
    if ((await reactivosBloqueados(ctx)).has(args.id))
      throw new ConvexError(
        "Este reactivo está en uso en un examen; no se puede editar, solo desactivar.",
      );
    const limpio = validarContenido(args);

    // Mantener la hoja actual se TOLERA aunque esté retirada; MOVER a otra exige que
    // sea disponible → `exigirDisponible = cambiaSubtema`.
    const cambiaSubtema = args.subtemaId !== r.subtemaId;
    const nueva = await resolverClasificacion(ctx, args.subtemaId, {
      exigirDisponible: cambiaSubtema,
    });
    if (cambiaSubtema) {
      await ajustarContadores(
        ctx,
        { seccionId: r.seccionId, areaId: r.areaId, subtemaId: r.subtemaId },
        -1,
      );
      await ajustarContadores(ctx, nueva, 1);
    }

    // ── Imagen (E3): el candado de arriba ya impidió llegar aquí si el reactivo está en
    // uso → la imagen, como el texto, no cambia en un examen vivo. `nuevaImagen` es lo que
    // quedará en el doc; `borrarViejo`, el blob a eliminar tras el patch. ──
    let nuevaImagen: Id<"_storage"> | undefined = r.imagenId;
    let borrarViejo: Id<"_storage"> | undefined;
    if (args.imagen.op === "quitar") {
      nuevaImagen = undefined;
      borrarViejo = r.imagenId;
    } else if (args.imagen.op === "reemplazar") {
      await validarImagen(ctx, args.imagen.imagenId, args.id);
      nuevaImagen = args.imagen.imagenId;
      borrarViejo = r.imagenId;
    }

    await ctx.db.patch(args.id, {
      enunciado: limpio.enunciado,
      opciones: limpio.opciones,
      opcionCorrecta: limpio.opcionCorrecta,
      ...nueva,
      dificultad: args.dificultad,
      retroalimentacion: limpio.retroalimentacion,
      contenidoFormato: "html", // al editar, el contenido queda saneado como HTML
      imagenId: nuevaImagen,
      // Fragmento de patch del material (LUI-16). Se ESPARCE, no se asigna: `{}` deja la
      // clave fuera del patch (mantener), `{ material: undefined }` la incluye y borra el
      // campo. Escribir `material: algo` aquí reintroduciría el borrado silencioso.
      ...resolverIntencionMaterial(args.material),
    });
    // Borrado del blob viejo TRAS el patch (transaccional: un fallo revierte también el
    // patch). `borrarSiHuerfano` sólo borra si ya ningún OTRO reactivo lo referencia — no
    // rompe la imagen de otro reactivo ante una violación de exclusividad por datos manuales.
    await borrarSiHuerfano(ctx, borrarViejo, nuevaImagen);
    return { id: args.id };
  },
});

/** Baja/alta lógica del reactivo. SIN candado (un reactivo en uso «solo se puede
 *  desactivar», AC) y SIN cambio de contadores (`recalcular` cuenta activos e
 *  inactivos → `activo` es ortogonal al conteo).
 *
 *  ⚠️ Las preguntas de BLOQUE van por `lecturas.cambiarEstadoPregunta` (LUI-17): aquí la
 *  autoridad es `r.autorId`, y para una pregunta de bloque la autoridad debe ser el autor de
 *  la LECTURA. Sin esta guarda, el autor de una pregunta podría retirarla del bloque de otro
 *  — un caso que el fixture del seed producía de verdad, con la lectura y su pregunta en
 *  manos distintas. */
export const cambiarEstado = mutation({
  args: { id: v.id("reactivos"), activo: v.boolean() },
  handler: async (ctx, args) => {
    const { userId, perfil } = await requireStaff(ctx);
    const r = await ctx.db.get(args.id);
    if (!r) throw new ConvexError("El reactivo no existe.");
    if (esDeBloque(resolverLectura(r)))
      throw new ConvexError(
        "Esta pregunta pertenece a una lectura; cambia su estado desde la lectura.",
      );
    if (perfil.rol !== "admin" && r.autorId !== userId)
      throw new ConvexError(
        "Solo puedes cambiar el estado de tus propios reactivos.",
      );
    await ctx.db.patch(args.id, { activo: args.activo });
    return { id: args.id, activo: args.activo };
  },
});

/**
 * Sweeper de blobs de imagen huérfanos (LUI-15 E3; target del cron en `crons.ts`). Borra
 * blobs de `_storage` SIN referencia y más viejos que `GRACIA_MS`. Corre en PROD y dev
 * (los huérfanos se acumulan en prod) → **SIN `exigirDeploymentDeDesarrollo`** (ese guard
 * lanzaría en prod, justo donde debe correr).
 *
 * El `corte` se fija UNA vez (1ª página) y se propaga sin cambiar en cada continuación:
 * un cursor solo es válido con la MISMA consulta. Se valida la FORMA (una continuación con
 * `cursor` sin `corte` recalcularía el corte y rompería el cursor) y que el `corte` nunca
 * sea más reciente que la gracia (un `--prod` por CLI no puede barrer blobs frescos).
 * La lógica de gracia CERO para pruebas vive aparte, en `pruebasImagenes.barrerAhoraDev`
 * (dev-guarded); aquí NO existe.
 */
export const barrerImagenesHuerfanas = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    corte: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const primeraPagina = args.cursor === undefined && args.corte === undefined;
    const continuacion =
      typeof args.cursor === "string" && typeof args.corte === "number";
    if (!primeraPagina && !continuacion)
      throw new ConvexError(
        "barrerImagenesHuerfanas: la 1ª página va sin args; una continuación lleva { cursor, corte } juntos.",
      );
    const limite = Date.now() - GRACIA_MS;
    const corte = args.corte ?? limite;
    if (corte > limite)
      throw new ConvexError(
        "barrerImagenesHuerfanas: el corte no puede ser más reciente que la gracia.",
      );
    const res = await barrer(ctx, corte, args.cursor ?? null, LOTE);
    if (!res.isDone)
      await ctx.scheduler.runAfter(0, internal.reactivos.barrerImagenesHuerfanas, {
        cursor: res.continueCursor,
        corte,
      });
    return { borradas: res.borradas, isDone: res.isDone };
  },
});
