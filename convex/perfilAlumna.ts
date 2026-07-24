import { mutation, query } from "./_generated/server";
import { type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireAlumna } from "./authz";
import {
  MSG_CARRERA_OBLIGATORIA,
  MSG_INSTITUCION_OBLIGATORIA,
  limpiarTextoMeta,
  metaDe,
  validarMetaPuntaje,
} from "./metaAlumna";
import { MAX_MODULOS_ACTIVOS } from "./temarioReglas";

/**
 * Perfil ACADÉMICO de la alumna (LUI-36): su meta de admisión y los módulos de su proceso.
 *
 * Todo lo de este módulo es de la PROPIA sesión: no recibe `userId` en ningún argumento y
 * `requireAlumna` es la primera línea de cada función. No existe forma de leer ni escribir el
 * perfil de otra persona porque no hay parámetro por donde nombrarla — el staff tampoco
 * entra (espejo de `requireStaff`, ver `authz.ts`).
 *
 * Las DOS mutations escriben FRAGMENTOS disjuntos y ninguna usa `v.optional` en sus
 * argumentos: un `guardar` único con campos opcionales le permitiría a un cliente viejo
 * BORRAR lo que no conoce, que es justo el accidente que este proyecto ya documentó.
 * La forma legal de la fila y sus cuatro estados viven en `metaAlumna.ts` y en el schema.
 */

export const MSG_MODULOS_DEMASIADOS =
  `No puedes elegir más de ${MAX_MODULOS_ACTIVOS} módulos.`;
export const MSG_MODULO_NO_DISPONIBLE =
  "Uno de los módulos que elegiste ya no está disponible. Vuelve a abrir la lista.";
export const MSG_MODULOS_REPETIDOS = "Hay un módulo repetido en la selección.";
export const MSG_MODULOS_INCOHERENTE =
  "Perfil académico inconsistente: la selección de módulos excede el catálogo.";

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El perfil que pinta la pantalla Perfil (LUI-36) y del que sale la meta con la que
 * Resultados compara el puntaje (LUI-28).
 *
 * ══ MÓDULOS QUE YA NO ESTÁN ══ `temario.cambiarEstado` puede retirar un módulo y
 * `temario.eliminar` borrarlo; Convex no protege los ids guardados aquí. Los ausentes o
 * inactivos NO se filtran en silencio: se CUENTAN en `modulosNoDisponibles` para que la
 * pantalla pueda decirlo antes de que la alumna vuelva a guardar (al guardar, la selección
 * nueva solo admite activos ⇒ los perdidos desaparecen; que eso ocurra a la vista y no a
 * espaldas de ella es toda la diferencia).
 *
 * PRESUPUESTO: 2 docs (sesión) + 1 (`by_user`) + 1 (`users`, para el correo) + ≤1 (grupo) +
 * ≤`MAX_MODULOS_ACTIVOS` gets = **≤35 docs**, todo por id o por índice.
 */
