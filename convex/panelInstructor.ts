import { v } from "convex/values";
import { query } from "./_generated/server";
import { type Doc } from "./_generated/dataModel";
import { requireStaff } from "./authz";
import { MAX_ASIGNACIONES_VIVAS_POR_GRUPO } from "./asignacionDestino";
import {
  CATALOGO_BYTES_PANEL,
  MAX_GRUPOS_CATALOGO_PANEL,
  MAX_GRUPOS_PANEL,
  MAX_GRUPOS_POR_INSTRUCTOR,
  MAX_PERFILES_PANEL_POR_GRUPO,
  MAX_SECCIONES_PANEL,
  PRESUPUESTO_SONDAS_GRUPO,
  ROSTER_BYTES_PANEL,
  SECCIONES_BYTES_PANEL,
  type AsignacionDelPanel,
  type EstadoIntentoAlumna,
  type GrupoDelPanel,
} from "./participacion";

/**
 * PANEL PRINCIPAL DEL INSTRUCTOR (LUI-19) — TRES queries, no una.
 *
 * ══ POR QUÉ TRES ══ Convex admite UN solo `.paginate()` por ejecución de query,
 * y este panel necesita varios: el catálogo de grupos (Q1), el roster de CADA
 * grupo (Q2) y las secciones (Q3) — todos con `maximumBytesRead`, porque el
 * presupuesto de bytes se demuestra con topes del RUNTIME, no con promedios.
 * Cada query tiene su presupuesto contractual PROPIO (rangos, documentos y
 * bytes, incluido el límite duro de Convex de 1 MiB por documento para los gets
 * sueltos y los ~2 docs de `requireStaff`). El cliente une las Q2 con
 * `useQueries` (UN hook, mapa dinámico).
 *
 * ══ CONSISTENCIA ══ Cada Q2 es INTERNAMENTE consistente: sus vivas, su roster y
 * sus sondas salen del MISMO snapshot — X y Y jamás se mezclan entre snapshots.
 * La costura Q1↔Q2 converge por reactividad (misma clase de costura que
 * `paraAsignar` + `existentesDe` en la pantalla 19); mientras converge, la
 * derivación del cliente (`participacion.derivarPanelInstructor`) JAMÁS fabrica
 * datos: card sin barra, cero pendientes de ese grupo, completitud apagada.
 *
 * ══ RELOJ ══ Cada query muestrea `Date.now()` UNA vez (ancla de INICIO — el
 * runtime lo congela) y devuelve fronteras CRUDAS: NADA derivado del reloj se
 * estampa (contrato de `examenEstado.estadoDeVentana`: una query no se
 * re-invalida por el paso del tiempo). La selección `gt("cierraEn", ahora)` es
 * temporal y queda rancia hasta re-query — el CLIENTE corrige en AMBOS sentidos
 * con su reloj anclado: oculta la card cuya `cierraEn` cruzó y revela la
 * programada cuya `abreEn` llegó (por eso el server incluye programadas). `gt` y
 * no `gte`: en `ahora === cierraEn` la ventana ya está cerrada (semiabierto).
 */

