import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { validarImagen, barrer, blobReferenciado, LOTE } from "./imagenes";
import { exigirDeploymentDeDesarrollo, CONFIRMACION_SOLO_DEV } from "./entorno";

/**
 * LA PRUEBA del ciclo de vida de imágenes (LUI-15 E3) — el análogo de `test:sanitizar`
 * para la seguridad de blobs. TODO es DEV-ONLY (`exigirDeploymentDeDesarrollo` + el
 * literal `SOLO_DEV`): un `--prod` accidental aborta.
 *
 * Por qué wrappers dev en vez de probar por la UI: `requireStaff` bloquea las corridas
 * por CLI (no hay sesión), y varias guardas (metadata falsa, exclusividad, avance del
 * cursor del sweeper) no se alcanzan con una subida honesta. Estos wrappers llaman el
 * MISMO `validarImagen`/`barrer` de producción (viven en `convex/imagenes.ts`), así que
 * la prueba cubre el código real, no un duplicado.
 *
 * Lo orquesta `correrPruebasImagenesDev` y lo dispara `scripts/test-imagenes.mjs`.
 */

const CONF = { confirmar: v.literal(CONFIRMACION_SOLO_DEV) };

/** Corre `validarImagen` (el de producción) con args fabricados y reporta si rechazó. */
export const probarValidarImagen = internalMutation({
  args: {
    ...CONF,
    imagenId: v.id("_storage"),
    duenoActual: v.optional(v.id("reactivos")),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    try {
      await validarImagen(ctx, args.imagenId, args.duenoActual);
      return { rechazado: false, mensaje: null as string | null };
    } catch (e) {
      return {
        rechazado: true,
        mensaje: e instanceof ConvexError ? String(e.data) : String(e),
      };
    }
  },
});

/** Borra un blob (para fabricar el caso `meta===null`: subir → borrar → reusar el id). */
export const borrarBlobDev = internalMutation({
  args: { ...CONF, storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    await ctx.storage.delete(args.storageId);
    return { ok: true as const };
  },
});

/** Marca un blob como REFERENCIADO adjuntándolo al primer reactivo del seed (para probar
 *  exclusividad y el «conserva el referenciado» del sweeper), sin pasar por `crear`. */
export const adjuntarBlobAReactivoDev = internalMutation({
  args: { ...CONF, storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const r = await ctx.db.query("reactivos").first();
    if (!r)
      throw new ConvexError("No hay reactivos sembrados; corre el seed primero.");
    await ctx.db.patch(r._id, { imagenId: args.storageId });
    return { reactivoId: r._id };
  },
});

/** ¿Sigue existiendo el blob? (para afirmar que la gracia conserva un huérfano fresco). */
export const blobExisteDev = internalQuery({
  args: { ...CONF, storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    return { existe: (await ctx.db.system.get(args.storageId)) !== null };
  },
});

/** Conteo de blobs de `_storage` (total y sin referencia). Lo usa el E2E para afirmar el
 *  «conteo neto» del borrado síncrono (reemplazar/quitar) y el barrido de huérfanos. */
export const diagnosticoBlobsDev = internalQuery({
  args: { ...CONF },
  handler: async (ctx) => {
    exigirDeploymentDeDesarrollo();
    const blobs = await ctx.db.system.query("_storage").collect();
    let huerfanos = 0;
    for (const b of blobs) if (!(await blobReferenciado(ctx, b._id))) huerfanos++;
    return { total: blobs.length, huerfanos };
  },
});

/** Vacía el bucket de subida de un usuario (por correo) para que el E2E pruebe el rechazo
 *  por cuota de `generarUrlDeSubida`. El reset del seed (que borra `subida_imagen:*`) lo
 *  restaura. */
