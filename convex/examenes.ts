import { query, mutation, type MutationCtx } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { requireStaff } from "./authz";
import { sanear, textoPlanoAHtml } from "./sanitizar";
import { sanearMaterial } from "./material";
import { lecturaParaEnlace, resolverLectura } from "./lecturaCompat";
import {
  estadoDeVentana,
  etiquetaTipo,
  normalizarTipo,
  transicionPermitida,
  ventanaConcluida,
} from "./examenEstado";

/**
 * Biblioteca institucional de exámenes (LUI-20 B). Todo el staff ve la biblioteca
 * COMPLETA con autor visible; el filtrado/orden/paginación viven en el CLIENTE
 * (molde uniforme del repo, ver `reactivos.listar`).
 *
 * Las reglas del ciclo de vida NO viven aquí: viven en `convex/examenEstado.ts`
 * (módulo puro, probado por `scripts/test-examenes.ts`) y este archivo solo las
 * aplica. El candado de contenido tampoco: es `reactivos.calcularBloqueo`.
 *
 * **Tres preguntas de intentos, tres sondas — la asimetría es deliberada:**
 *  · el CANDADO (`calcularBloqueo`) pregunta «¿existe CUALQUIER intento?»
 *    (`by_examen`, sin filtrar estado);
 *  · `tieneResultados` pregunta «¿existe al menos un ENVIADO?» (un `en_curso`
 *    no es un resultado);
 *  · el guard de archivar pregunta «¿existe algún EN CURSO?» (una alumna a media
 *    sesión — archivar debajo de ella es lo que se impide).
 * Unificarlas parecería limpieza y rompería una de las tres semánticas.
 */

/** Nombre visible de un perfil (mismo formato que `sesion.actual`). */
function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/** HTML seguro de un campo de texto del reactivo/lectura: bifurcado por
 *  `contenidoFormato`, calcado de `reactivos.obtener`. El legado (sin formato)
 *  pasa por `textoPlanoAHtml` — sanearlo interpretaría markup dentro de texto
 *  plano y un `<` literal desaparecería. */
function comoHtmlSeguro(
  texto: string,
  contenidoFormato: "html" | undefined,
): string {
  return contenidoFormato === "html" ? sanear(texto) : textoPlanoAHtml(texto);
}

/**
 * La biblioteca completa, en filas LEAN. **Nunca se envía `reactivoIds`**: un Id
 * serializa a ~32 bytes y el arreglo admite hasta 8192 elementos — se envía el
 * CONTEO (lo único que la tabla pinta). Todos los permisos los estampa el
 * servidor; el cliente no compara ids ni re-deriva reglas.
 *
 * Coste: 1 `.collect()` de `examenes` + 1 de `asignaciones` (agrupado en JS: se
 * necesitan TODAS las filas para contar ventanas, así que N rangos indexados
 * leerían los mismos documentos en más viajes) + `secciones` (tabla diminuta) +
 * perfiles SOLO de los autores distintos + **2 sondas indexadas `.first()` por
 * examen** sobre `intentos.by_examen_estado`. `intentos` es la tabla grande
 * (alumnas × exámenes): jamás `.collect()`.
 */
