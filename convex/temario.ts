import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAdmin, requireAlumna, requireStaff } from "./authz";
import { canonizar } from "./texto";
import {
  MAX_MODULOS_ACTIVOS,
  MSG_MODULOS_LLENO,
  validarNombreTemario,
} from "./temarioReglas";
import { CONFIRMACION_SOLO_DEV, exigirDeploymentDeDesarrollo } from "./entorno";

/**
 * Temario institucional (LUI-18) — Sección → Área temática → Subtema.
 *
 * Es la única fuente de clasificación de reactivos y, por tanto, la columna
 * vertebral de toda la analítica: si dos reactivos se etiquetan distinto, los
 * reportes por sección dejan de ser comparables.
 */

type Ctx = QueryCtx | MutationCtx;

/**
 * Orden TOTAL de hermanos. `orden` puede traer huecos o empates (el seed no
 * garantiza unicidad; el reordenamiento los sana al renumerar), así que se
 * desempata por `_creationTime` y `_id` —ambos siempre presentes—, dando un orden
 * determinista sin exigir que `orden` sea único.
 *
 * **Exportado a propósito**: lo consumen `construirTemario` (el árbol) y `mover`
 * (el reordenamiento). Si divergieran, «bajar» movería un nodo por encima de un
 * vecino distinto del que se ve debajo cuando hay empates. Es la clase de deriva
 * que este repo ya extrae (`canonizar`→`texto.ts`, `fueAplicada`→`metricas.ts`).
 */
export function porOrden<
  T extends { orden: number; _creationTime: number; _id: string },
>(a: T, b: T): number {
  return (
    a.orden - b.orden ||
    a._creationTime - b._creationTime ||
    a._id.localeCompare(b._id)
  );
}

// ── El núcleo, en un solo lugar ────────────────────────────────────────────

/**
 * Las 3 secciones del núcleo del EXANI II. Viven aquí —y no en cada seed— para
 * que el seed de producción (`bootstrap:sembrarTemarioNucleo`) y el fixture de
 * dev (`seed:cargarDatosDePrueba`) no puedan divergir en los nombres.
 */
export const NUCLEO = [
  "Pensamiento matemático",
  "Comprensión lectora",
  "Redacción indirecta",
] as const;

// ── Clasificación de un reactivo ───────────────────────────────────────────

export type Clasificacion = {
  seccionId: Id<"secciones">;
  areaId: Id<"areasTematicas">;
  subtemaId: Id<"subtemas">;
};

/**
 * Única fuente de la clasificación de un reactivo: deriva los 3 niveles desde el
 * subtema.
 *
 * **Aceptar los tres ids del cliente permitiría incoherencias** (un reactivo cuya
 * sección no es la de su subtema) → el contador del árbol y el filtro del banco
 * darían números distintos con la misma etiqueta, que es el bug que LUI-9 tuvo
 * que reconciliar con `metricas.fueAplicada`. Pasando solo la hoja, la
 * incoherencia es imposible de construir.
 *
 * SIEMPRE valida que la cadena padre exista y sea coherente; si está rota, lanza.
 *
 * `exigirDisponible` (default TRUE) rechaza clasificar en una rama retirada —
 * «los elementos desactivados no se ofrecen para contenido nuevo» (Diseño 11).
 * El seed lo pasa en FALSE a propósito, y no es una puerta trasera: fabrica
 * contenido HISTÓRICO, un reactivo que nació cuando su subtema estaba activo y
 * sobrevivió a su retiro (el «Productos notables · inactivo · 8 reactivos» del
 * mock). **Al CREAR nunca se pasa en false** (no se clasifica contenido NUEVO en una
 * rama retirada). La ÚNICA excepción es `reactivos.actualizar` cuando el reactivo
 * MANTIENE el mismo subtema ya retirado: ahí va en false para poder corregir su
 * contenido sin forzar una reclasificación (mover a OTRA hoja sí exige disponible).
 */
export async function resolverClasificacion(
  ctx: Ctx,
  subtemaId: Id<"subtemas">,
  { exigirDisponible = true }: { exigirDisponible?: boolean } = {},
): Promise<Clasificacion> {
  const subtema = await ctx.db.get(subtemaId);
  if (!subtema) throw new ConvexError("El subtema no existe.");
  const area = await ctx.db.get(subtema.areaId);
  if (!area) {
    throw new ConvexError(
      `El subtema «${subtema.nombre}» apunta a un área temática que no existe.`,
    );
  }
  const seccion = await ctx.db.get(area.seccionId);
  if (!seccion) {
    throw new ConvexError(
      `El área «${area.nombre}» apunta a una sección que no existe.`,
    );
  }

  if (exigirDisponible) {
    // Conjuntiva: basta que un ancestro esté retirado para que la hoja no se
    // ofrezca. Se nombra al culpable, que puede estar dos niveles arriba.
    const retirado = !seccion.activo
      ? `la sección «${seccion.nombre}»`
      : !area.activo
        ? `el área «${area.nombre}»`
        : !subtema.activo
          ? `el subtema «${subtema.nombre}»`
          : null;
    if (retirado) {
      throw new ConvexError(
        `No se puede clasificar contenido nuevo en «${subtema.nombre}»: ${retirado} está desactivado.`,
      );
    }
  }

  return { seccionId: seccion._id, areaId: area._id, subtemaId: subtema._id };
}