function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/**
 * Q1 — todo lo que el panel puede saber SIN rosters ni intentos: sus grupos
 * activos y las asignaciones VIVAS de cada uno (fronteras crudas + título del
 * read-model `tituloExamen`).
 *
 * AUTORIZACIÓN: `requireStaff` — no existe `requireInstructor`; el alcance se
 * deriva de `grupoInstructores.by_instructor` con el userId de la sesión. Un
 * admin que la llame ve su conjunto vacío: INOFENSIVO por construcción (el gate
 * de ruta instructor↔admin es del middleware, no de esta query).
 *
 * FILAS-ALUMNO EXCLUIDAS POR CONSTRUCCIÓN (contrato v1, decisión de producto
 * 2026-07-21): `by_grupo_cierra` con `eq(grupoId)` jamás matchea una asignación
 * individual (`grupoId === undefined`). Es un acceso por índice que SELECCIONA
 * sin interpretar el destino — la debilitación documentada de
 * `asignacionDestino.ts` (no pasa por `destinoDeFila` ni valida el XOR).
 * Coherente con el pacto de `metricas.ts`: LUI-30 migrará las filas-alumno
 * junto con todo lo demás.
 *
 * ESTADOS DE PROBLEMA (explícitos, jamás truncado silencioso):
 *  · `membresiaDesbordada` — legado con > MAX_GRUPOS_POR_INSTRUCTOR uniones
 *    (tamaño real desconocido): SOLO problema, sin datos.
 *  · `catalogoDesbordado` — el scan de `grupos` se cortó por filas o bytes: la
 *    intersección sería incompleta ⇒ SOLO problema.
 *  · `gruposOmitidos` — más de MAX_GRUPOS_PANEL activos: se procesan los
 *    primeros 20 del ORDEN DEL ÍNDICE de uniones (conjunto sin dimensión
 *    temporal — estable) y el campo lo DICE (el cliente distingue «exactamente
 *    20» de «truncado»).
 *  · `problema: "asignaciones_vivas"` por grupo — legado con > 30 vivas: sus
 *    asignaciones NO se procesan (mostrar «las 30 más próximas» sería una
 *    verdad que el paso del tiempo vuelve mentira).
 *  · `asignacionesLegadasOmitidas` — filas pre-read-model sin `tituloExamen`.
 *
 * PRESUPUESTO CONTRACTUAL (peor caso bajo las cotas):
 *  · Rangos: 2 (requireStaff) + 1 (uniones take 101) + 1 (scan paginado de
 *    grupos) + 20 (vivas take 31) = **24 ≪ 4,096**.
 *  · Documentos: ~2 + 101 + ≤201 + ≤620 = **≤ 924 ≪ 32,000**.
 *  · Bytes: ≤2 MiB (2 docs de sesión × 1 MiB/doc, límite duro de Convex) +
 *    uniones (forma fija, ~0.1 KiB c/u ≈ 10 KiB) + scan ≤ CATALOGO_BYTES_PANEL
 *    (512 KiB, lo garantiza el runtime) + ≤620 asignaciones de forma fija con
 *    título ≤160 (~0.7 KiB c/u ≈ 0.45 MiB) ≈ **< 3 MiB ≪ 16 MiB**.
 */
export const resumen = query({
  args: {},
  handler: async (ctx) => {
    const sesion = await requireStaff(ctx);
    // Ancla de INICIO: una sola muestra alimenta la selección temporal y el
    // ancla del reloj del cliente (re-muestrear no daría otro valor).
    const ahora = Date.now();

    const base = {
      ahoraServidor: ahora,
      nombre: sesion.perfil.nombre, // nombre de PILA (precedente panel.resumen)
      grupos: [] as GrupoDelPanel[],
      asignaciones: [] as AsignacionDelPanel[],
      gruposOmitidos: false,
      membresiaDesbordada: false,
      catalogoDesbordado: false,
      asignacionesLegadasOmitidas: false,
    };

    const uniones = await ctx.db
      .query("grupoInstructores")
      .withIndex("by_instructor", (q) => q.eq("instructorId", sesion.userId))
      .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
    if (uniones.length > MAX_GRUPOS_POR_INSTRUCTOR) {
      return { ...base, membresiaDesbordada: true };
    }

    // El ÚNICO paginate de esta query: scan del catálogo de grupos con tope de
    // filas Y bytes. No hay `ctx.db.get` por unión a propósito: 100 gets × el
    // límite de 1 MiB/doc no cabe en el presupuesto; un scan byte-capped sí.
    const catalogo = await ctx.db.query("grupos").paginate({
      numItems: MAX_GRUPOS_CATALOGO_PANEL + 1,
      cursor: null,
      maximumRowsRead: MAX_GRUPOS_CATALOGO_PANEL + 1,
      maximumBytesRead: CATALOGO_BYTES_PANEL,
    });
    // `numItems` es tamaño inicial, no límite: el corte se detecta con AMBAS
    // señales (página más larga que el tope ∨ paginación incompleta).
    if (
      catalogo.page.length > MAX_GRUPOS_CATALOGO_PANEL ||
      !catalogo.isDone
    ) {
      return { ...base, catalogoDesbordado: true };
    }
    const catalogoPorId = new Map(catalogo.page.map((g) => [g._id, g]));

    // Intersección uniones ∩ catálogo, filtro `activo`, dedupe — en el ORDEN DEL
    // ÍNDICE de uniones (estable; sin dimensión temporal).
    const activos: Doc<"grupos">[] = [];
    const vistos = new Set<string>();
    for (const u of uniones) {
      const key = u.grupoId as string;
      if (vistos.has(key)) continue;
      vistos.add(key);
      const g = catalogoPorId.get(u.grupoId);
      if (g && g.activo) activos.push(g);
    }
    const gruposOmitidos = activos.length > MAX_GRUPOS_PANEL;
    const procesados = activos.slice(0, MAX_GRUPOS_PANEL);

    const grupos: GrupoDelPanel[] = [];
    const asignaciones: AsignacionDelPanel[] = [];
    let asignacionesLegadasOmitidas = false;
    for (const g of procesados) {
      const vivas = await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo_cierra", (q) =>
          q.eq("grupoId", g._id).gt("cierraEn", ahora),
        )
        .take(MAX_ASIGNACIONES_VIVAS_POR_GRUPO + 1);
      if (vivas.length > MAX_ASIGNACIONES_VIVAS_POR_GRUPO) {
        grupos.push({
          grupoId: g._id,
          nombre: g.nombre,
          problema: "asignaciones_vivas",
        });
        continue;
      }
      grupos.push({ grupoId: g._id, nombre: g.nombre });
      for (const a of vivas) {
        if (a.tituloExamen === undefined) {
          asignacionesLegadasOmitidas = true;
          continue;
        }
        asignaciones.push({
          asignacionId: a._id,
          examenId: a.examenId,
          titulo: a.tituloExamen,
          grupoId: g._id,
          abreEn: a.abreEn,
          cierraEn: a.cierraEn,
        });
      }
    }

    return {
      ...base,
      grupos,
      asignaciones,
      gruposOmitidos,
      asignacionesLegadasOmitidas,
    };
  },
});