export const listar = query({
  args: {},
  handler: async (ctx) => {
    const sesion = await requireStaff(ctx);
    const esAdmin = sesion.perfil.rol === "admin";
    // UNA muestra del reloj para todas las filas: si cada fila leyera Date.now(),
    // dos asignaciones podrían evaluarse contra instantes distintos y los
    // contadores de ventana no sumarían `asignacionesCount`.
    const ahora = Date.now();

    const examenes = await ctx.db.query("examenes").collect();
    const asignaciones = await ctx.db.query("asignaciones").collect();
    const asigsPorExamen = new Map<Id<"examenes">, Doc<"asignaciones">[]>();
    for (const a of asignaciones) {
      const lista = asigsPorExamen.get(a.examenId) ?? [];
      lista.push(a);
      asigsPorExamen.set(a.examenId, lista);
    }

    // SIN filtrar por `activo`: una sección retirada sigue nombrando a su examen
    // de módulo — retirarla del temario no puede dejar chips diciendo «—».
    const secciones = await ctx.db.query("secciones").collect();
    const nombreSeccion = new Map(secciones.map((s) => [s._id, s.nombre]));

    // Perfiles SOLO de los autores presentes — nunca `perfiles.collect()`, que
    // incluye a todas las alumnas.
    const autorIds = [...new Set(examenes.map((e) => e.autorId))];
    const autorPerfiles = await Promise.all(
      autorIds.map((id) =>
        ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first(),
      ),
    );
    const nombreAutor = new Map<Id<"users">, string>();
    autorIds.forEach((id, i) => {
      const p = autorPerfiles[i];
      nombreAutor.set(id, p ? nombreCompleto(p) : "Autor desconocido");
    });

    // Las dos sondas de intentos por examen, en paralelo (ver el docblock del
    // módulo para la asimetría con el candado).
    const sondas = await Promise.all(
      examenes.map(async (e) => {
        const [enviado, enCurso] = await Promise.all([
          ctx.db
            .query("intentos")
            .withIndex("by_examen_estado", (q) =>
              q.eq("examenId", e._id).eq("estado", "enviado"),
            )
            .first(),
          ctx.db
            .query("intentos")
            .withIndex("by_examen_estado", (q) =>
              q.eq("examenId", e._id).eq("estado", "en_curso"),
            )
            .first(),
        ]);
        return { tieneEnviado: enviado !== null, tieneEnCurso: enCurso !== null };
      }),
    );

    return examenes.map((e, i) => {
      const asigs = asigsPorExamen.get(e._id) ?? [];
      const ventanas = { programadas: 0, abiertas: 0, cerradas: 0 };
      for (const a of asigs) {
        const estado = estadoDeVentana(a.abreEn, a.cierraEn, ahora);
        if (estado === "programada") ventanas.programadas++;
        else if (estado === "abierta") ventanas.abiertas++;
        else ventanas.cerradas++;
      }
      // «Sin concluir» = programadas + abiertas. Mismo criterio que la guarda de
      // `archivar` (ambos usan `estadoDeVentana`/`ventanaConcluida`): la pista de
      // la UI y la autoridad del servidor no pueden divergir en la regla, solo en
      // el instante en que muestrean el reloj.
      const sinConcluir = ventanas.programadas + ventanas.abiertas;

      const puedeGestionar = esAdmin || e.autorId === sesion.userId;
      const tipo = normalizarTipo(e.tipo);
      const seccionNombre =
        tipo.clase === "modulo"
          ? (nombreSeccion.get(tipo.seccionId) ?? null)
          : null;

      const esEditable = puedeGestionar && e.estado === "borrador";
      const puedeSolicitarArchivado = puedeGestionar && e.estado === "publicado";
      // ⚠️ Pista de UI, NUNCA autoridad: una query no se re-evalúa por el paso
      // del tiempo — una suscripción abierta cuando `cierraEn` cruza conserva
      // este booleano obsoleto hasta que algo escriba o el usuario navegue. La
      // mutation `archivar` SIEMPRE recalcula. (Y no se «arregla» con un cron
      // que materialice el estado: reintroduciría la desincronización que la
      // derivación elimina.)
      const archivableAhora =
        puedeSolicitarArchivado && sinConcluir === 0 && !sondas[i].tieneEnCurso;

      return {
        id: e._id,
        titulo: e.titulo,
        duracionMin: e.duracionMin,
        reactivosCount: e.reactivoIds.length,
        estado: e.estado,
        esModulo: tipo.clase === "modulo",
        // El nombre se resuelve AL LEER (el examen guarda el id): renombrar la
        // sección actualiza el chip solo; una referencia colgada pinta «—», no
        // «undefined».
        tipoEtiqueta: etiquetaTipo(tipo, seccionNombre),
        autorId: e.autorId,
        autorNombre: nombreAutor.get(e.autorId) ?? "Autor desconocido",
        asignacionesCount: asigs.length,
        ventanas,
        tieneResultados: sondas[i].tieneEnviado,
        esEditable,
        motivoNoEditable: esEditable
          ? null
          : e.estado === "borrador"
            ? ("ajeno" as const)
            : e.estado,
        puedeSolicitarArchivado,
        archivableAhora,
        // Precedencia FIJA: asignaciones primero (es lo accionable — esperar a
        // que cierren); el intento en curso solo se reporta si no hay
        // asignaciones pendientes. El E2E asevera este orden con SG2, que tiene
        // AMBOS impedimentos.
        motivoNoArchivable: !puedeSolicitarArchivado
          ? null
          : sinConcluir > 0
            ? ({ tipo: "asignaciones", pendientes: sinConcluir } as const)
            : sondas[i].tieneEnCurso
              ? ({ tipo: "intentoEnCurso" } as const)
              : null,
        puedeDesarchivar: puedeGestionar && e.estado === "archivado",
      };
    });
  },
});