// ── Contadores ─────────────────────────────────────────────────────────────

/**
 * Recomputa `reactivosCount` en los tres niveles desde cero.
 *
 * El contador va denormalizado (ver `schema.ts`) y por tanto puede derivar. Esta
 * es la reparación, en el mismo espíritu que el `reparado[]` del seed. **La
 * deriva nunca es corruptora**: el gate de borrado no usa el contador sino una
 * sonda `.first()`, así que un número mal jamás puede autorizar un borrado malo.
 *
 * Cuenta TODOS los reactivos, activos e inactivos: un reactivo desactivado sigue
 * teniendo la referencia, así que sigue impidiendo el borrado del nodo. Si el
 * contador los filtrara, la pantalla diría «0 reactivos» y el borrado se
 * rechazaría igual — un bug de UX garantizado.
 *
 * En la Entrega 1 su único escritor es el seed, que la llama al terminar; el
 * mantenimiento incremental (−1/+1 por escritura) es de LUI-15.
 *
 * Ejecutar:  npx convex run temario:recalcularContadores '{"confirmar":"SOLO_DEV"}'
 */
export const recalcularContadores = internalMutation({
  args: { confirmar: v.literal(CONFIRMACION_SOLO_DEV) },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    return await recalcular(ctx);
  },
});

/** El recálculo, reutilizable desde el seed sin pasar por el CLI. */
export async function recalcular(ctx: MutationCtx): Promise<{
  secciones: number;
  areas: number;
  subtemas: number;
}> {
  const reactivos = await ctx.db.query("reactivos").collect();

  const porSeccion = new Map<string, number>();
  const porArea = new Map<string, number>();
  const porSubtema = new Map<string, number>();
  const suma = (m: Map<string, number>, k: string) =>
    m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of reactivos) {
    suma(porSeccion, r.seccionId);
    suma(porArea, r.areaId);
    suma(porSubtema, r.subtemaId);
  }

  const secciones = await ctx.db.query("secciones").collect();
  const areas = await ctx.db.query("areasTematicas").collect();
  const subtemas = await ctx.db.query("subtemas").collect();

  let cambiados = 0;
  const fijar = async (
    docs: Array<{ _id: Id<"secciones"> | Id<"areasTematicas"> | Id<"subtemas">; reactivosCount: number }>,
    conteos: Map<string, number>,
  ) => {
    for (const d of docs) {
      const real = conteos.get(d._id) ?? 0;
      if (d.reactivosCount !== real) {
        await ctx.db.patch(d._id, { reactivosCount: real });
        cambiados++;
      }
    }
  };
  await fijar(secciones, porSeccion);
  await fijar(areas, porArea);
  await fijar(subtemas, porSubtema);

  return {
    secciones: secciones.length,
    areas: areas.length,
    subtemas: subtemas.length,
    ...(cambiados ? { cambiados } : {}),
  };
}

// ── El árbol ───────────────────────────────────────────────────────────────

export type FilaTemario =
  | {
      nivel: 1;
      id: Id<"secciones">;
      tipo: "nucleo" | "modulo";
      nombre: string;
      activo: boolean;
      disponible: boolean;
      reactivos: number;
      tieneHijos: boolean;
    }
  | {
      nivel: 2;
      id: Id<"areasTematicas">;
      seccionId: Id<"secciones">;
      nombre: string;
      activo: boolean;
      disponible: boolean;
      reactivos: number;
      tieneHijos: boolean;
    }
  | {
      nivel: 3;
      id: Id<"subtemas">;
      seccionId: Id<"secciones">;
      areaId: Id<"areasTematicas">;
      nombre: string;
      activo: boolean;
      disponible: boolean;
      reactivos: number;
      tieneHijos: false;
    };

