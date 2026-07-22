import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { requireStaff } from "./authz";
import {
  MAX_GRUPOS_DESTINO,
  MAX_ASIGNACIONES_POR_EXAMEN,
  MAX_ASIGNACIONES_VIVAS_POR_ALUMNA,
  MAX_ASIGNACIONES_VIVAS_POR_GRUPO,
  camposDestino,
  destinoDeFila,
  destinoValidator,
  validarCapacidad,
  validarCapacidadVivas,
  validarCapacidadVivasAlumna,
  validarDestinoCrudo,
} from "./asignacionDestino";
import {
  estadoDeVentana,
  etiquetaTipo,
  normalizarTipo,
  validarVentana,
} from "./examenEstado";
import { validarPublicable } from "./examenGuardado";
import { rangoCortoMx } from "./fechas";
import { gruposActivosDelInstructor } from "./instructores";
import { alumnasActivasDeGrupo } from "./alumnos";

/**
 * ASIGNACIÓN de examen (LUI-22): aplicar un examen PUBLICADO a su destino —todos los
 * grupos, grupos específicos o alumnos individuales— con una ventana `[abreEn, cierraEn)`.
 *
 * Reglas transversales del módulo:
 *  · **Permisos**: cualquier staff asigna cualquier examen publicado (sin filtro de
 *    autoría — el admin publica el simulacro general y cada instructor lo aplica); la
 *    restricción es sobre el DESTINO: el instructor solo alcanza SUS grupos **existentes
 *    y ACTIVOS** (cerrar un grupo conserva `grupoInstructores` y `perfil.grupoId`, y el
 *    contrato de `grupos.cambiarEstado` dice que un cerrado no recibe asignaciones
 *    nuevas) y solo alumnos de esos grupos. «Todos los grupos» es solo de admin.
 *  · **El destino se escribe vía `camposDestino` y se interpreta vía `destinoDeFila`**
 *    (invariante XOR de `asignacionDestino.ts`).
 *  · **La ventana la valida `validarVentana`** (vigencia mínima incluida: el runtime
 *    congela `Date.now()` al inicio de la función, así que un margen de ms sería
 *    inservible).
 *  · **`asignar` re-ejecuta `validarPublicable` COMPLETA**: un publicado sin compromisos
 *    no está congelado y pudo degradarse después de publicar; asignar crea el compromiso
 *    y el candado de `calcularBloqueo` entra solo.
 */

function nombreCompleto(p: Doc<"perfiles">): string {
  return [p.nombre, p.apellidos].filter(Boolean).join(" ");
}

/**
 * Los helpers de alcance (`gruposActivosDelInstructor`, `alumnasActivasDeGrupo`)
 * viven desde LUI-19 en sus módulos de dominio (`instructores.ts` / `alumnos.ts`),
 * acotados y compartidos. El de grupos devuelve además `membresiaDesbordada`
 * (legado con más uniones que el techo): en los flujos de asignación eso LANZA —
 * operar sobre un subconjunto que finge ser el todo autorizaría de menos o de más.
 */
function exigirMembresiaSana(resultado: {
  grupos: Map<Id<"grupos">, Doc<"grupos">>;
  membresiaDesbordada: boolean;
}): Map<Id<"grupos">, Doc<"grupos">> {
  if (resultado.membresiaDesbordada) {
    throw new ConvexError(
      "Tu cuenta tiene más grupos de los permitidos (datos previos a la cota); " +
        "pide a una administradora depurar tus membresías.",
    );
  }
  return resultado.grupos;
}

/**
 * Tamaño máximo de página de `existentesDe`. `paginationOptsValidator` solo valida la
 * FORMA y `numItems` lo controla el cliente: sin esta frontera, una llamada directa
 * pediría miles de filas y la resolución por fila (destinos, perfiles) dejaría de estar
 * acotada por la página. Se rechaza con error — jamás un clamp silencioso.
 */
const MAX_PAGINA = 50;