/**
 * La vista previa de solo lectura («Ver»). `v.string()` + `normalizeId` → `null`
 * para un id malformado o inexistente (llega de la URL): «no encontrado», no un
 * error — mismo trato que `reactivos.obtener` y `lecturas.obtener`.
 *
 * **Saneo en el servidor (capa 1 de dos):** cada campo de texto sale como HTML
 * SEGURO (bifurcado por `contenidoFormato`; material por `sanearMaterial`). Los
 * sinks del cliente vuelven a sanear (capa 2) — defensa en profundidad ante
 * datos legados, importados o alterados fuera del editor.
 *
 * Los ids FANTASMA de `reactivoIds` (el arreglo no tiene FK) se devuelven como
 * items `{faltante: true}` EN SU POSICIÓN — se cuentan y se muestran, nunca se
 * encogen en silencio: una preview más corta que la columna «Reactivos» sin
 * explicación es indistinguible de un bug.
 */
export const obtener = query({
  args: { examenId: v.string() },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const id = ctx.db.normalizeId("examenes", args.examenId);
    const e = id ? await ctx.db.get(id) : null;
    if (!id || !e) return null;

    // El ORDEN del arreglo es el del autor y se PRESERVA (Promise.all mantiene
    // posiciones): la preview muestra el examen que existe, no uno reordenado.
    const docs = await Promise.all(e.reactivoIds.map((rid) => ctx.db.get(rid)));

    // Lecturas de los bloques presentes, vía el resolutor de compatibilidad:
    // incluye el LEGADO (su pasaje sí se muestra) y SUPRIME el inconsistente —
    // enlazar a una lectura elegida por desempate sería peor que no enlazar.
    const refsLectura = new Set<Id<"lecturas">>();
    for (const r of docs) {
      if (!r) continue;
      const ref = lecturaParaEnlace(resolverLectura(r));
      if (ref) refsLectura.add(ref);
    }
    const lecturaDocs = await Promise.all(
      [...refsLectura].map((lid) => ctx.db.get(lid)),
    );
    const lecturas = lecturaDocs
      .filter((l): l is Doc<"lecturas"> => l !== null)
      .map((l) => ({
        id: l._id,
        titulo: l.titulo, // texto PLANO por contrato del schema — se pinta como texto
        contenidoHtml: comoHtmlSeguro(l.contenido, l.contenidoFormato),
      }));

    const items = await Promise.all(
      docs.map(async (r) => {
        if (!r) return { faltante: true as const };
        return {
          faltante: false as const,
          id: r._id,
          enunciadoHtml: comoHtmlSeguro(r.enunciado, r.contenidoFormato),
          opciones: r.opciones,
          opcionCorrecta: r.opcionCorrecta,
          retroalimentacionHtml:
            r.retroalimentacion == null
              ? null
              : comoHtmlSeguro(r.retroalimentacion, r.contenidoFormato),
          // Re-saneado renglón por renglón; NO se bifurca por `contenidoFormato`
          // (así lo define `sanearMaterial`).
          material: r.material ? sanearMaterial(r.material) : null,
          imagenUrl: r.imagenId ? await ctx.storage.getUrl(r.imagenId) : null,
          dificultad: r.dificultad,
          activo: r.activo,
          lecturaId: lecturaParaEnlace(resolverLectura(r)),
        };
      }),
    );

    const tipo = normalizarTipo(e.tipo);
    const seccionNombre =
      tipo.clase === "modulo"
        ? ((await ctx.db.get(tipo.seccionId))?.nombre ?? null)
        : null;
    const autorPerfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", e.autorId))
      .first();

    return {
      id: e._id,
      titulo: e.titulo,
      descripcion: e.descripcion ?? null,
      estado: e.estado,
      esModulo: tipo.clase === "modulo",
      tipoEtiqueta: etiquetaTipo(tipo, seccionNombre),
      duracionMin: e.duracionMin,
      autorNombre: autorPerfil ? nombreCompleto(autorPerfil) : "Autor desconocido",
      esAutor: e.autorId === sesion.userId,
      // `reactivosCount` (= length, lo que el autor compuso) puede diferir de los
      // items VIVOS; la diferencia se REPORTA, no se traga.
      reactivosCount: e.reactivoIds.length,
      reactivosFaltantes: docs.filter((d) => d === null).length,
      items,
      lecturas,
    };
  },
});