/**
 * Construye el árbol como **lista aplanada y ya ordenada**: núcleo antes que
 * módulos, y dentro de cada banda por `orden`.
 *
 * El orden es **lógica de dominio, no de presentación** —es el propósito entero
 * del campo `orden`—, así que lo fija el servidor: si el aplanado viviera en el
 * cliente, cada consumidor futuro lo re-derivaría y derivaría mal. Además el
 * separador «MÓDULOS» sale solo (el bloque de módulos es contiguo) y el colapso
 * en el cliente es un `.filter` sin recursión, porque la profundidad es fija por
 * construcción.
 *
 * `disponible` es CONJUNTIVO: el nodo y todos sus ancestros activos. Se calcula
 * al leer y NUNCA se cascadea a la BD, porque la cascada de escritura es
 * irreversible: al reactivar «Álgebra» sería imposible saber cuáles de sus
 * subtemas ya estaban retirados a mano antes. Así `activo` significa exactamente
 * una cosa: «el admin retiró ESTE nodo».
 *
 * Es un helper y no solo una query para que la `opcionesActivas` que consumirá
 * LUI-15 nazca de aquí y no re-derive la regla conjuntiva.
 */
export async function construirTemario(ctx: Ctx): Promise<FilaTemario[]> {
  const secciones = await ctx.db.query("secciones").collect();
  const areas = await ctx.db.query("areasTematicas").collect();
  const subtemas = await ctx.db.query("subtemas").collect();

  const areasPorSeccion = new Map<string, Doc<"areasTematicas">[]>();
  for (const a of areas) {
    const lista = areasPorSeccion.get(a.seccionId) ?? [];
    lista.push(a);
    areasPorSeccion.set(a.seccionId, lista);
  }
  const subtemasPorArea = new Map<string, Doc<"subtemas">[]>();
  for (const s of subtemas) {
    const lista = subtemasPorArea.get(s.areaId) ?? [];
    lista.push(s);
    subtemasPorArea.set(s.areaId, lista);
  }

  const filas: FilaTemario[] = [];
  const bandas = ["nucleo", "modulo"] as const;
  for (const tipo of bandas) {
    const deLaBanda = secciones.filter((s) => s.tipo === tipo).sort(porOrden);
    for (const seccion of deLaBanda) {
      const susAreas = (areasPorSeccion.get(seccion._id) ?? []).sort(porOrden);
      filas.push({
        nivel: 1,
        id: seccion._id,
        tipo: seccion.tipo,
        nombre: seccion.nombre,
        activo: seccion.activo,
        disponible: seccion.activo,
        reactivos: seccion.reactivosCount,
        tieneHijos: susAreas.length > 0,
      });
      for (const area of susAreas) {
        const susSubtemas = (subtemasPorArea.get(area._id) ?? []).sort(porOrden);
        filas.push({
          nivel: 2,
          id: area._id,
          seccionId: seccion._id,
          nombre: area.nombre,
          activo: area.activo,
          disponible: seccion.activo && area.activo,
          reactivos: area.reactivosCount,
          tieneHijos: susSubtemas.length > 0,
        });
        for (const subtema of susSubtemas) {
          filas.push({
            nivel: 3,
            id: subtema._id,
            seccionId: seccion._id,
            areaId: area._id,
            nombre: subtema.nombre,
            activo: subtema.activo,
            disponible: seccion.activo && area.activo && subtema.activo,
            reactivos: subtema.reactivosCount,
            tieneHijos: false,
          });
        }
      }
    }
  }
  return filas;
}

/** El árbol para `/admin/temario`. Solo administradores: el AC de LUI-18 reserva
 *  el temario a administradores. */
export const listarArbol = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await construirTemario(ctx);
  },
});

/**
 * El mismo árbol, pero para el STAFF (banco de reactivos, LUI-14/15). A diferencia
 * de `listarArbol` (`requireAdmin`, la pantalla de gestión), un instructor SÍ puede
 * leer esto: alimenta los dropdowns en cascada del banco y la clasificación al
 * crear un reactivo. Devuelve el árbol COMPLETO —activos e inactivos—: un filtro del
 * banco debe poder alcanzar reactivos bajo ramas retiradas, así que NO se filtra por
 * `disponible` (esa regla conjuntiva la aplica LUI-15 al ofrecer padres para
 * contenido nuevo, no al filtrar lo que ya existe). Read-path congelado: reutiliza
 * `construirTemario` sin tocarlo.
 */
export const listarParaStaff = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    return await construirTemario(ctx);
  },
});

// ── Módulos activos: UN rango, UNA frontera (LUI-36) ────────────────────────

/**
 * Los módulos ACTIVOS por el índice `by_tipo_activo_orden`, con centinela `take(MAX + 1)`.
 *
 * Punto ÚNICO de lectura del dominio: lo llaman el selector de la alumna
 * (`modulosParaAlumna`) y la frontera de escritura (`exigirCupoDeModulos`). Compartirlo es
 * lo que garantiza que «cuántos caben» y «cuántos hay» se respondan contra el MISMO rango —
 * dos consultas distintas podrían discrepar por un `.filter()` mal puesto.
 *
 * El rango incluye `activo` como columna del índice, no como filtro posterior: un
 * `.filter()` de Convex no reduce los documentos escaneados, así que filtrar después haría
 * que cada módulo retirado encareciera para siempre una pantalla de la alumna.
 */
