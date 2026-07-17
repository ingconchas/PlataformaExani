import { type MutationCtx, type QueryCtx } from "./_generated/server";
import { type Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

/**
 * Ciclo de vida de las imágenes de reactivos (LUI-15 Entrega 3). Guardas PURAS —
 * funciones planas que toman `ctx`; NO son `mutation`/`internalMutation`, así que
 * **no están en `api`/`internal` y `convex run` no puede invocarlas**. Viven aquí
 * (no en `reactivos.ts`) para que producción y las pruebas dev llamen el MISMO
 * código (no un duplicado).
 *
 * **La frontera de seguridad es server-side**: el `storageId` llega DEL CLIENTE, así
 * que antes de adjuntarlo se valida su metadata real (no se confía en el cliente),
 * su tipo (SVG fuera), su tamaño y la EXCLUSIVIDAD 1 blob ↔ 1 reactivo.
 */

type Ctx = QueryCtx | MutationCtx;

const MIN = 60_000;

/** Tipos raster aceptados al ADJUNTAR. **SVG excluido**: aunque el render es `<img src>`
 *  (que no ejecuta su script), no se admite como defensa en profundidad. */
export const TIPOS_PERMITIDOS = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Tope de tamaño de imagen. Lo IMPONE el HTTP action de subida (`convex/http.ts`) ANTES
 *  de `storage.store`; aquí se re-valida como defensa en profundidad. El VOLUMEN de
 *  operaciones lo acota además la cuota (`reactivos.autorizarSubida`). */
export const MAX_BYTES = 5 * 1024 * 1024;

/** Gracia del sweeper: un blob SIN referencia más viejo que esto es basura. Da margen
 *  a una subida en vuelo (formulario abierto sin guardar todavía). */
export const GRACIA_MS = 24 * 60 * MIN;

/** Tamaño de página del sweeper. */
export const LOTE = 100;

/**
 * ¿Algún reactivo referencia este blob? Es la ÚNICA verdad de «¿huérfano?» y el punto
 * de extensión: hoy `_storage` es solo imágenes de reactivos; si otra feature guarda
 * blobs, DEBE sumar su comprobación aquí o el sweeper los borrará.
 */
export async function blobReferenciado(
  ctx: Ctx,
  imagenId: Id<"_storage">,
): Promise<boolean> {
  const dueno = await ctx.db
    .query("reactivos")
    .withIndex("by_imagen", (q) => q.eq("imagenId", imagenId))
    .first();
  return dueno !== null;
}

/**
 * Borra el blob VIEJO tras un reemplazo/quita, SOLO si ya ningún reactivo lo referencia
 * (el patch del llamador ya movió ESTE reactivo fuera de `viejo`, así que `blobReferenciado`
 * mira a los demás). Protege contra una violación de exclusividad por datos manuales: no
 * deja rota la imagen de otro reactivo. Es la rama de borrado que usa `reactivos.actualizar`
 * (y que prueba `test:imagenes` directamente).
 */
export async function borrarSiHuerfano(
  ctx: MutationCtx,
  viejo: Id<"_storage"> | undefined,
  nuevo: Id<"_storage"> | undefined,
): Promise<void> {
  if (viejo && viejo !== nuevo && !(await blobReferenciado(ctx, viejo)))
    await ctx.storage.delete(viejo);
}

/**
 * Valida el `storageId` que llega DEL CLIENTE antes de adjuntarlo a un reactivo.
 * `duenoActual` (en edición) exceptúa al propio reactivo de la comprobación de
 * exclusividad. Lanza `ConvexError` con mensaje presentable si algo falla.
 */
export async function validarImagen(
  ctx: Ctx,
  imagenId: Id<"_storage">,
  duenoActual?: Id<"reactivos">,
): Promise<void> {
  const meta = await ctx.db.system.get(imagenId);
  if (meta === null)
    throw new ConvexError("La imagen no existe o expiró; vuelve a subirla.");
  if (!meta.contentType || !TIPOS_PERMITIDOS.has(meta.contentType))
    throw new ConvexError(
      "Formato no permitido: usa PNG, JPG, WEBP o GIF (SVG no se acepta).",
    );
  if (meta.size > MAX_BYTES)
    throw new ConvexError("La imagen supera el límite de 5 MB.");
  // Exclusividad 1 blob ↔ 1 reactivo: impide que un cliente manipulado aliaste la imagen de
  // otro reactivo (y con ello induzca borrar un blob aún en uso). Se COLECTAN todos los
  // dueños y se busca CUALQUIERA distinto de `duenoActual`: un `.first()` podría devolver al
  // propio `duenoActual` y ocultar a un tercero si hubiera una violación por datos manuales.
  const duenos = await ctx.db
    .query("reactivos")
    .withIndex("by_imagen", (q) => q.eq("imagenId", imagenId))
    .collect();
  if (duenos.some((r) => r._id !== duenoActual))
    throw new ConvexError("Esa imagen ya pertenece a otro reactivo.");
}

/**
 * UN paso (una página) del sweeper de blobs huérfanos, sobre el rango
 * `_creationTime < corte`. Función PLANA (no registrada): el `corte` lo fija y valida
 * el LLAMADOR y se propaga SIN cambiar por toda la cadena paginada — un cursor solo es
 * válido con la MISMA consulta, así que recalcular el corte entre páginas lo rompería.
 * Borra los blobs de la página que ningún reactivo referencia. Devuelve también el
 * `corte` usado para que las pruebas afirmen que fue idéntico entre páginas.
 */
export async function barrer(
  ctx: MutationCtx,
  corte: number,
  cursor: string | null,
  numItems: number,
): Promise<{
  borradas: number;
  continueCursor: string;
  isDone: boolean;
  corte: number;
}> {
  const pagina = await ctx.db.system
    .query("_storage")
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", corte))
    .paginate({ cursor, numItems });
  let borradas = 0;
  for (const blob of pagina.page) {
    if (!(await blobReferenciado(ctx, blob._id))) {
      await ctx.storage.delete(blob._id);
      borradas++;
    }
  }
  return {
    borradas,
    continueCursor: pagina.continueCursor,
    isDone: pagina.isDone,
    corte,
  };
}