// ─────────────────────────────────────────────────────────────────────────────
// asignar — forma CREAR (auth → entrada cruda → origen → destino → capacidad →
// conteo → contenido → inserts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea las filas de asignación del destino en UNA transacción. Materializa
 * «todosLosGrupos» a los grupos activos EXISTENTES AL MOMENTO (decisión documentada del
 * issue: un grupo creado después NO recibe la asignación — la asignación se congela al
 * crearse).
 *
 * SIN salida idempotente: crear no tiene clave natural (los solapes y duplicados entre
 * asignaciones DISTINTAS son legales por AC — mismo examen, mismo grupo, ventanas
 * traslapadas). El doble-submit se mitiga en la UI (botón deshabilitado en vuelo) y queda
 * declarado.
 *
 * Devuelve lo que el toast necesita, formateado en el SERVIDOR (la zona MX es regla de
 * negocio, precedente `panel.resumen`): `{ asignaciones, alumnos, rango }`.
 */
export const asignar = mutation({
  args: {
    examenId: v.id("examenes"),
    destino: destinoValidator,
    abreEn: v.number(),
    cierraEn: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Autorización de rol.
    const sesion = await requireStaff(ctx);
    const esAdmin = sesion.perfil.rol === "admin";
    // `Date.now()` queda CONGELADO al inicio de la función por el runtime de Convex:
    // una sola muestra para ventana y estados — re-muestrear no daría otro valor.
    const ahora = Date.now();

    // 2. Entrada CRUDA, cero lecturas.
    validarVentana(args.abreEn, args.cierraEn, ahora);
    validarDestinoCrudo(args.destino);

    // 3-4. El examen existe y su ORIGEN es explícito (no es transición de examen:
    // no se consulta `transicionPermitida`; publicado es el único estado asignable).
    const examen = await ctx.db.get(args.examenId);
    if (!examen) throw new ConvexError("El examen no existe.");
    if (examen.estado !== "publicado") {
      throw new ConvexError("Solo un examen publicado puede asignarse.");
    }

    // 5. Resolución + AUTORIZACIÓN de los IDs del destino — gets baratos, sin contar
    // alumnado todavía. El permiso precede al contenido: un instructor sin permiso no
    // aprende del estado interno del examen.
    const misGrupos = esAdmin
      ? null
      : exigirMembresiaSana(
          await gruposActivosDelInstructor(ctx, sesion.userId),
        );

    const filas: Array<{ grupoId: Id<"grupos"> } | { alumnoId: Id<"users"> }> = [];
    const gruposDestino: Doc<"grupos">[] = [];
    // Los destinatarios individuales, con su nombre: la cota de vivas por alumna (paso 5c)
    // necesita nombrar a la llena, igual que la de grupo.
    const alumnosDestino: Array<{ alumnoId: Id<"users">; nombre: string }> = [];

    if (args.destino.tipo === "todosLosGrupos") {
      if (!esAdmin) {
        throw new ConvexError(
          "Solo una administradora puede asignar a todos los grupos.",
        );
      }
      const activos = (await ctx.db.query("grupos").collect()).filter(
        (g) => g.activo,
      );
      if (activos.length === 0) {
        throw new ConvexError("No hay grupos activos para asignar.");
      }
      // La rama sin arreglo no pasa por `validarDestinoCrudo`: su tope va AQUÍ,
      // inmediatamente tras el collect y antes de contar alumnado o insertar.
      if (activos.length > MAX_GRUPOS_DESTINO) {
        throw new ConvexError(
          `Hay más de ${MAX_GRUPOS_DESTINO} grupos activos; asigna por grupos específicos.`,
        );
      }
      for (const g of activos) {
        gruposDestino.push(g);
        filas.push(camposDestino({ grupoId: g._id }));
      }
    } else if (args.destino.tipo === "grupos") {
      for (const grupoId of args.destino.grupoIds) {
        const g = await ctx.db.get(grupoId);
        if (!g) throw new ConvexError("El grupo no existe.");
        if (!g.activo) {
          throw new ConvexError(
            `El grupo «${g.nombre}» está cerrado; no puede recibir asignaciones nuevas.`,
          );
        }
        if (misGrupos && !misGrupos.has(g._id)) {
          throw new ConvexError(
            "Solo puedes asignar exámenes a tus propios grupos.",
          );
        }
        gruposDestino.push(g);
        filas.push(camposDestino({ grupoId: g._id }));
      }
    } else {
      for (const alumnoId of args.destino.alumnoIds) {
        const perfil = await ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", alumnoId))
          .first();
        if (!perfil || perfil.rol !== "alumno") {
          throw new ConvexError("El alumno no existe.");
        }
        if (!perfil.activo) {
          throw new ConvexError(
            `El alumno «${nombreCompleto(perfil)}» está dado de baja; no puede recibir asignaciones.`,
          );
        }
        if (misGrupos && (!perfil.grupoId || !misGrupos.has(perfil.grupoId))) {
          throw new ConvexError("Solo puedes asignar a alumnos de tus grupos.");
        }
        alumnosDestino.push({ alumnoId, nombre: nombreCompleto(perfil) });
        filas.push(camposDestino({ alumnoId }));
      }
    }

    // 5b. COTA DE VIVAS por grupo destino (LUI-19), en AMBAS ramas de grupos —
    // `gruposDestino` ya está materializado venga de `todosLosGrupos` o de
    // `grupos` (la cota no puede existir solo en la rama equivalente). Sonda
    // acotada sobre `by_grupo_cierra` (`cierraEn > ahora` = no cerradas); esta
    // frontera es la que hace DEMOSTRABLE la lectura del panel del instructor.
    for (const g of gruposDestino) {
      const vivas = await ctx.db
        .query("asignaciones")
        .withIndex("by_grupo_cierra", (q) =>
          q.eq("grupoId", g._id).gt("cierraEn", ahora),
        )
        .take(MAX_ASIGNACIONES_VIVAS_POR_GRUPO + 1);
      validarCapacidadVivas(g.nombre, vivas.length);
    }

    // 5c. COTA DE VIVAS por ALUMNA (LUI-25), gemela de la anterior sobre
    // `by_alumno_cierra`: es lo que hace SEGURO el corte de «Mis exámenes» (con ≤30
    // vivas, su página descendente por cierre nunca deja fuera una abierta).
    for (const a of alumnosDestino) {
      const vivas = await ctx.db
        .query("asignaciones")
        .withIndex("by_alumno_cierra", (q) =>
          q.eq("alumnoId", a.alumnoId).gt("cierraEn", ahora),
        )
        .take(MAX_ASIGNACIONES_VIVAS_POR_ALUMNA + 1);
      validarCapacidadVivasAlumna(a.nombre, vivas.length);
    }

    // 6. CAPACIDAD del acumulado (barata, antes del conteo proporcional): lectura
    // acotada por construcción (≤ MAX+1 docs), jamás un collect sin techo.
    const existentes = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen", (q) => q.eq("examenId", args.examenId))
      .take(MAX_ASIGNACIONES_POR_EXAMEN + 1);
    validarCapacidad(existentes.length, filas.length);

    // 7. Conteo de destinatarios (proporcional, solo tras autorización y capacidad).
    // Sin dedupe: un alumno pertenece a lo más a UN grupo — el modelo lo garantiza.
    let totalAlumnos: number;
    if (args.destino.tipo === "alumnos") {
      totalAlumnos = args.destino.alumnoIds.length;
    } else {
      totalAlumnos = 0;
      for (const g of gruposDestino) {
        totalAlumnos += (await alumnasActivasDeGrupo(ctx, g._id)).length;
      }
    }

    // 8. CONTENIDO — la guarda más cara al final: `validarPublicable` COMPLETA (la
    // costura documentada en examenGuardado: nada de lo publicado está garantizado
    // DESPUÉS; asignar crea el compromiso y el candado entra solo).
    await validarPublicable(ctx, examen);

    // 9. Inserts (una transacción). Solapes/duplicados entre asignaciones DISTINTAS:
    // legales a propósito (AC), sin sonda de duplicado. Los TRES read-models
    // (`tituloExamen` del panel del instructor, `numReactivos`/`duracionMin` de «Mis
    // exámenes») comparten candado: este examen es PUBLICADO y la fila que insertamos
    // lo compromete, así que `calcularBloqueo` lo congela desde este instante y
    // `examenes.actualizar` —que exige borrador— ya no puede moverlos (docblocks de
    // los campos en schema.ts).
    for (const fila of filas) {
      await ctx.db.insert("asignaciones", {
        examenId: args.examenId,
        ...fila,
        abreEn: args.abreEn,
        cierraEn: args.cierraEn,
        creadoPor: sesion.userId,
        tituloExamen: examen.titulo,
        numReactivos: examen.reactivoIds.length,
        duracionMin: examen.duracionMin,
        tipoExamen: normalizarTipo(examen.tipo),
      });
    }

    // 10. Lo que el toast necesita.
    return {
      asignaciones: filas.length,
      alumnos: totalAlumnos,
      rango: rangoCortoMx(args.abreEn, args.cierraEn),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// cancelar — DELETE con guardas (no hay campo estado; no es transición)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elimina una asignación SOLO si su ventana sigue PROGRAMADA y no tiene intentos.
 * Autoriza **admin ∨ quien la creó** (decisión de producto: determinista en el tiempo —
 * la alternativa «instructor del grupo destino» varía con la membresía actual — y
 * simétrica con «admin ∨ autor» de exámenes).
 *
 * ⚠️ El no-op del reintento va ANTES de la autorización — peculiaridad del delete: la
 * fila ya no existe para autorizar contra ella. Aceptado y declarado: solo staff llega
 * aquí, los ids no son adivinables, y la alternativa (error ante id ausente) pintaría
 * rojo sobre un cancelar que SÍ funcionó cuando Convex reintenta la mutation.
 *
 * Efecto en el candado — coherente SIN tocar código: cancelar la única asignación de un
 * publicado deja `compromisosDe` en `{false, false}` → `calcularBloqueo` descongela sus
 * reactivos y `despublicar` vuelve a ser legal. Correcto por construcción: ambos sondan
 * filas VIVAS de `by_examen` en cada evaluación, jamás cachean el compromiso. Métricas:
 * una programada cancelada nunca contó en `panel.resumen` ni en `grupos.obtener` (ambas
 * expresiones de la regla exigen `abreEn <= ahora`); borrarla no mueve un número.
 *
 * **Contrato con el player (LUI-26), ya CUMPLIDO:** `player.iniciarIntento` comprueba que
 * la asignación exista y esté ABIERTA DENTRO de su propia transacción. Eso es lo que
 * resuelve la carrera cancelar↔iniciar: ambas transacciones tocan el mismo documento, así
 * que la serialización de Convex hace reintentar a una — si cancelar commitea primero,
 * iniciar no encuentra la fila; si iniciar gana, la sonda de intentos de aquí abajo
 * rechaza. (Los estados además son disjuntos —cancelar exige programada, iniciar
 * abierta—, pero la garantía formal es la transaccional, no la temporal.)
 */
export const cancelar = mutation({
  args: { asignacionId: v.id("asignaciones") },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);

    const a = await ctx.db.get(args.asignacionId);
    if (!a) return { cancelada: false };

    const esAdmin = sesion.perfil.rol === "admin";
    if (!esAdmin && a.creadoPor !== sesion.userId) {
      throw new ConvexError(
        "Solo quien creó la asignación (o una administradora) puede cancelarla.",
      );
    }

    const estado = estadoDeVentana(a.abreEn, a.cierraEn, Date.now());
    if (estado === "abierta") {
      throw new ConvexError("Esta asignación ya abrió; no puede cancelarse.");
    }
    if (estado === "cerrada") {
      throw new ConvexError("Esta asignación ya concluyó; no puede cancelarse.");
    }

    // Defensa doble (O(1) por `by_asignacion`): una programada no debería tener
    // intentos, pero confiar en «no debería» es el agujero que LUI-20 cerró.
    const intento = await ctx.db
      .query("intentos")
      .withIndex("by_asignacion", (q) => q.eq("asignacionId", a._id))
      .first();
    if (intento) {
      throw new ConvexError(
        "Esta asignación ya tiene intentos registrados; no puede cancelarse.",
      );
    }

    await ctx.db.delete(a._id);
    return { cancelada: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// paraAsignar — hidratación del FORMULARIO (patrón paraConstructor)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todo lo que la pantalla 19 necesita para MONTAR el formulario, en una query. Las
 * asignaciones existentes NO van aquí: viven en `existentesDe` (paginada — el acumulado
 * no está acotado por la escala institucional, los solapes legales lo hacen crecer).
 *
 * `ahoraServidor` es **ancla de INICIO**: el runtime de Convex congela `Date.now()` al
 * comenzar la función, así que muestrearlo «al final» devolvería lo mismo. El desfase
 * real del ancla (ejecución + transporte + hidratación de React) se ASUME: lo absorben
 * `MIN_VIGENCIA_RESTANTE_MS` (60 s ≫ latencias) y el margen del timer del cliente. No
 * hay query separada de reloj (complejidad sin consumidor que la justifique).
 *
 * Cotas: el único argumento del cliente es un string que se normaliza; no hay arreglos
 * que acotar. `grupos`/`alumnos` están acotadas por la escala institucional vía índices
 * (`by_rol`/`by_grupo`) — el mismo presupuesto aceptado de `alumnos.listar`; si el
 * alumnado escalara a miles, el paso siguiente es búsqueda server-side (fuera de
 * alcance, anotado). `capacidadRestante` se calcula con `take(MAX+1)`, jamás collect.
 */
export const paraAsignar = query({
  args: { examenId: v.string() },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const esAdmin = sesion.perfil.rol === "admin";
    const ahoraServidor = Date.now();

    const id = ctx.db.normalizeId("examenes", args.examenId);
    const e = id ? await ctx.db.get(id) : null;
    if (!id || !e) return null;

    if (e.estado !== "publicado") {
      return {
        problema: "noAsignable" as const,
        estado: e.estado,
        titulo: e.titulo,
      };
    }

    const yaAcumuladas = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen", (q) => q.eq("examenId", id))
      .take(MAX_ASIGNACIONES_POR_EXAMEN + 1);
    const capacidadRestante = Math.max(
      0,
      MAX_ASIGNACIONES_POR_EXAMEN - yaAcumuladas.length,
    );

    // Card del examen.
    const autorPerfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", e.autorId))
      .first();
    const tipo = normalizarTipo(e.tipo);
    const seccionNombre =
      tipo.clase === "modulo"
        ? ((await ctx.db.get(tipo.seccionId))?.nombre ?? null)
        : null;

    // Grupos ofertables: EL MISMO conjunto que autoriza la mutation.
    const todosLosGrupos = await ctx.db.query("grupos").collect();
    const misGrupos = esAdmin
      ? null
      : exigirMembresiaSana(
          await gruposActivosDelInstructor(ctx, sesion.userId),
        );
    const gruposOfertables = (
      esAdmin
        ? todosLosGrupos.filter((g) => g.activo)
        : [...(misGrupos as Map<Id<"grupos">, Doc<"grupos">>).values()]
    ).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const grupos: Array<{
      id: Id<"grupos">;
      nombre: string;
      ciclo: string | null;
      turno: string | null;
      alumnosCount: number;
    }> = [];
    const alumnasDeGrupo = new Map<Id<"grupos">, Doc<"perfiles">[]>();
    for (const g of gruposOfertables) {
      const alumnas = await alumnasActivasDeGrupo(ctx, g._id);
      alumnasDeGrupo.set(g._id, alumnas);
      grupos.push({
        id: g._id,
        nombre: g.nombre,
        ciclo: g.ciclo ?? null,
        turno: g.turno ?? null,
        alumnosCount: alumnas.length,
      });
    }
    // Lo que «Todos los grupos» materializaría EXACTAMENTE — no `alumnos.length`, que
    // (en admin) incluye activas SIN grupo que la materialización no alcanza.
    const totalAlumnos = grupos.reduce((s, g) => s + g.alumnosCount, 0);

    // Alumnos ofertables para el destino individual. Filas LEAN, sin sondas por fila.
    const nombreDeGrupo = new Map(todosLosGrupos.map((g) => [g._id, g.nombre]));
    let perfilesOfertables: Doc<"perfiles">[];
    if (esAdmin) {
      perfilesOfertables = (
        await ctx.db
          .query("perfiles")
          .withIndex("by_rol", (q) => q.eq("rol", "alumno"))
          .collect()
      ).filter((p) => p.activo);
    } else {
      perfilesOfertables = [...alumnasDeGrupo.values()].flat();
    }
    const alumnos = perfilesOfertables
      .map((p) => ({
        userId: p.userId,
        nombre: nombreCompleto(p),
        grupoId: p.grupoId ?? null,
        grupoNombre: p.grupoId ? (nombreDeGrupo.get(p.grupoId) ?? null) : null,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return {
      problema: null,
      ahoraServidor,
      capacidadRestante,
      examen: {
        id: e._id,
        titulo: e.titulo,
        reactivosCount: e.reactivoIds.length,
        duracionMin: e.duracionMin,
        autorNombre: autorPerfil ? nombreCompleto(autorPerfil) : "Autor desconocido",
        tipoEtiqueta: etiquetaTipo(tipo, seccionNombre),
      },
      puedeTodosLosGrupos: esAdmin,
      grupos,
      totalAlumnos,
      alumnos,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// existentesDe — las asignaciones del examen, PAGINADAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «Asignaciones existentes de este examen», por páginas y en orden `abreEn` DESC — sobre
 * `by_examen` a secas, `.order("desc")` ordenaría por el desempate implícito
 * `_creationTime`; el índice `by_examen_abre` encodea el contrato de la pantalla. El
 * examen se reutiliza INDEFINIDAMENTE: no hay cota de lectura que esconda filas (un
 * legado por encima del techo de escritura se VE completo y sus programadas se cancelan).
 *
 * Fronteras server-side (no confiar en que solo la invoca la pantalla correcta): el
 * examen debe EXISTIR; NO se exige `publicado` — el historial de un archivado es legible
 * y la política de visibilidad aplica igual. `numItems` se valida contra `MAX_PAGINA`
 * (error, no clamp) y `maximumRowsRead` acota la página reactiva; los `pageStatus` de
 * división se propagan intactos para no romper `usePaginatedQuery`.
 *
 * **Política de visibilidad del destino** (la fila-alumno expondría nombres ajenos):
 * filas-GRUPO → nombre visible para todo staff (no es dato personal); filas-ALUMNO →
 * admin ve todas con nombre; el instructor ve con nombre las que ÉL creó (aunque el
 * alumno haya cambiado de grupo) o cuyo alumno esté HOY en uno de sus grupos activos;
 * cualquier otra viaja ANONIMIZADA («Alumno de otro grupo») — la fila NO se filtra: el
 * conteo de la biblioteca y esta lista deben coincidir; una lista que esconde filas
 * miente.
 *
 * La query NO estampa estado/etiqueta/cancelabilidad-ahora: dependen del reloj y Convex
 * no re-ejecuta una query porque pase el tiempo. Cada fila lleva AMBAS fronteras +
 * `puedeSolicitarCancelar` (autorización pura, estable); el cliente deriva
 * `estadoDeVentana`/`etiquetaVentana`/`cancelableAhora` con su reloj anclado. Pista de
 * UI, nunca autoridad: `cancelar` recalcula todo (incluida la sonda de intentos, que
 * aquí no se hace por costo).
 */
export const existentesDe = query({
  args: {
    examenId: v.id("examenes"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const sesion = await requireStaff(ctx);
    const esAdmin = sesion.perfil.rol === "admin";

    const { numItems } = args.paginationOpts;
    if (!Number.isInteger(numItems) || numItems < 1 || numItems > MAX_PAGINA) {
      throw new ConvexError("Tamaño de página inválido.");
    }

    const examen = await ctx.db.get(args.examenId);
    if (!examen) throw new ConvexError("El examen no existe.");

    const misGrupos = esAdmin
      ? null
      : exigirMembresiaSana(
          await gruposActivosDelInstructor(ctx, sesion.userId),
        );

    const resultado = await ctx.db
      .query("asignaciones")
      .withIndex("by_examen_abre", (q) => q.eq("examenId", args.examenId))
      .order("desc")
      .paginate({ ...args.paginationOpts, maximumRowsRead: MAX_PAGINA });

    const page = await Promise.all(
      resultado.page.map(async (a) => {
        const destino = destinoDeFila(a);
        let destinoNombre: string;
        if (destino.tipo === "grupo") {
          const g = await ctx.db.get(destino.grupoId);
          destinoNombre = g?.nombre ?? "Grupo eliminado";
        } else {
          const perfil = await ctx.db
            .query("perfiles")
            .withIndex("by_user", (q) => q.eq("userId", destino.alumnoId))
            .first();
          const puedeVerNombre =
            esAdmin ||
            a.creadoPor === sesion.userId ||
            (perfil?.grupoId !== undefined &&
              misGrupos !== null &&
              misGrupos.has(perfil.grupoId));
          destinoNombre = !puedeVerNombre
            ? "Alumno de otro grupo"
            : perfil
              ? nombreCompleto(perfil)
              : "Alumno desconocido";
        }
        return {
          id: a._id,
          destinoNombre,
          rango: rangoCortoMx(a.abreEn, a.cierraEn),
          abreEn: a.abreEn,
          cierraEn: a.cierraEn,
          puedeSolicitarCancelar: esAdmin || a.creadoPor === sesion.userId,
        };
      }),
    );

    return { ...resultado, page };
  },
});