async function leerModulosActivos(
  ctx: Ctx,
): Promise<{ filas: Doc<"secciones">[]; desbordado: boolean }> {
  const filas = await ctx.db
    .query("secciones")
    .withIndex("by_tipo_activo_orden", (q) =>
      q.eq("tipo", "modulo").eq("activo", true),
    )
    .take(MAX_MODULOS_ACTIVOS + 1);
  return {
    filas: filas.slice(0, MAX_MODULOS_ACTIVOS),
    desbordado: filas.length > MAX_MODULOS_ACTIVOS,
  };
}

/**
 * Frontera de ESCRITURA del dominio «módulos activos», para los escritores que agregan DE
 * UNO EN UNO: `crear` (un módulo nace activo) y `cambiarEstado` (reactivación). Responde
 * «¿cabe uno más?»: se llama ANTES de escribir y rechaza cuando ya hay
 * `MAX_MODULOS_ACTIVOS`, de modo que el módulo 30 entra y el 31 no.
 *
 * ⚠️ El TERCER escritor —el seed, que inserta secciones saltándose el CRUD— NO usa esta
 * función, y no es un olvido: siembra VARIOS módulos en una pasada, así que su pregunta es
 * otra («¿el estado FINAL respeta el techo?») y la comprueba tras insertar, dentro de la
 * misma transacción, contra la MISMA constante `MAX_MODULOS_ACTIVOS`. Lo compartido entre
 * los tres es la constante, que vive en el módulo neutral `temarioReglas.ts`; esta función
 * es solo la forma que toma la regla para el alta unitaria. Por eso NO se exporta: fuera de
 * este archivo no hay ningún escritor unitario al que sirva.
 *
 * Dos escrituras simultáneas leen y escriben el mismo rango del índice, así que la
 * serialización de Convex hace reintentar a una y el reintento vuelve a contar: el estado
 * final nunca excede el techo aunque dos administradores actúen a la vez.
 */
async function exigirCupoDeModulos(ctx: MutationCtx): Promise<void> {
  const { filas, desbordado } = await leerModulosActivos(ctx);
  if (desbordado || filas.length >= MAX_MODULOS_ACTIVOS) {
    throw new ConvexError(MSG_MODULOS_LLENO);
  }
}

/**
 * Catálogo de módulos para el selector de la alumna (LUI-36). Es la ÚNICA lectura del
 * temario que un rol `alumno` puede hacer: no expone áreas ni subtemas ni contadores, solo
 * el nombre de las secciones tipo módulo vigentes.
 *
 * Al desbordar el centinela devuelve la lista VACÍA con `catalogoIncompleto: true` — jamás
 * un prefijo. Un prefijo aquí sería preciso y falso a la vez: escondería justo el módulo que
 * la alumna busca y ella no tendría forma de saberlo. Con la frontera de escritura puesta el
 * desborde es inalcanzable con datos válidos; el centinela solo protege del legado.
 *
 * PRESUPUESTO: 2 docs (sesión) + 1 rango de ≤31 docs ⇒ trivial.
 */
export const modulosParaAlumna = query({
  args: {},
  handler: async (ctx) => {
    await requireAlumna(ctx);
    const { filas, desbordado } = await leerModulosActivos(ctx);
    if (desbordado) return { modulos: [], catalogoIncompleto: true };
    return {
      modulos: filas
        .sort(porOrden)
        .map((s) => ({ id: s._id, nombre: s.nombre })),
      catalogoIncompleto: false,
    };
  },
});

// ── CRUD (LUI-18 Entrega 2) ──────────────────────────────────────────────────
// Toda escritura exige sesión de administrador (`requireAdmin`), primera línea.
//
// Cinco dispatchers, no quince: `crear` inserta en tres tablas distintas
// estrechando por el NOMBRE LITERAL de la tabla, y `normalizeId("secciones", id)`
// devuelve un `Id<"secciones">` NO-unión (patrón de `grupos.obtener`), así que
// `patch`/`delete` también se unifican con un `switch (nivel)` sin perder tipos.

const nivelValidator = v.union(
  v.literal("seccion"),
  v.literal("area"),
  v.literal("subtema"),
);

/** `nombre` de un elemento: sin espacios extremos, no vacío, ≤`MAX_NOMBRE_TEMARIO`
 *  caracteres (frontera de escritura de LUI-30). La regla y su copy viven en el módulo
 *  PURO `temarioReglas.ts`, donde `scripts/test-resultados.ts` puede importarlos. */
function nombreLimpio(bruto: string): string {
  return validarNombreTemario(bruto);
}

// ── Unicidad: TRES alcances distintos ───────────────────────────────────────

