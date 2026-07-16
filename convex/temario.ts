import {
  query,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAdmin } from "./authz";
import { CONFIRMACION_SOLO_DEV, exigirDeploymentDeDesarrollo } from "./entorno";

/**
 * Temario institucional (LUI-18) — Sección → Área temática → Subtema.
 *
 * Es la única fuente de clasificación de reactivos y, por tanto, la columna
 * vertebral de toda la analítica: si dos reactivos se etiquetan distinto, los
 * reportes por sección dejan de ser comparables.
 */

type Ctx = QueryCtx | MutationCtx;

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
 * mock). **LUI-15 NUNCA debe pasarlo en false.**
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

  // Orden TOTAL: `orden` puede traer huecos o empates (el reordenamiento de la
  // Entrega 2 los sana al renumerar), y `_creationTime` siempre existe, así que
  // el desempate es determinista sin exigir que `orden` sea único.
  const porOrden = <T extends { orden: number; _creationTime: number; _id: string }>(
    a: T,
    b: T,
  ) => a.orden - b.orden || a._creationTime - b._creationTime || a._id.localeCompare(b._id);

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
