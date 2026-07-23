import { type GenericId } from "convex/values";
import {
  primerIntentoPorAlumna,
  promedioDeAsignacion,
  redondearPuntaje,
  type ConteoPorArea,
  type ConteoPorSeccion,
} from "./simulacro";
import { estadoDeVentana, type EstadoVentana } from "./examenEstado";
import {
  tonoParticipacion,
  type EstadoIntentoAlumna,
  type TonoParticipacion,
} from "./participacion";

/**
 * RESULTADOS DEL EXAMEN — vista del instructor (LUI-30 · LUI-31 integrada), módulo PURO.
 *
 * Misma razón de existir que `participacion.ts` y `simulacro.ts`: `npx convex run` corre sin
 * identidad (lo decidible sin BD se prueba en `scripts/test-resultados.ts` contra ESTE
 * código) y la derivación la comparten el CLIENTE (que deriva con su reloj anclado) y las
 * pruebas (con `ahora` fijo). Solo importa `convex/values` y módulos puros hermanos.
 *
 * ══ LA PARTICIÓN SERVIDOR/CLIENTE ══
 *
 * Las queries de LUI-30 (`resultadosExamen.deExamen` / `deAsignacion` / `intentosDe`)
 * entregan datos CRUDOS + `ahoraServidor`; NADA derivado del reloj viaja estampado (una
 * query de Convex no se re-invalida por el paso del tiempo — contrato de
 * `examenEstado.estadoDeVentana`). Hay DOS derivaciones puras, una por capa, porque cada
 * una posee insumos distintos (hallazgo M2 del 3er dictamen del plan):
 *
 *  · `derivarSelectorResultados(asignacionesQ1, ahora)` — corre con SOLO Q1: particiona el
 *    selector (programadas vs elegibles), decide la selección default y entrega las
 *    FRONTERAS del conjunto. Al cruzar un `abreEn` la re-derivación habilita Q2/Q3 sin
 *    recargar.
 *  · `derivarResultados(q2, q3, ahora)` — corre con la asignación YA seleccionada: métricas
 *    grupales, acordeón y tabla por alumna. Su única lectura del reloj es el estado
 *    Pendiente↔«No contestó» (jamás estampado por el servidor).
 *
 * ══ EL SELECTOR CANÓNICO ══
 *
 * Fila, participación, desgloses y promedio eligen el intento-que-cuenta de cada alumna con
 * `simulacro.primerIntentoPorAlumna` — UNA selección para todos los consumidores. El
 * promedio es literalmente `simulacro.promedioDeAsignacion` sobre las MISMAS poblaciones
 * que lee `panel.promedioDe` (helper server compartido `lecturasAnalitica.ts`): la paridad
 * bit a bit con el panel del admin no es una promesa, es la misma función sobre los mismos
 * rangos.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas y presupuestos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Umbral de DESEMPEÑO por área (decisión de producto 2026-07-12, spec de LUI-30): un área
 * con menos del 60 % de aciertos del grupo se resalta en naranja con el tag «REFORZAR EN
 * REPASO». La comparación es ESTRICTA (`pct < 0.6`): 60.00 % exacto NO se marca — espejo de
 * `tonoParticipacion`, donde el 60 % exacto ya es verde.
 *
 * ⚠️ NO confundir con `participacion.UMBRAL_PARTICIPACION` (mismo número, OTRA pregunta):
 * aquel tiñe la barra «X de Y» según cuántas ENTREGARON; este mide qué tan bien CONTESTARON
 * un área. Que ambos valgan 0.6 es coincidencia de producto, no una constante compartida —
 * mover uno no debe mover el otro.
 */
export const UMBRAL_REFUERZO_AREA = 0.6;

/**
 * Ids DISTINTOS de sección+área que `intentosDe` resuelve por corrida. Derivada del dominio
 * de ESCRITURA (hallazgo M5 del 1er dictamen): un examen admite ≤240 reactivos
 * (`constructorExamen.MAX_REACTIVOS`), o sea ≤240 áreas distintas más sus secciones; 500
 * cubre además la deriva histórica plausible de reclasificaciones entre intentos.
 * Superarla exige churn de catálogo anómalo y el corte es FAIL-CLOSED
 * (`problema: "clasificaciones"`, sin analítica parcial) — jamás nombres a medias
 * presentados como fantasmas.
 */