/**
 * Q2 — la participación de UN grupo: roster activo (en PROYECCIÓN
 * `{alumnoId, nombre}` — jamás perfiles completos) y, por asignación viva, el
 * estado de intento de cada alumna. El cliente monta una por grupo activo con
 * vivas (`useQueries` deduplica suscripciones idénticas).
 *
 * AUTORIZACIÓN PROPIA (no confía en que solo la llame el panel): el userId de la
 * sesión debe instruir el grupo (`by_instructor`, sonda acotada) y el grupo debe
 * existir y estar ACTIVO. Si no → `null`. Ese `null` viaja INTACTO por
 * `useQueries` y el cliente lo representa como `"sin_acceso"` (problema, no
 * carga): es legítimo entre snapshots — membresía revocada o grupo cerrado
 * después de que Q1 lo listó.
 *
 * SONDAS (la tabla `intentos` es la GRANDE — jamás se colecciona): por pareja
 * (asignación viva × alumna activa), DOS `.first()` sobre
 * `by_asignacion_alumno_estado` — enumeración exhaustiva de `ESTADOS_INTENTO`:
 * primero `"enviado"` (completó, gana), si no `"en_curso"` — ≤2 rangos y ≤2 docs
 * por pareja SIN IMPORTAR reintentos. Las parejas se cuentan ANTES de sondear:
 * exceso → `sondasOmitidas` (sin sondear, y el roster NO viaja), jamás un fallo
 * de límites a mitad de lectura. Concurrencia: `Promise.all` por asignación
 * (≤ roster ≪ 1,000 operaciones concurrentes).
 *
 * PRESUPUESTO CONTRACTUAL (peor caso bajo las cotas):
 *  · Rangos: 2 (requireStaff) + 1 (uniones) + 1 (vivas) + 1 (roster paginado) +
 *    2×512 (sondas) = **1,029 ≪ 4,096**.
 *  · Documentos: ~2 + 101 + 1 (grupo) + 31 + ≤201 + ≤1,024 = **≤ 1,360 ≪ 32,000**.
 *  · Bytes: ≤2 MiB (sesión) + 10 KiB (uniones) + ≤1 MiB (get del grupo — límite
 *    duro de 1 MiB/doc) + 22 KiB (vivas) + ≤ ROSTER_BYTES_PANEL (256 KiB,
 *    runtime) + ≤1,024 intentos de forma fija SIN strings libres (~0.25 KiB ≈
 *    0.26 MiB) ≈ **< 3.6 MiB ≪ 16 MiB**.
 */