/** Los guards compartidos del par archivar/desarchivar: sesión → existencia →
 *  autorización del objeto. `requireStaff` va PRIMERO — con la existencia antes,
 *  un llamador sin sesión (o una alumna) distinguiría «no existe» de «existe
 *  pero no tengo permiso»: un oráculo de existencia (contrato de `authz.ts`,
 *  mismo orden que `reactivos.actualizar`). */
async function examenAutorizado(
  ctx: MutationCtx,
  examenId: Id<"examenes">,
  verbo: string,
): Promise<Doc<"examenes">> {
  const sesion = await requireStaff(ctx);
  const e = await ctx.db.get(examenId);
  if (!e) throw new ConvexError("El examen no existe.");
  if (sesion.perfil.rol !== "admin" && e.autorId !== sesion.userId)
    throw new ConvexError(`Solo puedes ${verbo} tus propios exámenes.`);
  return e;
}

/**
 * `publicado → archivado`. Dos mutations con nombre (y no un
 * `cambiarEstado({destino})`) para que la transición ilegal sea irrepresentable
 * en el tipo de argumentos.
 *
 * Orden FIJO: sesión → existencia → autorización → **destino ya alcanzado
 * (salida idempotente)** → transición → guardas → patch. La salida idempotente
 * va DESPUÉS de la autorización (si no, un tercero obtiene un oráculo de estado)
 * y ANTES de la transición (si no, el reintento de red de un archivar exitoso
 * lanzaría «transición inválida» y pintaría error sobre una acción que sí
 * funcionó — Convex reintenta mutations).
 *
 * Guardas, con precedencia FIJA (asignaciones primero — es lo accionable):
 *  1. TODAS las asignaciones concluidas. Una futura compromete tanto como una
 *     abierta: al llegar su fecha, un examen archivado quedaría en un estado que
 *     nadie definió («¿le aparece a la alumna o desaparece?») — ambas respuestas
 *     contradicen «retirado de uso». La cancelación de asignaciones es de
 *     LUI-22; esta regla no la presupone.
 *  2. Sin intento EN CURSO — incluidos los DIRECTOS (sin asignación), que
 *     existen porque `asignacionId` es opcional: una alumna a media sesión.
 *     ⚠️ Pasivo documentado: sin autocierre de intentos (LUI-22+/LUI-27), un
 *     `en_curso` zombi bloquea archivar indefinidamente. Aceptado: el rechazo es
 *     reversible (esperar/limpiar); archivar debajo de una alumna no lo es. Por
 *     eso el mensaje NOMBRA la causa — un «no se puede» opaco dejaría a la
 *     administradora sin diagnóstico.
 *
 * Es seguro archivar↔desarchivar SOLO porque `calcularBloqueo` congela también
 * lo archivado (Entrega A): sin eso, archivar→editar→desarchivar produciría un
 * publicado cuyo contenido cambió bajo intentos ya rendidos.
 */