/**
 * SECCIÓN: unicidad GLOBAL, cruzando bandas núcleo ∪ módulo. El índice
 * `by_tipo_orden` solo cubre una banda, así que aquí sí se hace `.collect()` de
 * toda la tabla (es diminuta) — el modal mezcla los dos tipos en un dropdown
 * plano, luego los nombres deben ser inequívocos entre ellos (como `bootstrap.ts`).
 */
async function exigirNombreSeccionUnico(
  ctx: MutationCtx,
  nombre: string,
  exceptId?: Id<"secciones">,
): Promise<void> {
  const c = canonizar(nombre);
  const todas = await ctx.db.query("secciones").collect();
  if (todas.some((s) => s._id !== exceptId && canonizar(s.nombre) === c)) {
    throw new ConvexError(
      `Ya existe una sección o módulo con el nombre «${nombre}».`,
    );
  }
}

/** ÁREA: unicidad entre hermanas de la misma sección (por el índice). */
async function exigirNombreAreaUnico(
  ctx: MutationCtx,
  seccionId: Id<"secciones">,
  nombre: string,
  exceptId?: Id<"areasTematicas">,
): Promise<void> {
  const c = canonizar(nombre);
  const hermanas = await ctx.db
    .query("areasTematicas")
    .withIndex("by_seccion_orden", (q) => q.eq("seccionId", seccionId))
    .collect();
  if (hermanas.some((a) => a._id !== exceptId && canonizar(a.nombre) === c)) {
    throw new ConvexError(`Ya existe un área «${nombre}» en esta sección.`);
  }
}

/** SUBTEMA: unicidad entre hermanos de la misma área (por el índice). */
async function exigirNombreSubtemaUnico(
  ctx: MutationCtx,
  areaId: Id<"areasTematicas">,
  nombre: string,
  exceptId?: Id<"subtemas">,
): Promise<void> {
  const c = canonizar(nombre);
  const hermanos = await ctx.db
    .query("subtemas")
    .withIndex("by_area_orden", (q) => q.eq("areaId", areaId))
    .collect();
  if (hermanos.some((s) => s._id !== exceptId && canonizar(s.nombre) === c)) {
    throw new ConvexError(`Ya existe un subtema «${nombre}» en esta área.`);
  }
}

// ── Padre ACTIVO para contenido nuevo (gemelo de `validarGrupoActivo`) ───────
// «Los desactivados no se ofrecen para contenido nuevo». Esta regla NO puede
// vivir solo en el modal: una mutation es superficie de cliente (pestaña vieja,
// carrera entre admins). Mismo chequeo conjuntivo que `resolverClasificacion`.

async function exigirSeccionActivaParaAlta(
  ctx: MutationCtx,
  seccionId: Id<"secciones">,
): Promise<void> {
  const seccion = await ctx.db.get(seccionId);
  if (!seccion) throw new ConvexError("La sección no existe.");
  if (!seccion.activo) {
    throw new ConvexError(
      `La sección «${seccion.nombre}» está desactivada; no se le puede agregar contenido nuevo.`,
    );
  }
}

async function exigirAreaActivaParaAlta(
  ctx: MutationCtx,
  areaId: Id<"areasTematicas">,
): Promise<void> {
  const area = await ctx.db.get(areaId);
  if (!area) throw new ConvexError("El área no existe.");
  if (!area.activo) {
    throw new ConvexError(
      `El área «${area.nombre}» está desactivada; no se le puede agregar contenido nuevo.`,
    );
  }
  // Conjuntivo: un subtema no nace bajo un área viva cuya sección está retirada.
  await exigirSeccionActivaParaAlta(ctx, area.seccionId);
}

// ── Reordenar: renumerar la banda a 0..n-1 ───────────────────────────────────

/**
 * PURA: devuelve la banda de hermanos renumerada a 0..n-1 tras mover `moverId` una
 * posición en `direccion`, o `null` si es no-op (el nodo ya está en el extremo o
 * desapareció en una carrera). No intercambia valores: renumerar SE AUTO-SANA (cura
 * huecos y empates del seed). El `patch` lo hace el caller, donde el id ya es
 * concreto (no-unión), así que este helper no toca la BD.
 */
function bandaReordenada<
  T extends { _id: string; orden: number; _creationTime: number },
>(hermanos: T[], moverId: string, direccion: "arriba" | "abajo"): T[] | null {
  const ordenados = [...hermanos].sort(porOrden);
  const i = ordenados.findIndex((d) => d._id === moverId);
  if (i === -1) return null;
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if (j < 0 || j >= ordenados.length) return null; // ya está en el extremo
  [ordenados[i], ordenados[j]] = [ordenados[j], ordenados[i]];
  return ordenados;
}

// ── Los cinco dispatchers ────────────────────────────────────────────────────