export const MAX_CLASIFICACIONES_RESULTADOS = 500;

/**
 * Presupuesto de BYTES de los `ctx.db.get` del catálogo de clasificaciones (hallazgo M3 del
 * 2º dictamen: `nombre` no tenía cota de longitud, así que 500 docs podían pesar ~500 MiB
 * contractuales). La lectura ACUMULA el tamaño real (`getConvexSize`) y PARA TEMPRANO al
 * superar este tope → `problema: "clasificaciones"`; el peor caso leído queda en
 * ≤ 512 KiB + el doc que cruza (≤1 MiB duro) ≈ 1.5 MiB. La frontera de escritura nueva
 * (`temarioReglas.MAX_NOMBRE_TEMARIO`) vuelve implausible el desborde con datos nuevos; el
 * legado queda protegido por este paro.
 */
export const CATALOGO_CLASIF_BYTES = 524_288;

/**
 * Tope de BYTES del paginate de DIAGNÓSTICOS (`by_asignacion_numero eq(id).eq(1)`), lo
 * aplica el RUNTIME vía `maximumBytesRead`. Existe porque un intento enviado post-LUI-27
 * carga su desglose: contractualmente 2 × 240 entradas × ~80 B ≈ 40 KiB/doc, y dos
 * `take(401)` (≈31 MiB) morirían contra el límite de 16 MiB ANTES de poder devolver un
 * flag. El rango LEGADO sí usa `take(401)` porque su cota de bytes es un invariante
 * temporal demostrable: un doc sin `numeroIntento` es anterior al paquete player y por
 * tanto anterior al desglose (el escritor «desglose ∧ sin número» nunca existió; prod
 * arrancó vacía) ⇒ forma fija ~0.4 KiB.
 */
export const INTENTOS_BYTES_RESULTADOS = 6_291_456;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos (ids por GenericId — mismo tipo nominal que `v.id(...)`, sin `_generated`)
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoId = GenericId<"grupos">;
export type AlumnoId = GenericId<"users">;
export type ExamenId = GenericId<"examenes">;
export type AsignacionId = GenericId<"asignaciones">;
export type SeccionId = GenericId<"secciones">;
export type AreaId = GenericId<"areasTematicas">;

/**
 * Proyección de un intento tal como viaja en `intentosDe` — lo ÚNICO que el cliente ve de
 * la tabla grande. Extiende `simulacro.IntentoAnalitico` (mismos opcionales-por-omisión),
 * así que `primerIntentoPorAlumna` y `promedioDeAsignacion` la consumen tal cual.
 * JAMÁS viajan: `_id`, `examenId`, `asignacionId`, `cierreJobId`, `formaCierre`, nada de
 * `respuestas` ni estados derivados del reloj.
 */
export type IntentoCrudoResultados = {
  alumnoId: AlumnoId;
  estado: EstadoIntentoAlumna;
  numeroIntento?: number;
  iniciadoEn: number;
  enviadoEn?: number;
  puntaje?: number; // EXACTO — el único redondeo es `redondearPuntaje`, en el cliente
  aciertosPorSeccion?: ConteoPorSeccion[];
  aciertosPorArea?: ConteoPorArea[];
};

/** Fila del selector tal como viaja en Q1 (`deExamen`): SIEMPRE cruda, incluidas
 *  programadas — la partición temporal es del cliente. */
export type AsignacionDeResultados = {
  asignacionId: AsignacionId;
  grupoId: GrupoId;
  grupoNombre: string | null; // null = grupo fuera del catálogo (eliminado)
  grupoActivo: boolean;
  abreEn: number;
  cierraEn: number;
  fechaAbre: string; // formateo MX server-side («28 jun 2026») — no depende del reloj
};

export type ProblemaQ1 = "membresia" | "catalogo" | "asignaciones";

/** Retorno de Q1. Ante `problema` los arreglos van VACÍOS (jamás datos parciales). */
export type ResultadosQ1 = {
  ahoraServidor: number;
  esAdmin: boolean;
  examen: { id: ExamenId; titulo: string; estado: string };
  asignaciones: AsignacionDeResultados[];
  /** Filas-alumno del examen (fuera de v1 por decisión de producto ④): solo el CONTEO
   *  honesto, sin PII. */
  individualesOmitidas: number;
  /** Instructor: filas-grupo fuera de su membresía — solo conteo. */
  ajenasOmitidas: number;
  problema: ProblemaQ1 | null;
};