export const archivar = mutation({
  args: { examenId: v.id("examenes") },
  handler: async (ctx, args) => {
    const e = await examenAutorizado(ctx, args.examenId, "archivar");

    if (e.estado === "archivado")
      return { estado: "archivado" as const, cambiado: false };
    if (!transicionPermitida(e.estado, "archivado"))
      throw new ConvexError(
        "Solo se archivan exámenes publicados. Un borrador se elimina, no se retira de uso.",
      );

    const ahora = Date.now();
    const asigs = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen", (q) => q.eq("examenId", args.examenId))
      .collect();
    const pendientes = asigs.filter(
      (a) => !ventanaConcluida(a.abreEn, a.cierraEn, ahora),
    ).length;
    if (pendientes > 0)
      throw new ConvexError(
        pendientes === 1
          ? "Este examen tiene 1 asignación sin concluir. Espera a que cierre o cámbiala antes de archivar."
          : `Este examen tiene ${pendientes} asignaciones sin concluir. Espera a que cierren o cámbialas antes de archivar.`,
      );

    const enCurso = await ctx.db
      .query("intentos")
      .withIndex("by_examen_estado", (q) =>
        q.eq("examenId", args.examenId).eq("estado", "en_curso"),
      )
      .first();
    if (enCurso)
      throw new ConvexError(
        "Hay un intento en curso sobre este examen; no se puede archivar mientras alguien lo presenta.",
      );

    await ctx.db.patch(args.examenId, { estado: "archivado" });
    return { estado: "archivado" as const, cambiado: true };
  },
});

/**
 * `archivado → publicado` — SIEMPRE a publicado, nunca a borrador: así no existe
 * ningún camino (ni transitivo) de vuelta a borrador, y el AC «un publicado con
 * asignaciones no puede volver a borrador» se cumple estructuralmente.
 *
 * ⚠️ El origen se valida EXPLÍCITO (`estado === "archivado"`), no con
 * `transicionPermitida(desde, "publicado")`: esa tabla también contiene
 * `borrador → publicado` (documentada para LUI-21), así que validar solo la
 * transición habría dejado que «desarchivar» PUBLICARA borradores por la puerta
 * trasera, saltándose las fronteras de publicación de LUI-21
 * (`validarBloquesCompletos`, elegibilidad del temario…).
 *
 * Sin guardas extra: vuelve a un estado que sigue congelado por
 * `calcularBloqueo`, y sus asignaciones (todas concluidas desde el archivado; la
 * cancelación no existe aún) no cambian de significado.
 */
export const desarchivar = mutation({
  args: { examenId: v.id("examenes") },
  handler: async (ctx, args) => {
    const e = await examenAutorizado(ctx, args.examenId, "desarchivar");

    if (e.estado === "publicado")
      return { estado: "publicado" as const, cambiado: false };
    if (e.estado !== "archivado")
      throw new ConvexError("Solo se desarchivan exámenes archivados.");

    await ctx.db.patch(args.examenId, { estado: "publicado" });
    return { estado: "publicado" as const, cambiado: true };
  },
});