/** Alta por el PADRE DIRECTO. La coherencia se garantiza por construcción: un
 *  subtema recibe solo `areaId` (la sección se deriva), no la terna. */
export const crear = mutation({
  args: {
    tipo: v.union(
      v.literal("nucleo"),
      v.literal("modulo"),
      v.literal("area"),
      v.literal("subtema"),
    ),
    nombre: v.string(),
    parentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const nombre = nombreLimpio(args.nombre);

    if (args.tipo === "nucleo" || args.tipo === "modulo") {
      // Capturado en const: el narrowing de `args.tipo` a "nucleo"|"modulo" no
      // sobrevive dentro del closure de `withIndex`.
      const tipo = args.tipo;
      if (args.parentId) {
        throw new ConvexError("Una sección o módulo no tiene elemento padre.");
      }
      await exigirNombreSeccionUnico(ctx, nombre);
      // Un módulo NACE activo (abajo, `activo: true`), así que crear uno consume cupo del
      // dominio acotado por `MAX_MODULOS_ACTIVOS`. El núcleo no: son 3 y los fija el
      // bootstrap.
      if (tipo === "modulo") await exigirCupoDeModulos(ctx);
      const ultimo = await ctx.db
        .query("secciones")
        .withIndex("by_tipo_orden", (q) => q.eq("tipo", tipo))
        .order("desc")
        .first();
      const id = await ctx.db.insert("secciones", {
        nombre,
        tipo,
        activo: true,
        orden: (ultimo?.orden ?? -1) + 1,
        reactivosCount: 0,
      });
      return { id };
    }

    if (args.tipo === "area") {
      const seccionId = ctx.db.normalizeId("secciones", args.parentId ?? "");
      if (!seccionId) throw new ConvexError("Falta la sección donde crear el área.");
      await exigirSeccionActivaParaAlta(ctx, seccionId);
      await exigirNombreAreaUnico(ctx, seccionId, nombre);
      const ultimo = await ctx.db
        .query("areasTematicas")
        .withIndex("by_seccion_orden", (q) => q.eq("seccionId", seccionId))
        .order("desc")
        .first();
      const id = await ctx.db.insert("areasTematicas", {
        seccionId,
        nombre,
        activo: true,
        orden: (ultimo?.orden ?? -1) + 1,
        reactivosCount: 0,
      });
      return { id };
    }

    // subtema
    const areaId = ctx.db.normalizeId("areasTematicas", args.parentId ?? "");
    if (!areaId) throw new ConvexError("Falta el área donde crear el subtema.");
    await exigirAreaActivaParaAlta(ctx, areaId);
    await exigirNombreSubtemaUnico(ctx, areaId, nombre);
    const ultimo = await ctx.db
      .query("subtemas")
      .withIndex("by_area_orden", (q) => q.eq("areaId", areaId))
      .order("desc")
      .first();
    const id = await ctx.db.insert("subtemas", {
      areaId,
      nombre,
      activo: true,
      orden: (ultimo?.orden ?? -1) + 1,
      reactivosCount: 0,
    });
    return { id };
  },
});

/** Renombrar. NO revalida padre activo: renombrar no es «contenido nuevo» (política
 *  tolerante — se puede renombrar un nodo cuyo padre está retirado). */