export const mio = query({
  args: {},
  handler: async (ctx) => {
    const { userId, perfil } = await requireAlumna(ctx);

    const fila = await ctx.db
      .query("perfilesAlumna")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // Estado imposible, como la tripleta parcial: la frontera de escritura acota el arreglo
    // a `MAX_MODULOS_ACTIVOS`, así que una fila más larga significa un escritor roto. Falla
    // ruidosa antes que un presupuesto de lectura que ya no se cumple.
    if (fila && fila.modulosIds.length > MAX_MODULOS_ACTIVOS) {
      throw new ConvexError(MSG_MODULOS_INCOHERENTE);
    }

    const modulos: { id: Id<"secciones">; nombre: string; orden: number }[] = [];
    let modulosNoDisponibles = 0;
    for (const id of fila?.modulosIds ?? []) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.tipo !== "modulo" || !doc.activo) {
        modulosNoDisponibles += 1;
        continue;
      }
      modulos.push({ id: doc._id, nombre: doc.nombre, orden: doc.orden });
    }
    // Orden del CATÁLOGO, no el del arreglo guardado: así los chips salen siempre en la misma
    // posición que en el selector, sin depender de en qué orden los tocó la alumna.
    modulos.sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));

    const user = await ctx.db.get(userId);
    const grupo = perfil.grupoId ? await ctx.db.get(perfil.grupoId) : null;

    return {
      nombre: perfil.nombre,
      nombreCompleto: [perfil.nombre, perfil.apellidos].filter(Boolean).join(" "),
      correo: user?.email ?? null,
      grupo: grupo?.nombre ?? null,
      // `metaDe` LANZA ante una tripleta parcial: ver `metaAlumna.ts`.
      meta: metaDe(fila),
      modulos: modulos.map((m) => ({ id: m.id, nombre: m.nombre })),
      modulosNoDisponibles,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Escritura — un fragmento cada una
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La TRIPLETA (institución, carrera, puntaje), siempre completa. Es la ÚNICA escritora de
 * esos tres campos, y ese monopolio es lo que hace imposible el estado parcial que `metaDe`
 * vigila.
 *
 * Upsert explícito: sonda por `by_user` y `patch` o `insert` DENTRO de la misma transacción.
 * Un índice de Convex no es constraint único, así que la unicidad por `userId` la sostiene
 * esta disciplina — misma que documenta `respuestas.by_intento_reactivo` en el schema: dos
 * escrituras simultáneas leen y escriben el mismo rango, la serialización hace reintentar a
 * una, y el reintento ya encuentra la fila y la parchea.
 *
 * Al INSERTAR estampa `modulosIds: []` (el valor legal por defecto; ausencia y vacío
 * significarían lo mismo). Al PARCHEAR no toca `modulosIds`: quien capturó módulos primero no
 * los pierde por fijar después su meta.
 */
export const guardarMeta = mutation({
  args: {
    institucion: v.string(),
    carrera: v.string(),
    puntaje: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);

    const institucionObjetivo = limpiarTextoMeta(
      args.institucion,
      MSG_INSTITUCION_OBLIGATORIA,
    );
    const carreraObjetivo = limpiarTextoMeta(args.carrera, MSG_CARRERA_OBLIGATORIA);
    const metaPuntaje = validarMetaPuntaje(args.puntaje);

    const fila = await ctx.db
      .query("perfilesAlumna")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const actualizadoEn = Date.now();

    if (fila) {
      await ctx.db.patch(fila._id, {
        institucionObjetivo,
        carreraObjetivo,
        metaPuntaje,
        actualizadoEn,
      });
      return { perfilAlumnaId: fila._id };
    }
    const perfilAlumnaId = await ctx.db.insert("perfilesAlumna", {
      userId,
      institucionObjetivo,
      carreraObjetivo,
      metaPuntaje,
      modulosIds: [],
      actualizadoEn,
    });
    return { perfilAlumnaId };
  },
});

/**
 * La selección de módulos, COMPLETA: el arreglo que llega sustituye al guardado. Deseleccionar
 * todo es `[]`, no la ausencia del argumento — por eso `modulosIds` no es opcional ni aquí ni
 * en el schema.
 *
 * VALIDA, no normaliza: ids repetidos y módulos que ya no están activos se RECHAZAN con
 * mensaje. Deduplicar en silencio escondería un cliente roto, y aceptar un módulo retirado
 * dejaría entrar por la puerta de atrás lo que el selector ya no ofrece.
 *
 * Al INSERTAR no escribe la tripleta: quien elige módulos antes de fijar su meta queda en el
 * estado 2, que es legal.
 */
export const guardarModulos = mutation({
  args: { modulosIds: v.array(v.id("secciones")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAlumna(ctx);

    if (args.modulosIds.length > MAX_MODULOS_ACTIVOS) {
      throw new ConvexError(MSG_MODULOS_DEMASIADOS);
    }
    if (new Set(args.modulosIds).size !== args.modulosIds.length) {
      throw new ConvexError(MSG_MODULOS_REPETIDOS);
    }
    for (const id of args.modulosIds) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.tipo !== "modulo" || !doc.activo) {
        throw new ConvexError(MSG_MODULO_NO_DISPONIBLE);
      }
    }

    const fila = await ctx.db
      .query("perfilesAlumna")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const actualizadoEn = Date.now();

    if (fila) {
      await ctx.db.patch(fila._id, { modulosIds: args.modulosIds, actualizadoEn });
      return { perfilAlumnaId: fila._id };
    }
    const perfilAlumnaId = await ctx.db.insert("perfilesAlumna", {
      userId,
      modulosIds: args.modulosIds,
      actualizadoEn,
    });
    return { perfilAlumnaId };
  },
});