export const drenarCuotaSubidaDev = internalMutation({
  args: { ...CONF, correo: v.string() },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.correo))
      .first();
    if (!user) throw new ConvexError(`No hay usuario con correo ${args.correo}.`);
    const clave = `subida_imagen:${user._id}`;
    const campos = {
      clave,
      tokens: 0,
      recargadoEn: Date.now(),
      expiraEn: Date.now() + 24 * 60 * 60 * 1000,
    };
    const fila = await ctx.db
      .query("cuotas")
      .withIndex("by_clave", (q) => q.eq("clave", clave))
      .first();
    if (fila) await ctx.db.patch(fila._id, campos);
    else await ctx.db.insert("cuotas", campos);
    return { clave };
  },
});

/**
 * Sweeper con GRACIA CERO — SOLO para pruebas. Aislado del cron productivo
 * (`reactivos.barrerImagenesHuerfanas`, que jamás acepta un corte reciente): fija su
 * PROPIO corte `Date.now()` una vez y lo propaga. Dev-guarded + `SOLO_DEV` (Mayor 2 de
 * auditoría). Devuelve `{ borradas, continueCursor, isDone, corte }` para que la prueba
 * afirme que el corte fue idéntico entre páginas.
 */
export const barrerAhoraDev = internalMutation({
  args: {
    ...CONF,
    cursor: v.optional(v.union(v.string(), v.null())),
    corte: v.optional(v.number()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    exigirDeploymentDeDesarrollo();
    const corte = args.corte ?? Date.now(); // gracia CERO
    return await barrer(ctx, corte, args.cursor ?? null, args.numItems ?? LOTE);
  },
});

/**
 * Orquesta TODAS las aserciones (es una `action` para poder `ctx.storage.store` blobs de
 * prueba; el resto lo hace por `runMutation`/`runQuery` a los wrappers de arriba). Lanza
 * si algo falla (así `npx convex run` sale con código ≠ 0). Barre sus huérfanos al final.
 */
export const correrPruebasImagenesDev = internalAction({
  args: { ...CONF },
  // Tipo de retorno EXPLÍCITO: rompe la inferencia circular (esta action referencia
  // `internal.pruebasImagenes`, que la incluye a ella misma).
  handler: async (ctx): Promise<{ ok: true; aprobadas: number }> => {
    exigirDeploymentDeDesarrollo();
    const C = CONFIRMACION_SOLO_DEV;
    const fallas: string[] = [];
    let aprobadas = 0;
    const check = (nombre: string, cond: boolean) => {
      if (cond) aprobadas++;
      else fallas.push(nombre);
    };
    const lanzo = async (fn: () => Promise<unknown>): Promise<boolean> => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
    const guardar = async (tipo: string, bytes = 8) =>
      await ctx.storage.store(
        new Blob([new Uint8Array(bytes)], { type: tipo }),
      );
    // Barre TODOS los huérfanos (gracia 0), propagando el corte. Deja el _storage sin
    // huérfanos (los referenciados sobreviven).
    const barrerTodo = async () => {
      let cursor: string | null = null;
      let corte: number | undefined;
      for (let i = 0; i < 1000; i++) {
        const r: {
          borradas: number;
          continueCursor: string;
          isDone: boolean;
          corte: number;
        } = await ctx.runMutation(internal.pruebasImagenes.barrerAhoraDev, {
          confirmar: C,
          cursor,
          corte,
          numItems: LOTE,
        });
        corte = r.corte;
        if (r.isDone) return;
        cursor = r.continueCursor;
      }
    };

    try {
      // Línea base determinista: sin huérfanos previos (de una corrida abortada).
      await barrerTodo();

      // ── 1. Guardas de `validarImagen` ──────────────────────────────────────
      const png = await guardar("image/png");
      check(
        "png válido pasa",
        !(
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: png,
          })
        ).rechazado,
      );
      const svg = await guardar("image/svg+xml");
      check(
        "SVG rechazado",
        (
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: svg,
          })
        ).rechazado,
      );
      const grande = await guardar("image/png", 6 * 1024 * 1024 + 1);
      check(
        "tamaño > 5 MB rechazado",
        (
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: grande,
          })
        ).rechazado,
      );
      // meta===null: id VÁLIDO para `v.id` pero ya borrado (un string inventado lo
      // rechazaría el validador antes de llegar a `validarImagen`).
      const efimero = await guardar("image/png");
      await ctx.runMutation(internal.pruebasImagenes.borrarBlobDev, {
        confirmar: C,
        storageId: efimero,
      });
      check(
        "meta===null rechazado (blob borrado y reusado)",
        (
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: efimero,
          })
        ).rechazado,
      );
      // Exclusividad: adjuntar png a un reactivo → validar png ajeno rechaza; con su
      // propio dueño pasa.
      const { reactivoId } = await ctx.runMutation(
        internal.pruebasImagenes.adjuntarBlobAReactivoDev,
        { confirmar: C, storageId: png },
      );
      check(
        "exclusividad: png de otro reactivo rechazado",
        (
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: png,
          })
        ).rechazado,
      );
      check(
        "exclusividad: su propio dueño NO se rechaza",
        !(
          await ctx.runMutation(internal.pruebasImagenes.probarValidarImagen, {
            confirmar: C,
            imagenId: png,
            duenoActual: reactivoId,
          })
        ).rechazado,
      );

      // ── 2. Sweeper paginado + corte estable (Mayor 1) ──────────────────────
      // Estado: png (referenciado, el más VIEJO), svg + grande (huérfanos, más nuevos).
      // Página a página con numItems:1: la 1ª toca png (referenciado → conserva), la 2ª
      // avanza al 1er huérfano (borra) → prueba que el cursor NO se estanca en el
      // referenciado, y que el corte es idéntico entre páginas.
      const p1 = await ctx.runMutation(
        internal.pruebasImagenes.barrerAhoraDev,
        { confirmar: C, numItems: 1 },
      );
      check("sweeper pág.1 conserva el referenciado (borradas 0)", p1.borradas === 0);
      check("sweeper pág.1 no terminó (hay más)", !p1.isDone);
      const p2 = await ctx.runMutation(
        internal.pruebasImagenes.barrerAhoraDev,
        { confirmar: C, numItems: 1, cursor: p1.continueCursor, corte: p1.corte },
      );
      check("sweeper pág.2 borró un huérfano (el cursor avanzó)", p2.borradas === 1);
      check("sweeper: mismo corte en ambas páginas", p1.corte === p2.corte);
      await barrerTodo(); // limpia el resto de huérfanos de esta sección

      // ── 3. Gracia productiva: un huérfano FRESCO no se borra ───────────────
      const fresco = await guardar("image/png");
      await ctx.runMutation(internal.reactivos.barrerImagenesHuerfanas, {});
      check(
        "gracia: huérfano fresco sobrevive al sweeper productivo (24 h)",
        (
          await ctx.runQuery(internal.pruebasImagenes.blobExisteDev, {
            confirmar: C,
            storageId: fresco,
          })
        ).existe,
      );

      // ── 4. Guardas del sweeper productivo: FORMA vs TEMPORAL ───────────────
      check(
        "forma: {corte} sin cursor → rechazado",
        await lanzo(() =>
          ctx.runMutation(internal.reactivos.barrerImagenesHuerfanas, {
            corte: Date.now(),
          }),
        ),
      );
      check(
        "temporal: continuación bien formada con corte reciente → rechazado",
        await lanzo(() =>
          ctx.runMutation(internal.reactivos.barrerImagenesHuerfanas, {
            cursor: "x",
            corte: Date.now(),
          }),
        ),
      );
    } finally {
      await barrerTodo(); // no dejar huérfanos de la prueba
    }

    if (fallas.length)
      throw new Error(
        `test-imagenes: ${fallas.length} FALLAS → ${fallas.join(" · ")}`,
      );
    return { ok: true as const, aprobadas };
  },
});