export const renombrar = mutation({
  args: { nivel: nivelValidator, id: v.string(), nombre: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const nombre = nombreLimpio(args.nombre);
    switch (args.nivel) {
      case "seccion": {
        const id = ctx.db.normalizeId("secciones", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) throw new ConvexError("Sección no encontrada.");
        await exigirNombreSeccionUnico(ctx, nombre, id);
        await ctx.db.patch(id, { nombre });
        return { id };
      }
      case "area": {
        const id = ctx.db.normalizeId("areasTematicas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) throw new ConvexError("Área no encontrada.");
        await exigirNombreAreaUnico(ctx, doc.seccionId, nombre, id);
        await ctx.db.patch(id, { nombre });
        return { id };
      }
      case "subtema": {
        const id = ctx.db.normalizeId("subtemas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) throw new ConvexError("Subtema no encontrado.");
        await exigirNombreSubtemaUnico(ctx, doc.areaId, nombre, id);
        await ctx.db.patch(id, { nombre });
        return { id };
      }
    }
  },
});

/** Desactivar / reactivar (baja lógica). `activo` significa solo «el admin retiró
 *  ESTE nodo»; nunca se cascadea a los hijos (la atenuación la calcula `disponible`
 *  al leer). El cliente pide confirmación al desactivar; reactivar es inmediato. */
export const cambiarEstado = mutation({
  args: { nivel: nivelValidator, id: v.string(), activo: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    switch (args.nivel) {
      case "seccion": {
        const id = ctx.db.normalizeId("secciones", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) throw new ConvexError("Sección no encontrada.");
        // NO-OP ANTES de la frontera: «reactivar» algo que ya está activo no es una
        // transición y no puede consumir cupo. Sin esta salida, con el catálogo lleno el
        // admin no podría re-guardar el estado que YA tiene — un rechazo absurdo.
        if (doc.activo === args.activo) return { id, activo: args.activo };
        // Solo la REACTIVACIÓN de un módulo suma al dominio acotado; desactivar nunca
        // desborda.
        if (args.activo && doc.tipo === "modulo") await exigirCupoDeModulos(ctx);
        await ctx.db.patch(id, { activo: args.activo });
        return { id, activo: args.activo };
      }
      case "area": {
        const id = ctx.db.normalizeId("areasTematicas", args.id);
        if (!id || !(await ctx.db.get(id))) {
          throw new ConvexError("Área no encontrada.");
        }
        await ctx.db.patch(id, { activo: args.activo });
        return { id, activo: args.activo };
      }
      case "subtema": {
        const id = ctx.db.normalizeId("subtemas", args.id);
        if (!id || !(await ctx.db.get(id))) {
          throw new ConvexError("Subtema no encontrado.");
        }
        await ctx.db.patch(id, { activo: args.activo });
        return { id, activo: args.activo };
      }
    }
  },
});

/** Reordenar dentro de la banda de hermanos. Para una sección la banda ES su
 *  `tipo`, así que un núcleo no cruza el separador MÓDULOS — lo impone el alcance
 *  del índice, sin guard. No-op idempotente en los extremos y ante carreras. */
export const mover = mutation({
  args: {
    nivel: nivelValidator,
    id: v.string(),
    direccion: v.union(v.literal("arriba"), v.literal("abajo")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    switch (args.nivel) {
      case "seccion": {
        const id = ctx.db.normalizeId("secciones", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { movido: false };
        const hermanos = await ctx.db
          .query("secciones")
          .withIndex("by_tipo_orden", (q) => q.eq("tipo", doc.tipo))
          .collect();
        const nueva = bandaReordenada(hermanos, id, args.direccion);
        if (!nueva) return { movido: false };
        for (let k = 0; k < nueva.length; k++) {
          if (nueva[k].orden !== k) await ctx.db.patch(nueva[k]._id, { orden: k });
        }
        return { movido: true };
      }
      case "area": {
        const id = ctx.db.normalizeId("areasTematicas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { movido: false };
        const hermanos = await ctx.db
          .query("areasTematicas")
          .withIndex("by_seccion_orden", (q) => q.eq("seccionId", doc.seccionId))
          .collect();
        const nueva = bandaReordenada(hermanos, id, args.direccion);
        if (!nueva) return { movido: false };
        for (let k = 0; k < nueva.length; k++) {
          if (nueva[k].orden !== k) await ctx.db.patch(nueva[k]._id, { orden: k });
        }
        return { movido: true };
      }
      case "subtema": {
        const id = ctx.db.normalizeId("subtemas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { movido: false };
        const hermanos = await ctx.db
          .query("subtemas")
          .withIndex("by_area_orden", (q) => q.eq("areaId", doc.areaId))
          .collect();
        const nueva = bandaReordenada(hermanos, id, args.direccion);
        if (!nueva) return { movido: false };
        for (let k = 0; k < nueva.length; k++) {
          if (nueva[k].orden !== k) await ctx.db.patch(nueva[k]._id, { orden: k });
        }
        return { movido: true };
      }
    }
  },
});

/**
 * Eliminar. Gate = la SONDA (no el contador, que puede derivar): si hay UN reactivo
 * en el subárbol, se rechaza y se ofrece desactivar (regla del AC). Si la sonda es
 * null, se borra el subárbol en cascada — no hay reactivos que perder, solo
 * estructura vacía. La sonda es O(1) en cualquier nivel gracias a las refs
 * denormalizadas de la Entrega 1 (un reactivo lleva `seccionId`/`areaId`/`subtemaId`).
 */
export const eliminar = mutation({
  args: { nivel: nivelValidator, id: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    switch (args.nivel) {
      case "subtema": {
        const id = ctx.db.normalizeId("subtemas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { eliminado: false };
        const reactivo = await ctx.db
          .query("reactivos")
          .withIndex("by_subtema", (q) => q.eq("subtemaId", id))
          .first();
        if (reactivo) {
          throw new ConvexError(
            `«${doc.nombre}» tiene reactivos asociados; desactívalo en vez de eliminarlo.`,
          );
        }
        // ⚠️ Una LECTURA sin preguntas (LUI-17) es invisible a la sonda de reactivos:
        // borrar el subtema la dejaría apuntando a un fantasma. Sonda propia, O(1).
        const lectura = await ctx.db
          .query("lecturas")
          .withIndex("by_subtema", (q) => q.eq("subtemaId", id))
          .first();
        if (lectura) {
          throw new ConvexError(
            `«${doc.nombre}» tiene lecturas asociadas; desactívalo en vez de eliminarlo.`,
          );
        }
        await ctx.db.delete(id);
        return { eliminado: true };
      }
      case "area": {
        const id = ctx.db.normalizeId("areasTematicas", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { eliminado: false };
        const reactivo = await ctx.db
          .query("reactivos")
          .withIndex("by_area", (q) => q.eq("areaId", id))
          .first();
        if (reactivo) {
          throw new ConvexError(
            `«${doc.nombre}» tiene reactivos asociados; desactívala en vez de eliminarla.`,
          );
        }
        const lecturaArea = await ctx.db
          .query("lecturas")
          .withIndex("by_area", (q) => q.eq("areaId", id))
          .first();
        if (lecturaArea) {
          throw new ConvexError(
            `«${doc.nombre}» tiene lecturas asociadas; desactívala en vez de eliminarla.`,
          );
        }
        // Cascada: sus subtemas están garantizados sin reactivos por la sonda de área.
        const subtemas = await ctx.db
          .query("subtemas")
          .withIndex("by_area_orden", (q) => q.eq("areaId", id))
          .collect();
        for (const s of subtemas) await ctx.db.delete(s._id);
        await ctx.db.delete(id);
        return { eliminado: true };
      }
      case "seccion": {
        const id = ctx.db.normalizeId("secciones", args.id);
        const doc = id && (await ctx.db.get(id));
        if (!id || !doc) return { eliminado: false };
        const reactivo = await ctx.db
          .query("reactivos")
          .withIndex("by_seccion", (q) => q.eq("seccionId", id))
          .first();
        if (reactivo) {
          throw new ConvexError(
            `«${doc.nombre}» tiene reactivos asociados; desactívala en vez de eliminarla.`,
          );
        }
        const lecturaSeccion = await ctx.db
          .query("lecturas")
          .withIndex("by_seccion", (q) => q.eq("seccionId", id))
          .first();
        if (lecturaSeccion) {
          throw new ConvexError(
            `«${doc.nombre}» tiene lecturas asociadas; desactívala en vez de eliminarla.`,
          );
        }
        // ⚠️ Un EXAMEN DE MÓDULO (LUI-20) referencia esta sección por id en `tipo.seccionId`,
        // y es invisible a las dos sondas de arriba: puede no tener ni un solo reactivo ni
        // lectura de esta sección (un borrador vacío ya tiene tipo). Sin esta tercera sonda,
        // borrar el módulo dejaría el chip del examen apuntando a un fantasma. Es la frontera
        // que acompaña a la decisión de guardar el ID y no el NOMBRE — la que hace que
        // renombrar la sección actualice el chip solo. O(1) por `by_tipo_seccion`.
        const examenDeModulo = await ctx.db
          .query("examenes")
          .withIndex("by_tipo_seccion", (q) => q.eq("tipo.seccionId", id))
          .first();
        if (examenDeModulo) {
          throw new ConvexError(
            `«${doc.nombre}» tiene exámenes de módulo asociados; desactívala en vez de eliminarla.`,
          );
        }
        // ⚠️ La ESTRUCTURA de un examen (LUI-21, `examenes.secciones`) también referencia
        // secciones por id, y es invisible a la sonda de arriba: una sección de módulo
        // declarada JUNTO a otras produce `tipo: general` (tipo autocalculado) y no aparece
        // en `by_tipo_seccion`; una declarada VACÍA en un borrador tampoco tiene reactivos
        // ni lecturas que la delaten. Un arreglo no es indexable en Convex, así que esta
        // cuarta sonda es un `.collect()` + filtro en JS — aceptable: `examenes` es la tabla
        // chica (mismo presupuesto que asume `calcularBloqueo`).
        const examenes = await ctx.db.query("examenes").collect();
        const conEstaSeccion = examenes.filter((e) =>
          (e.secciones ?? []).some((s) => s.seccionId === id),
        ).length;
        if (conEstaSeccion > 0) {
          throw new ConvexError(
            `«${doc.nombre}» aparece en la estructura de ${conEstaSeccion} examen(es); desactívala en vez de eliminarla.`,
          );
        }
        const areas = await ctx.db
          .query("areasTematicas")
          .withIndex("by_seccion_orden", (q) => q.eq("seccionId", id))
          .collect();
        for (const a of areas) {
          const subtemas = await ctx.db
            .query("subtemas")
            .withIndex("by_area_orden", (q) => q.eq("areaId", a._id))
            .collect();
          for (const s of subtemas) await ctx.db.delete(s._id);
          await ctx.db.delete(a._id);
        }
        await ctx.db.delete(id);
        return { eliminado: true };
      }
    }
  },
});