/** Retorno de Q2 (`deAsignacion`). `problema: "roster"` = corte del paginate por filas o
 *  bytes → `alumnas` vacías (jamás un Y fabricado). */
export type ResultadosQ2 = {
  ahoraServidor: number;
  grupoId: GrupoId;
  grupoNombre: string;
  grupoActivo: boolean;
  tituloExamen: string | null;
  numReactivos: number | null;
  abreEn: number;
  cierraEn: number;
  alumnas: { alumnoId: AlumnoId; nombre: string }[];
  problema: "roster" | null;
};

export type CatalogoClasificaciones = {
  secciones: { seccionId: SeccionId; nombre: string | null; orden: number | null }[];
  areas: {
    areaId: AreaId;
    nombre: string | null;
    orden: number | null;
    seccionId: SeccionId | null;
  }[];
};

/** Retorno de Q3 (`intentosDe`). `diagnosticos`/`legado` viajan SEPARADOS: son
 *  literalmente los dos argumentos del selector canónico y de `promedioDeAsignacion`. */
export type ResultadosQ3 = {
  ahoraServidor: number;
  ordenSecciones: SeccionId[] | null; // `examen.secciones` declarado (LUI-21), si existe
  diagnosticos: IntentoCrudoResultados[];
  legado: IntentoCrudoResultados[];
  catalogo: CatalogoClasificaciones;
  problema: "intentos" | "clasificaciones" | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Detectores de corte (compartidos con el servidor y probados en frontera)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿La página de un paginate/take con centinela quedó CORTADA? Las dos señales son
 * INDEPENDIENTES y ambas obligan el fail-closed (hallazgo M4 del 2º dictamen):
 *  · `numFilas > cap` — el centinela `take(cap + 1)` se llenó (corte por FILAS);
 *  · `!isDone` — el runtime cortó antes (típicamente por `maximumBytesRead`), con la
 *    página incompleta incluso bajo el tope de filas (corte por BYTES).
 * Quitar cualquiera de las dos deja pasar prefijos como totales: la prueba pura cubre las
 * CUATRO combinaciones y el E2E pone en rojo específicamente la rama `!isDone` con
 * desgloses gordos. Lo usan `lecturasAnalitica.leerIntentosParaAnalitica` (diagnósticos) y,
 * en PR B, `panel.grupos`/`panel.alumnos`.
 */
export function corteDePagina(pagina: {
  numFilas: number;
  isDone: boolean;
  cap: number;
}): boolean {
  return pagina.numFilas > pagina.cap || !pagina.isDone;
}

/** ¿El acumulado de bytes del catálogo YA superó el presupuesto? Estricto en la frontera:
 *  exactamente `CATALOGO_CLASIF_BYTES` todavía cabe; un byte más corta. */
export function excedePresupuestoDeCatalogo(acumuladoBytes: number): boolean {
  return acumuladoBytes > CATALOGO_CLASIF_BYTES;
}

/**
 * Conjunto DISTINTO de clasificaciones a resolver: las secciones declaradas del examen ∪
 * las estampadas en los desgloses, y las áreas estampadas. Orden ESTABLE (orden de primera
 * aparición: declaradas primero, luego por recorrido de filas) para que dos corridas
 * resuelvan lo mismo. `desbordado` cuando secciones+áreas superan
 * `MAX_CLASIFICACIONES_RESULTADOS` — el llamador responde con fail-closed, jamás resuelve
 * un prefijo.
 */
export function clasificacionesDistintas(
  diagnosticos: readonly IntentoCrudoResultados[],
  legado: readonly IntentoCrudoResultados[],
  ordenSecciones: readonly SeccionId[] | null,
): { seccionIds: SeccionId[]; areaIds: AreaId[]; desbordado: boolean } {
  const secciones = new Set<SeccionId>(ordenSecciones ?? []);
  const areas = new Set<AreaId>();
  for (const i of [...diagnosticos, ...legado]) {
    for (const c of i.aciertosPorSeccion ?? []) secciones.add(c.seccionId);
    for (const c of i.aciertosPorArea ?? []) areas.add(c.areaId);
  }
  return {
    seccionIds: [...secciones],
    areaIds: [...areas],
    desbordado: secciones.size + areas.size > MAX_CLASIFICACIONES_RESULTADOS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivación 1 — el SELECTOR de asignaciones (corre con SOLO Q1)
// ─────────────────────────────────────────────────────────────────────────────

export type OpcionSelector = {
  asignacionId: AsignacionId;
  /** Etiqueta terminada del `<option>`: nombre del grupo (o «Grupo eliminado»),
   *  «(inactivo)» si aplica, y la fecha — con el prefijo «Programada» cuando aún no abre. */
  etiqueta: string;
  estadoVentana: EstadoVentana;
  grupoActivo: boolean;
  abreEn: number;
  cierraEn: number;
  fechaAbre: string;
};

export type SelectorResultados = {
  opciones: OpcionSelector[];
  /** Default: la asignación MÁS RECIENTE ya abierta o cerrada (`abreEn ≤ ahora`, max
   *  `abreEn`, desempate por id). Si TODAS son programadas: la PRÓXIMA en abrir (min
   *  `abreEn`, desempate por id) — el cliente muestra su placeholder. `null` sin filas. */
  seleccionDefault: AsignacionId | null;
  /** Instantes FUTUROS que cambian esta derivación (`abreEn`/`cierraEn` por venir):
   *  alimentan el timer del reloj anclado — al cruzar un `abreEn`, la programada se vuelve
   *  elegible y Q2/Q3 se habilitan sin recargar. */
  fronteras: number[];
};

export function derivarSelectorResultados(
  asignaciones: readonly AsignacionDeResultados[],
  ahora: number,
): SelectorResultados {
  const opciones: OpcionSelector[] = asignaciones.map((a) => {
    const estado = estadoDeVentana(a.abreEn, a.cierraEn, ahora);
    const base =
      (a.grupoNombre ?? "Grupo eliminado") +
      (a.grupoActivo ? "" : " (inactivo)");
    const etiqueta =
      estado === "programada"
        ? `${base} · Programada · ${a.fechaAbre}`
        : `${base} · ${a.fechaAbre}`;
    return {
      asignacionId: a.asignacionId,
      etiqueta,
      estadoVentana: estado,
      grupoActivo: a.grupoActivo,
      abreEn: a.abreEn,
      cierraEn: a.cierraEn,
      fechaAbre: a.fechaAbre,
    };
  });

  const elegibles = opciones.filter((o) => o.estadoVentana !== "programada");
  const programadas = opciones.filter((o) => o.estadoVentana === "programada");
  const cmpId = (x: AsignacionId, y: AsignacionId) =>
    x < y ? -1 : x > y ? 1 : 0;

  let seleccionDefault: AsignacionId | null = null;
  if (elegibles.length > 0) {
    seleccionDefault = elegibles.reduce((mejor, o) =>
      o.abreEn > mejor.abreEn ||
      (o.abreEn === mejor.abreEn &&
        cmpId(o.asignacionId, mejor.asignacionId) < 0)
        ? o
        : mejor,
    ).asignacionId;
  } else if (programadas.length > 0) {
    seleccionDefault = programadas.reduce((mejor, o) =>
      o.abreEn < mejor.abreEn ||
      (o.abreEn === mejor.abreEn &&
        cmpId(o.asignacionId, mejor.asignacionId) < 0)
        ? o
        : mejor,
    ).asignacionId;
  }

  const fronteras = [
    ...new Set(
      asignaciones
        .flatMap((a) => [a.abreEn, a.cierraEn])
        .filter((t) => t > ahora),
    ),
  ].sort((x, y) => x - y);

  return { opciones, seleccionDefault, fronteras };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivación 2 — agregación de desgloses (sobre la salida del selector canónico)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agrega los desgloses de los intentos-que-cuentan ENVIADOS. Consume EXCLUSIVAMENTE la
 * salida deduplicada de `primerIntentoPorAlumna` — agregarlo sobre los arreglos crudos
 * contaría doble a una alumna con legado+numerado, el doble conteo que el dedupe hace
 * imposible por construcción. Un enviado SIN desglose (legado pre-LUI-27) incrementa
 * `sinDesglose` y queda FUERA de la agregación — flag honesto que la UI enuncia («no
 * incluye N envíos antiguos»), jamás un 0 fabricado.
 */
export function agregarDesgloses(
  seleccionados: Iterable<IntentoCrudoResultados>,
): {
  porSeccion: Map<SeccionId, { aciertos: number; total: number }>;
  porArea: Map<AreaId, { aciertos: number; total: number }>;
  sinDesglose: number;
} {
  const porSeccion = new Map<SeccionId, { aciertos: number; total: number }>();
  const porArea = new Map<AreaId, { aciertos: number; total: number }>();
  let sinDesglose = 0;
  for (const i of seleccionados) {
    if (i.estado !== "enviado") continue;
    if (!i.aciertosPorSeccion || !i.aciertosPorArea) {
      sinDesglose += 1;
      continue;
    }
    for (const c of i.aciertosPorSeccion) {
      const acc = porSeccion.get(c.seccionId) ?? { aciertos: 0, total: 0 };
      acc.aciertos += c.aciertos;
      acc.total += c.total;
      porSeccion.set(c.seccionId, acc);
    }
    for (const c of i.aciertosPorArea) {
      const acc = porArea.get(c.areaId) ?? { aciertos: 0, total: 0 };
      acc.aciertos += c.aciertos;
      acc.total += c.total;
      porArea.set(c.areaId, acc);
    }
  }
  return { porSeccion, porArea, sinDesglose };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers COMPARTIDOS con el Resumen de exámenes (LUI-32)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PARTICIPACIÓN «X de Y» a partir de dos CONJUNTOS de ids: `enviadasIds` (las alumnas cuyo
 * intento-que-cuenta está ENVIADO — rangos ①–④ del selector canónico) y `rosterIds` (el
 * roster ACTIVO actual). Un solo código de participación en la plataforma: lo consumen
 * `derivarResultados` (LUI-30, vista del instructor) y `resumen.derivarCifrasFila`
 * (LUI-32, resumen de la administradora), así que «X de Y» no puede discrepar entre las dos
 * pantallas del mismo examen.
 *
 *  · `completaron` = |enviadas ∩ roster| — el X.
 *  · `deTotal`     = |roster| — el Y (población del roster vivo).
 *  · `fuerasDeRoster` = |enviadas − roster| — resultados de alumnas que YA NO están en el
 *    grupo (cambio de grupo o baja): cuentan en el promedio (ámbito asignación) pero no en
 *    X/Y; el contador los hace visibles, jamás un dato fabricado.
 */
export function participacionDe(
  enviadasIds: Iterable<AlumnoId>,
  rosterIds: Iterable<AlumnoId>,
): { completaron: number; deTotal: number; fuerasDeRoster: number } {
  const roster = new Set(rosterIds);
  const enviadas = new Set(enviadasIds);
  let completaron = 0;
  let fuerasDeRoster = 0;
  for (const id of enviadas) {
    if (roster.has(id)) completaron += 1;
    else fuerasDeRoster += 1;
  }
  return { completaron, deTotal: roster.size, fuerasDeRoster };
}

/**
 * Porcentaje ENTERO de aciertos de una fracción ya calculada (`pct` en 0..1). El ÚNICO
 * formateador de porcentaje de sección/área del sistema: lo llaman el acordeón de Resultados
 * del examen (LUI-30) y la celda «Aciertos por sección» del Resumen (LUI-32) con `ΣA/ΣT`.
 * Compartirlo es lo que hace que la equivalencia de cifras entre ambas pantallas no dependa
 * de que dos `Math.round` sueltos coincidan.
 */
export function pctDeFraccion(pct: number): number {
  return Math.round(pct * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivación 3 — la pantalla completa (corre con la asignación YA seleccionada)
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoFilaAlumna =
  | "completado"
  | "en_curso"
  | "pendiente"
  | "no_contesto";

export type FilaAlumna = {
  alumnoId: AlumnoId;
  nombre: string;
  estado: EstadoFilaAlumna;
  puntaje: number | null; // redondeado (presentación); null = sin puntaje
  enviadoEn: number | null;
  iniciadoEn: number | null;
  /** Alineado 1:1 con `columnas`; `null` = sin dato para esa sección. */
  porSeccion: ({ aciertos: number; total: number } | null)[];
  /** Enviado sin desglose (legado pre-LUI-27): sus celdas van «—» y la nota lo cuenta. */
  sinDesglose: boolean;
};

export type ColumnaSeccion = { seccionId: SeccionId; nombre: string | null };

export type AreaDeAcordeon = {
  areaId: AreaId;
  nombre: string | null;
  aciertos: number;
  total: number;
  pct: number; // fracción 0..1
  reforzar: boolean; // pct < UMBRAL_REFUERZO_AREA (estricto)
};

export type SeccionDeAcordeon = {
  /** `null` = la cubeta «Sin clasificación vigente» (áreas cuyo doc no resolvió). */
  seccionId: SeccionId | null;
  nombre: string | null;
  pct: number | null; // fracción 0..1; null = sin datos agregados de la sección
  areas: AreaDeAcordeon[];
};

export type ProblemaResultados = "roster" | "intentos" | "clasificaciones";

export type ResultadosDerivados =
  | { estado: "problema"; problema: ProblemaResultados }
  | {
      estado: "datos";
      promedio: { valor: number | null; incompleto: boolean };
      mayorPuntaje: number | null;
      menorPuntaje: number | null;
      participacion: {
        completaron: number;
        total: number;
        tono: TonoParticipacion;
      };
      mejorSeccion: { seccionId: SeccionId; nombre: string | null; pct: number } | null;
      columnas: ColumnaSeccion[];
      filas: FilaAlumna[];
      acordeon: SeccionDeAcordeon[];
      /** Enviados-que-cuentan de alumnas que YA NO están en el roster activo (cambio de
       *  grupo o baja): cuentan en promedio/acordeón (ámbito asignación), no en filas ni en
       *  X/Y — este contador hace visible el delta. */
      presentaronFueraDeRoster: number;
      /** Enviados-que-cuentan SIN desglose (legado): excluidos del acordeón, no del
       *  promedio. La UI lo enuncia. */
      desgloseIncompleto: number;
      /** Instantes futuros que cambian esta derivación: `[cierraEn]` si aún no cierra
       *  (el flip Pendiente→«No contestó»). */
      fronteras: number[];
      datosCompletos: boolean;
    };

/**
 * Deriva TODO lo que pinta la pantalla a partir de Q2 + Q3 y el `ahora` del reloj anclado.
 *
 * REGLA DE ORO (heredada de `derivarPanelInstructor`): ante `problema` JAMÁS se fabrican
 * datos — el estado de problema viaja y la UI muestra su Alert, nunca cifras parciales.
 *
 * ══ ÁMBITOS (decisión documentada del plan, coherente con los DOS precedentes del repo) ══
 *  · Participación X/Y y filas = ROSTER ACTIVO ACTUAL (como `derivarPanelInstructor`).
 *  · Promedio, acordeón, mejor sección y max/min = ÁMBITO ASIGNACIÓN — todos los
 *    intentos-que-cuentan, incluidas alumnas fuera del roster (la población EXACTA de
 *    `panel.promedioDe`; si divergieran, «promedio» tendría dos números para la misma
 *    asignación). `presentaronFueraDeRoster` visibiliza el delta.
 *
 * Órdenes TOTALES (deterministas hasta el id, para el E2E): filas por nombre
 * (`localeCompare` es) → `alumnoId`; columnas por `ordenSecciones` declarado → `orden` del
 * catálogo (null al final) → `seccionId`; áreas por `orden` → `areaId`; mejor sección por
 * pct desc → `orden` asc → `seccionId`.
 */
export function derivarResultados(
  q2: ResultadosQ2,
  q3: ResultadosQ3,
  ahora: number,
): ResultadosDerivados {
  if (q2.problema) return { estado: "problema", problema: q2.problema };
  if (q3.problema) return { estado: "problema", problema: q3.problema };

  const seleccion = primerIntentoPorAlumna(q3.diagnosticos, q3.legado);
  const seleccionados = [...seleccion.values()];
  const enviados = seleccionados.filter((i) => i.estado === "enviado");

  // Promedio: MISMA función y MISMAS poblaciones que `panel.promedioDe` (paridad).
  // `desbordado: false` porque `problema: "intentos"` ya cortó ANTES de llegar aquí.
  const promedio = promedioDeAsignacion({
    diagnosticos: q3.diagnosticos,
    legado: q3.legado,
    desbordado: false,
  });

  const calificados = enviados
    .filter((i) => i.puntaje !== undefined)
    .map((i) => redondearPuntaje(i.puntaje as number));
  const mayorPuntaje = calificados.length ? Math.max(...calificados) : null;
  const menorPuntaje = calificados.length ? Math.min(...calificados) : null;

  // Participación: total = roster activo; X ⊆ Y con el MISMO selector canónico. La cuenta la
  // hace `participacionDe` (helper compartido con el Resumen de LUI-32) sobre los conjuntos
  // de ids; `total` se mantiene en `q2.alumnas.length` (no `deTotal`) para preservar bit a
  // bit la cifra histórica ante un roster con ids repetidos, imposible por el modelo.
  const enviadasIds = enviados.map((i) => i.alumnoId);
  const part = participacionDe(
    enviadasIds,
    q2.alumnas.map((a) => a.alumnoId),
  );
  const participacion = {
    completaron: part.completaron,
    total: q2.alumnas.length,
    tono: tonoParticipacion(part.completaron, q2.alumnas.length),
  };

  const presentaronFueraDeRoster = part.fuerasDeRoster;

  const agregado = agregarDesgloses(seleccionados);

  // Catálogo indexado.
  const seccionPorId = new Map(
    q3.catalogo.secciones.map((s) => [s.seccionId, s]),
  );
  const areaPorId = new Map(q3.catalogo.areas.map((a) => [a.areaId, a]));

  // Columnas: `ordenSecciones` declarado primero, luego el resto de las agregadas por
  // `orden` del catálogo (null al final) → id. Orden TOTAL y estable.
  const cmpStr = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const declaradas = q3.ordenSecciones ?? [];
  const restantes = [...agregado.porSeccion.keys()]
    .filter((id) => !declaradas.includes(id))
    .sort((x, y) => {
      const ox = seccionPorId.get(x)?.orden ?? Number.POSITIVE_INFINITY;
      const oy = seccionPorId.get(y)?.orden ?? Number.POSITIVE_INFINITY;
      return ox !== oy ? ox - oy : cmpStr(x, y);
    });
  const ordenColumnas = [...new Set([...declaradas, ...restantes])];
  const columnas: ColumnaSeccion[] = ordenColumnas.map((seccionId) => ({
    seccionId,
    nombre: seccionPorId.get(seccionId)?.nombre ?? null,
  }));

  // Filas: una por alumna del roster (orden nombre → id). El estado del reloj —la ÚNICA
  // lectura de `ahora` de esta derivación— vive aquí: sin intento y ventana cerrada ⇒
  // «No contestó» (LUI-31), jamás estampado por el servidor.
  const ventanaCerrada =
    estadoDeVentana(q2.abreEn, q2.cierraEn, ahora) === "cerrada";
  const filas: FilaAlumna[] = [...q2.alumnas]
    .sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre, "es") || cmpStr(a.alumnoId, b.alumnoId),
    )
    .map((al) => {
      const sel = seleccion.get(al.alumnoId);
      if (!sel) {
        return {
          alumnoId: al.alumnoId,
          nombre: al.nombre,
          estado: ventanaCerrada ? ("no_contesto" as const) : ("pendiente" as const),
          puntaje: null,
          enviadoEn: null,
          iniciadoEn: null,
          porSeccion: ordenColumnas.map(() => null),
          sinDesglose: false,
        };
      }
      const esEnviado = sel.estado === "enviado";
      const desglose = new Map(
        (sel.aciertosPorSeccion ?? []).map((c) => [
          c.seccionId,
          { aciertos: c.aciertos, total: c.total },
        ]),
      );
      return {
        alumnoId: al.alumnoId,
        nombre: al.nombre,
        estado: esEnviado ? ("completado" as const) : ("en_curso" as const),
        puntaje:
          esEnviado && sel.puntaje !== undefined
            ? redondearPuntaje(sel.puntaje)
            : null,
        enviadoEn: sel.enviadoEn ?? null,
        iniciadoEn: sel.iniciadoEn,
        porSeccion: ordenColumnas.map((s) => desglose.get(s) ?? null),
        sinDesglose: esEnviado && !sel.aciertosPorSeccion,
      };
    });

  // Acordeón: secciones en el orden de columnas; áreas agrupadas por el `seccionId` de su
  // doc de catálogo. Un área cuyo doc no resolvió (`nombre === null` sin `seccionId`) o
  // cuya sección no está entre las columnas cae en la CUBETA final «Sin clasificación
  // vigente» — honesto, jamás heredando una sección inventada.
  const areasAgregadas = [...agregado.porArea.entries()].map(
    ([areaId, conteo]) => {
      const cat = areaPorId.get(areaId);
      return {
        areaId,
        nombre: cat?.nombre ?? null,
        seccionId: cat?.seccionId ?? null,
        orden: cat?.orden ?? null,
        aciertos: conteo.aciertos,
        total: conteo.total,
        pct: conteo.total > 0 ? conteo.aciertos / conteo.total : 0,
      };
    },
  );
  const areaDeAcordeon = (a: (typeof areasAgregadas)[number]): AreaDeAcordeon => ({
    areaId: a.areaId,
    nombre: a.nombre,
    aciertos: a.aciertos,
    total: a.total,
    pct: a.pct,
    reforzar: a.pct < UMBRAL_REFUERZO_AREA,
  });
  const ordenAreas = (
    x: (typeof areasAgregadas)[number],
    y: (typeof areasAgregadas)[number],
  ) => {
    const ox = x.orden ?? Number.POSITIVE_INFINITY;
    const oy = y.orden ?? Number.POSITIVE_INFINITY;
    return ox !== oy ? ox - oy : cmpStr(x.areaId, y.areaId);
  };
  const enColumnas = new Set(ordenColumnas);
  const acordeon: SeccionDeAcordeon[] = ordenColumnas.map((seccionId) => {
    const conteo = agregado.porSeccion.get(seccionId);
    return {
      seccionId,
      nombre: seccionPorId.get(seccionId)?.nombre ?? null,
      pct: conteo && conteo.total > 0 ? conteo.aciertos / conteo.total : null,
      areas: areasAgregadas
        .filter((a) => a.seccionId !== null && a.seccionId === seccionId)
        .sort(ordenAreas)
        .map(areaDeAcordeon),
    };
  });
  const huerfanas = areasAgregadas
    .filter((a) => a.seccionId === null || !enColumnas.has(a.seccionId))
    .sort(ordenAreas)
    .map(areaDeAcordeon);
  if (huerfanas.length > 0) {
    acordeon.push({ seccionId: null, nombre: null, pct: null, areas: huerfanas });
  }

  // Mejor sección: max pct agregado; desempate pct desc → `orden` asc (null al final) → id.
  let mejorSeccion: { seccionId: SeccionId; nombre: string | null; pct: number } | null =
    null;
  for (const [seccionId, conteo] of agregado.porSeccion) {
    if (conteo.total <= 0) continue;
    const pct = conteo.aciertos / conteo.total;
    if (mejorSeccion === null) {
      mejorSeccion = {
        seccionId,
        nombre: seccionPorId.get(seccionId)?.nombre ?? null,
        pct,
      };
      continue;
    }
    const ordenNuevo = seccionPorId.get(seccionId)?.orden ?? Number.POSITIVE_INFINITY;
    const ordenMejor =
      seccionPorId.get(mejorSeccion.seccionId)?.orden ?? Number.POSITIVE_INFINITY;
    if (
      pct > mejorSeccion.pct ||
      (pct === mejorSeccion.pct &&
        (ordenNuevo < ordenMejor ||
          (ordenNuevo === ordenMejor &&
            cmpStr(seccionId, mejorSeccion.seccionId) < 0)))
    ) {
      mejorSeccion = {
        seccionId,
        nombre: seccionPorId.get(seccionId)?.nombre ?? null,
        pct,
      };
    }
  }

  const fronteras = q2.cierraEn > ahora ? [q2.cierraEn] : [];

  return {
    estado: "datos",
    promedio,
    mayorPuntaje,
    menorPuntaje,
    participacion,
    mejorSeccion,
    columnas,
    filas,
    acordeon,
    presentaronFueraDeRoster,
    desgloseIncompleto: agregado.sinDesglose,
    fronteras,
    datosCompletos: agregado.sinDesglose === 0,
  };
}