export const participacionDeGrupo = query({
  args: { grupoId: v.id("grupos") },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const ahora = Date.now();

    // Membresía: sonda acotada (si el legado la satura, el grupo pedido puede no
    // aparecer entre las 101 primeras — se niega el acceso; Q1 ya reporta
    // `membresiaDesbordada` y el panel ni siquiera monta esta Q2).
    const uniones = await ctx.db
      .query("grupoInstructores")
      .withIndex("by_instructor", (q) => q.eq("instructorId", sesion.userId))
      .take(MAX_GRUPOS_POR_INSTRUCTOR + 1);
    if (!uniones.some((u) => u.grupoId === args.grupoId)) return null;

    const grupo = await ctx.db.get(args.grupoId);
    if (!grupo || !grupo.activo) return null;

    const vivas = await ctx.db
      .query("asignaciones")
      .withIndex("by_grupo_cierra", (q) =>
        q.eq("grupoId", args.grupoId).gt("cierraEn", ahora),
      )
      .take(MAX_ASIGNACIONES_VIVAS_POR_GRUPO + 1);
    // Defensivo (el panel no monta Q2 de un grupo que Q1 marcó en problema): un
    // legado con >30 vivas no puede sondearse honestamente → sin acceso a datos.
    if (vivas.length > MAX_ASIGNACIONES_VIVAS_POR_GRUPO) return null;

    const base = {
      grupoId: args.grupoId,
      alumnas: [] as { alumnoId: Doc<"perfiles">["userId"]; nombre: string }[],
      porAsignacion: [] as {
        asignacionId: Doc<"asignaciones">["_id"];
        porAlumna: {
          alumnoId: Doc<"perfiles">["userId"];
          estado: EstadoIntentoAlumna;
        }[];
      }[],
      sondasOmitidas: false,
    };

    // Sin vivas no hay barras ni pendientes que derivar: ni el roster se lee.
    if (vivas.length === 0) return base;

    // El ÚNICO paginate de esta query: roster con tope de filas Y bytes. La cota
    // cuenta PERFILES del índice `by_grupo` (inactivos incluidos), no alumnas.
    const roster = await ctx.db
      .query("perfiles")
      .withIndex("by_grupo", (q) => q.eq("grupoId", args.grupoId))
      .paginate({
        numItems: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        cursor: null,
        maximumRowsRead: MAX_PERFILES_PANEL_POR_GRUPO + 1,
        maximumBytesRead: ROSTER_BYTES_PANEL,
      });
    if (
      roster.page.length > MAX_PERFILES_PANEL_POR_GRUPO ||
      !roster.isDone
    ) {
      // Estado de problema explícito: sin roster no hay Y honesto, así que no
      // viajan ni alumnas ni sondas (jamás un «0 de Y» fabricado).
      return { ...base, problema: "roster" as const };
    }

    const alumnas = roster.page
      .filter((p) => p.rol === "alumno" && p.activo)
      .map((p) => ({ alumnoId: p.userId, nombre: nombreCompleto(p) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const parejas = vivas.length * alumnas.length;
    if (parejas > PRESUPUESTO_SONDAS_GRUPO) {
      return { ...base, sondasOmitidas: true };
    }

    const porAsignacion = [];
    for (const a of vivas) {
      const resultados = await Promise.all(
        alumnas.map(async (al) => {
          const enviado = await ctx.db
            .query("intentos")
            .withIndex("by_asignacion_alumno_estado", (q) =>
              q
                .eq("asignacionId", a._id)
                .eq("alumnoId", al.alumnoId)
                .eq("estado", "enviado"),
            )
            .first();
          if (enviado)
            return { alumnoId: al.alumnoId, estado: "enviado" as const };
          const enCurso = await ctx.db
            .query("intentos")
            .withIndex("by_asignacion_alumno_estado", (q) =>
              q
                .eq("asignacionId", a._id)
                .eq("alumnoId", al.alumnoId)
                .eq("estado", "en_curso"),
            )
            .first();
          if (enCurso)
            return { alumnoId: al.alumnoId, estado: "en_curso" as const };
          return null;
        }),
      );
      porAsignacion.push({
        asignacionId: a._id,
        porAlumna: resultados.filter((r) => r !== null),
      });
    }

    return { ...base, alumnas, porAsignacion };
  },
});

/**
 * Q3 — la card «Tu material»: conteo del banco INSTITUCIONAL como
 * Σ `secciones.reactivosCount` (el agregado denormalizado de LUI-18 — contar
 * leyendo `reactivos` está PROHIBIDO por escala, docblock del schema; bonus: la
 * suscripción es a la tabla chica). Semántica FIJADA: cuenta FILAS del banco,
 * activos e inactivos (desactivar un reactivo no decrementa el contador —
 * `reactivos.cambiarEstado` no llama `ajustarContadores`); la deriva se repara
 * con `temario:recalcularContadores`.
 *
 * SU único paginate lee `secciones` con tope de filas y bytes; corte →
 * `{ totalReactivos: null, desbordado: true }` — jamás una cifra inventada.
 * Presupuesto: 2 rangos + ~9 docs + ≤ SECCIONES_BYTES_PANEL — trivialmente
 * dentro de límites.
 */
export const material = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const secciones = await ctx.db.query("secciones").paginate({
      numItems: MAX_SECCIONES_PANEL + 1,
      cursor: null,
      maximumRowsRead: MAX_SECCIONES_PANEL + 1,
      maximumBytesRead: SECCIONES_BYTES_PANEL,
    });
    if (secciones.page.length > MAX_SECCIONES_PANEL || !secciones.isDone) {
      return { totalReactivos: null, desbordado: true };
    }
    return {
      totalReactivos: secciones.page.reduce(
        (s, x) => s + x.reactivosCount,
        0,
      ),
      desbordado: false,
    };
  },
});
