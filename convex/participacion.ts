import { ConvexError, type GenericId } from "convex/values";
import { estadoDeVentana } from "./examenEstado";
import { siguienteMedianocheMx } from "./fechas";

/**
 * PARTICIPACIÓN del panel del instructor (LUI-19), en un módulo PURO.
 *
 * Misma razón de existir que `asignacionDestino.ts`: `npx convex run` corre sin
 * identidad (lo decidible sin BD se prueba en `scripts/test-panel-instructor.ts`
 * contra ESTE código) y la derivación la comparten el SERVIDOR (que no la ejecuta:
 * solo entrega crudo), el CLIENTE (que deriva con su reloj anclado) y las pruebas.
 * Solo importa `convex/values` y los módulos puros hermanos; los tipos salen de
 * `Infer`, jamás de `_generated`.
 *
 * ══ LA PARTICIÓN SERVIDOR/CLIENTE ══
 *
 * Las queries de LUI-19 (`panelInstructor.resumen` / `participacionDeGrupo`)
 * devuelven fronteras CRUDAS (`abreEn`/`cierraEn`) y datos de intento SIN estados
 * de reloj estampados: una query de Convex no se re-invalida por el paso del
 * tiempo (contrato de `examenEstado.estadoDeVentana`). `derivarPanelInstructor`
 * corre EN EL CLIENTE con el `ahora` del reloj anclado — cards que aparecen al
 * cruzar `abreEn` y desaparecen al cruzar `cierraEn` sin re-query — y en las
 * pruebas con un `ahora` fijo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas y presupuestos del panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Umbral GLOBAL de participación (decisión de producto 2026-07-12): la barra de un
 * grupo se pinta verde cuando completó al menos el 60 %, naranja debajo. Vive aquí
 * —no en `ProgressBar`— porque es negocio, no presentación: el componente recibe
 * el tono ya decidido.
 */
export const UMBRAL_PARTICIPACION = 0.6;

/** Filas visibles de «Pendientes de participación» (mock 13): el corte es del RENDER
 *  (`slice`) sobre la lista completa ya derivada — con «Ver todos» como salida; el
 *  servidor jamás trunca. */
export const MAX_PENDIENTES_VISIBLES = 5;

/**
 * Grupos ACTIVOS que el panel procesa por ejecución de `resumen`. Un instructor
 * real lleva 2-4; 20 cubre cualquier plantilla plausible. Más → el retorno lo dice
 * con `gruposOmitidos` (campo EXPLÍCITO: el cliente distingue «exactamente 20» de
 * «truncado») y se procesan los primeros 20 del orden del índice — un conjunto SIN
 * dimensión temporal, estable entre ejecuciones.
 */
export const MAX_GRUPOS_PANEL = 20;

/**
 * PERFILES leídos del roster de un grupo (población del índice `perfiles.by_grupo`:
 * cuenta TAMBIÉN inactivos — un grupo con 40 activas y 161 registros inactivos
 * desborda, y eso es correcto: el límite protege la LECTURA, no describe alumnas).
 * El corte se detecta con `page.length > MAX ∨ !isDone` y produce el problema
 * `"roster"` del grupo (sin roster, sin sondas, sin pendientes de ese grupo).
 */
export const MAX_PERFILES_PANEL_POR_GRUPO = 200;

/** Tope de BYTES del roster de un grupo — lo aplica el RUNTIME de Convex vía
 *  `maximumBytesRead` del paginate (la garantía no depende de promedios). */
export const ROSTER_BYTES_PANEL = 262_144;

/**
 * Filas y bytes del scan del catálogo de `grupos` en `resumen` (la tabla no tiene
 * índices y el panel NO puede hacer `ctx.db.get` por unión: 100 gets × 1 MiB/doc
 * no cabe en el presupuesto — un scan paginado con tope de bytes sí). Corte →
 * `catalogoDesbordado` (solo problema).
 */
export const MAX_GRUPOS_CATALOGO_PANEL = 200;
export const CATALOGO_BYTES_PANEL = 524_288;

/** Filas y bytes del paginate de `secciones` en `material` (Σ `reactivosCount`).
 *  Corte → `totalReactivos: null` + `desbordado` (jamás una cifra inventada). */
export const MAX_SECCIONES_PANEL = 100;
export const SECCIONES_BYTES_PANEL = 262_144;

/**
 * Parejas (asignación viva × alumna activa) que `participacionDeGrupo` sondea por
 * ejecución. Cada pareja cuesta ≤2 rangos y ≤2 documentos (dos `.first()` sobre
 * `intentos.by_asignacion_alumno_estado`), así que 512 parejas ≈ 1,024 rangos —
 * dentro del presupuesto de la query con margen. Peor caso contractual de parejas:
 * 30 vivas × 200 perfiles = 6,000 ⇒ el conteo se hace ANTES de sondear y el exceso
 * es `sondasOmitidas` (las cards salen sin avance; problema VISIBLE), jamás un
 * fallo de límites a mitad de lectura.
 */
export const PRESUPUESTO_SONDAS_GRUPO = 512;

/**
 * Techo de UNIONES en `grupoInstructores` por instructor — TOTALES, grupos
 * cerrados incluidos (cerrar un grupo conserva sus relaciones). Existe PARA que el
 * presupuesto del panel sea demostrable: con esta frontera en TODOS los escritores
 * (`grupos.crear`/`actualizar`, `usuarios.crear`/`actualizar`, vía
 * `instructores.asegurarCapacidadMembresias`), una sonda `take(MAX + 1)` ES el
 * conjunto completo de membresías. No confundir con `MAX_GRUPOS_DESTINO` (acota
 * UNA operación de asignación, no el acumulado por instructor). Un instructor real
 * acumula ~4 grupos por ciclo: 100 son más de una década de historia.
 */
export const MAX_GRUPOS_POR_INSTRUCTOR = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Estados de intento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enumeración COMPARTIDA de los estados de `intentos.estado`. Las DOS sondas del
 * panel (`participacionDeGrupo`) son la enumeración exhaustiva de esta constante:
 * primero `"enviado"` (completó) y, solo si no existe, `"en_curso"`. ⚠️ Un TERCER
 * estado en el schema obliga a revisar esas sondas — el check de longitud en
 * `test-panel-instructor.ts` existe para señalarlo.
 */
export const ESTADOS_INTENTO = ["en_curso", "enviado"] as const;
export type EstadoIntentoAlumna = (typeof ESTADOS_INTENTO)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de las queries (Q1 · Q2) — ids por GenericId de convex/values (mismo tipo
// nominal que produce `v.id(...)` vía Infer), sin tocar `_generated`
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoId = GenericId<"grupos">;
export type AlumnoId = GenericId<"users">;
export type ExamenId = GenericId<"examenes">;
export type AsignacionId = GenericId<"asignaciones">;

/** Fila de grupo de Q1 (`panelInstructor.resumen`). `problema` es DISCRIMINADO:
 *  `"asignaciones_vivas"` = legado con >MAX vivas — sus asignaciones NO se
 *  procesaron (estado de problema explícito, jamás «las 30 primeras», que el paso
 *  del tiempo volvería mentira). */
export type GrupoDelPanel = {
  grupoId: GrupoId;
  nombre: string;
  problema?: "asignaciones_vivas";
};

/** Asignación VIVA de Q1: fronteras crudas + `titulo` del read-model
 *  (`asignaciones.tituloExamen` — inmutable por el candado de LUI-20). */
export type AsignacionDelPanel = {
  asignacionId: AsignacionId;
  examenId: ExamenId;
  titulo: string;
  grupoId: GrupoId;
  abreEn: number;
  cierraEn: number;
};

/** Forma de Q1 que consume la derivación (los flags globales de solo-problema —
 *  `membresiaDesbordada`, `catalogoDesbordado`— los maneja el cliente ANTES de
 *  derivar; estos dos sí afectan la completitud de Pendientes). */
export type PanelQ1 = {
  grupos: GrupoDelPanel[];
  asignaciones: AsignacionDelPanel[];
  gruposOmitidos: boolean;
  asignacionesLegadasOmitidas: boolean;
};

/** Retorno de Q2 (`participacionDeGrupo`) cuando hay acceso. `alumnas` son SOLO
 *  las activas, en proyección `{alumnoId, nombre}` (jamás perfiles completos).
 *  `problema: "roster"` = corte del paginate por filas o bytes (sin roster ni
 *  sondas). `sondasOmitidas` = parejas > presupuesto (roster tampoco viaja). */
export type ParticipacionDeGrupo = {
  grupoId: GrupoId;
  alumnas: { alumnoId: AlumnoId; nombre: string }[];
  porAsignacion: {
    asignacionId: AsignacionId;
    porAlumna: { alumnoId: AlumnoId; estado: EstadoIntentoAlumna }[];
  }[];
  problema?: "roster";
  sondasOmitidas: boolean;
};

/**
 * Estado de la Q2 de un grupo tal como lo entrega `useQueries` al cliente, ya
 * NORMALIZADO por `ParticipacionesLoader`. El contrato de `useQueries` es
 * `resultado | null | undefined | Error` — los CUATRO miembros:
 *   · `undefined`    → CARGANDO (el único estado que cuenta como carga);
 *   · `null`         → la query negó el acceso (membresía revocada o grupo cerrado
 *                      entre snapshots) → `"sin_acceso"`, problema por grupo;
 *   · `Error`        → `"error"`, problema por grupo;
 *   · `resultado`    → datos (que aún pueden traer `problema`/`sondasOmitidas`).
 */
export type EstadoParticipacion =
  | ParticipacionDeGrupo
  | undefined
  | "error"
  | "sin_acceso";

// ─────────────────────────────────────────────────────────────────────────────
// Derivación (corre en CLIENTE y en pruebas — jamás en la query)
// ─────────────────────────────────────────────────────────────────────────────

export type TonoParticipacion = "green" | "orange";

/**
 * Tono de la barra por umbral global. TOTAL por construcción: `total <= 0` →
 * `"orange"` (sin alumnas no hay participación que celebrar, y la función no
 * divide entre cero). En la frontera exacta (60 %) es VERDE (`>=`).
 */
export function tonoParticipacion(
  completaron: number,
  total: number,
): TonoParticipacion {
  if (total <= 0) return "orange";
  return completaron / total >= UMBRAL_PARTICIPACION ? "green" : "orange";
}

export type BarraDeGrupo = {
  grupoId: GrupoId;
  nombre: string;
  completaron: number;
  total: number;
  tono: TonoParticipacion;
};

export type CardExamen = {
  examenId: ExamenId;
  titulo: string;
  /** `min(cierraEn)` de las asignaciones ABIERTAS del examen: el deadline más
   *  urgente — la misma vara que ordena las cards y elige «Ver todos». */
  cierraProximo: number;
  barras: BarraDeGrupo[];
};

export type FilaPendiente = {
  alumnoId: AlumnoId;
  alumnoNombre: string;
  grupoId: GrupoId;
  grupoNombre: string;
  examenId: ExamenId;
  examenTitulo: string;
  estado: "en_curso" | "no_iniciado";
};

export type PanelDerivado = {
  cards: CardExamen[];
  /** Lista COMPLETA (el corte a `MAX_PENDIENTES_VISIBLES` es del render). */
  pendientes: FilaPendiente[];
  /** Examen activo más próximo a cerrar (destino de «Ver todos»); null sin cards. */
  examenVerTodos: ExamenId | null;
  /** Instantes FUTUROS que cambian lo derivado: `abreEn`/`cierraEn` por venir y la
   *  próxima medianoche MX (la fecha del encabezado cruza sola). Alimentan el
   *  timer del reloj anclado. */
  fronteras: number[];
  /** ∃ grupo con asignación ABIERTA cuya Q2 sigue `undefined` — SOLO `undefined`
   *  es carga; `"sin_acceso"`/`"error"` son problema, no carga. */
  participacionesCargando: boolean;
  /**
   * Completitud GLOBAL de «Pendientes de participación» (condición del GO):
   * incluye los flags de Q1 (`gruposOmitidos`, `asignacionesLegadasOmitidas`,
   * grupos con `problema`) Y el estado de cada Q2 requerida. El vacío-EXITOSO
   * («Nadie pendiente») SOLO se muestra cuando es `true`: con cualquier grupo
   * omitido y cero filas visibles, lo honesto es «datos incompletos», no éxito.
   */
  datosPendientesCompletos: boolean;
};

/** ¿La Q2 de un grupo llegó completa y utilizable? (cargada, con acceso, sin
 *  problema de roster ni sondas omitidas). */
function participacionUtilizable(
  p: EstadoParticipacion,
): p is ParticipacionDeGrupo {
  return (
    p !== undefined &&
    p !== "error" &&
    p !== "sin_acceso" &&
    p.problema === undefined &&
    !p.sondasOmitidas
  );
}

/**
 * Deriva TODO lo que pinta el panel a partir de Q1 + las Q2 por grupo y el `ahora`
 * del reloj anclado.
 *
 * REGLA DE ORO (auditoría v6-v10): ante costura incompleta JAMÁS se fabrican
 * datos. Un grupo cuya Q2 falta (cargando), falló (`"error"`), fue negada
 * (`"sin_acceso"`) o llegó degradada (`problema`/`sondasOmitidas`) produce cards
 * SIN su barra y CERO pendientes suyos — nunca un «0 de Y» inventado — y apaga
 * `datosPendientesCompletos`.
 *
 * «Completó» ≡ ∃ intento `"enviado"` de la alumna en ALGUNA asignación abierta del
 * (examen, grupo) — SIN exigir `puntaje`. Difiere a propósito del proxy de
 * `panel.puntajePromedio` (que acota a calificados porque PROMEDIA): la
 * participación mide entrega, no calificación. Indiferente al contrato provisional
 * de LUI-104: «existe ≥1 enviado» ⟺ «el primer intento enviado existe».
 *
 * X ⊆ roster: los enviados se INTERSECTAN con las alumnas activas — una alumna
 * desactivada con intento no suma ni a X ni a Y (caso Santiago del seed).
 *
 * Órdenes TOTALES (deterministas hasta el id, para el E2E): cards por
 * `cierraProximo` → título (`localeCompare` es) → `examenId`; barras por nombre →
 * `grupoId`; pendientes por cierre del examen → título → `examenId` → grupo →
 * `grupoId` → alumna → `alumnoId`.
 */
export function derivarPanelInstructor(
  q1: PanelQ1,
  participaciones: ReadonlyMap<GrupoId, EstadoParticipacion>,
  ahora: number,
): PanelDerivado {
  const porGrupo = new Map<GrupoId, GrupoDelPanel>();
  for (const g of q1.grupos) porGrupo.set(g.grupoId, g);

  // Filas utilizables: de grupos presentes en Q1 y SIN problema Q1. (Defensivo: el
  // servidor no devuelve filas de grupos con problema, pero la derivación no lo
  // presupone — una fila de un grupo ausente se ignora, jamás inventa un grupo.)
  const vivas = q1.asignaciones.filter((a) => {
    const g = porGrupo.get(a.grupoId);
    return g !== undefined && g.problema === undefined;
  });

  const abiertas = vivas.filter(
    (a) => estadoDeVentana(a.abreEn, a.cierraEn, ahora) === "abierta",
  );

  // ── Cards por examen (ids CRUDOS como claves) ──────────────────────────────
  const porExamen = new Map<ExamenId, AsignacionDelPanel[]>();
  for (const a of abiertas) {
    const lista = porExamen.get(a.examenId);
    if (lista) lista.push(a);
    else porExamen.set(a.examenId, [a]);
  }

  const cards: CardExamen[] = [];
  for (const [examenId, filas] of porExamen) {
    const cierraProximo = Math.min(...filas.map((f) => f.cierraEn));
    // Grupos del examen (únicos, en id crudo).
    const gruposDelExamen = new Map<GrupoId, AsignacionDelPanel[]>();
    for (const f of filas) {
      const l = gruposDelExamen.get(f.grupoId);
      if (l) l.push(f);
      else gruposDelExamen.set(f.grupoId, [f]);
    }
    const barras: BarraDeGrupo[] = [];
    for (const [grupoId, filasDelGrupo] of gruposDelExamen) {
      const p = participaciones.get(grupoId);
      if (!participacionUtilizable(p)) continue; // sin barra: nada fabricado
      const activas = new Set(p.alumnas.map((al) => al.alumnoId));
      // «Completó» = enviado en CUALQUIERA de las abiertas de este (examen, grupo)
      // — unión por alumnoId: dos asignaciones solapadas cuentan una vez.
      const completaronSet = new Set<AlumnoId>();
      for (const f of filasDelGrupo) {
        const registro = p.porAsignacion.find(
          (x) => x.asignacionId === f.asignacionId,
        );
        if (!registro) continue;
        for (const al of registro.porAlumna) {
          if (al.estado === "enviado" && activas.has(al.alumnoId))
            completaronSet.add(al.alumnoId);
        }
      }
      const total = p.alumnas.length;
      const completaron = completaronSet.size;
      barras.push({
        grupoId,
        nombre: porGrupo.get(grupoId)?.nombre ?? "",
        completaron,
        total,
        tono: tonoParticipacion(completaron, total),
      });
    }
    barras.sort(
      (a, b) => a.nombre.localeCompare(b.nombre, "es") || cmp(a.grupoId, b.grupoId),
    );
    cards.push({
      examenId,
      titulo: filas[0].titulo,
      cierraProximo,
      barras,
    });
  }
  cards.sort(
    (a, b) =>
      a.cierraProximo - b.cierraProximo ||
      a.titulo.localeCompare(b.titulo, "es") ||
      cmp(a.examenId, b.examenId),
  );

  // ── Pendientes (solo de grupos con Q2 utilizable) ──────────────────────────
  const pendientes: FilaPendiente[] = [];
  const cierreDeExamen = new Map<ExamenId, number>();
  for (const c of cards) cierreDeExamen.set(c.examenId, c.cierraProximo);
  for (const [examenId, filas] of porExamen) {
    const gruposDelExamen = new Map<GrupoId, AsignacionDelPanel[]>();
    for (const f of filas) {
      const l = gruposDelExamen.get(f.grupoId);
      if (l) l.push(f);
      else gruposDelExamen.set(f.grupoId, [f]);
    }
    for (const [grupoId, filasDelGrupo] of gruposDelExamen) {
      const p = participaciones.get(grupoId);
      if (!participacionUtilizable(p)) continue;
      const registros = filasDelGrupo
        .map((f) =>
          p.porAsignacion.find((x) => x.asignacionId === f.asignacionId),
        )
        .filter((r) => r !== undefined);
      for (const alumna of p.alumnas) {
        let envio = false;
        let enCurso = false;
        for (const r of registros) {
          for (const al of r.porAlumna) {
            if (al.alumnoId !== alumna.alumnoId) continue;
            if (al.estado === "enviado") envio = true;
            else enCurso = true;
          }
        }
        if (envio) continue;
        pendientes.push({
          alumnoId: alumna.alumnoId,
          alumnoNombre: alumna.nombre,
          grupoId,
          grupoNombre: porGrupo.get(grupoId)?.nombre ?? "",
          examenId,
          examenTitulo: filas[0].titulo,
          estado: enCurso ? "en_curso" : "no_iniciado",
        });
      }
    }
  }
  pendientes.sort(
    (a, b) =>
      (cierreDeExamen.get(a.examenId) ?? 0) -
        (cierreDeExamen.get(b.examenId) ?? 0) ||
      a.examenTitulo.localeCompare(b.examenTitulo, "es") ||
      cmp(a.examenId, b.examenId) ||
      a.grupoNombre.localeCompare(b.grupoNombre, "es") ||
      cmp(a.grupoId, b.grupoId) ||
      a.alumnoNombre.localeCompare(b.alumnoNombre, "es") ||
      cmp(a.alumnoId, b.alumnoId),
  );

  // ── Fronteras del timer ────────────────────────────────────────────────────
  const fronteras = new Set<number>();
  for (const a of vivas) {
    if (a.abreEn > ahora) fronteras.add(a.abreEn);
    if (a.cierraEn > ahora) fronteras.add(a.cierraEn);
  }
  fronteras.add(siguienteMedianocheMx(ahora));

  // ── Carga y completitud GLOBAL (condición del GO) ──────────────────────────
  const gruposRequeridos = new Set(abiertas.map((a) => a.grupoId));
  let participacionesCargando = false;
  let q2Completas = true;
  for (const grupoId of gruposRequeridos) {
    const p = participaciones.get(grupoId);
    if (p === undefined) {
      participacionesCargando = true;
      q2Completas = false;
    } else if (!participacionUtilizable(p)) {
      q2Completas = false;
    }
  }
  const q1Completa =
    !q1.gruposOmitidos &&
    !q1.asignacionesLegadasOmitidas &&
    q1.grupos.every((g) => g.problema === undefined);
  const datosPendientesCompletos = q1Completa && q2Completas;

  return {
    cards,
    pendientes,
    examenVerTodos: cards.length > 0 ? cards[0].examenId : null,
    fronteras: [...fronteras].sort((a, b) => a - b),
    participacionesCargando,
    datosPendientesCompletos,
  };
}

/** Comparador estable de ids (strings de Convex): desempate FINAL de todo orden. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontera de membresías (grupoInstructores)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda del techo de membresías por instructor. La aplican los CUATRO escritores
 * de `grupoInstructores` vía `instructores.asegurarCapacidadMembresias`, que le
 * pasa el conteo acotado `by_instructor … take(MAX + 1).length` y el delta que el
 * escritor YA computó tras su dedupe/reconciliación (`usuarios.actualizar`
 * deduplica y autosana — el tamaño relevante es el FINAL, no `existentes + 1`).
 *
 * ⚠️ `existentes > MAX` significa que la sonda se SATURÓ (hay ≥ MAX + 1 uniones
 * reales — legado pre-frontera): el tamaño real es DESCONOCIDO, así que cualquier
 * alta se rechaza sin fingir aritmética («101 − 2 + 1 = 100» sería mentira con 150
 * reales). Las bajas puras (sin altas) siempre proceden: solo encogen.
 */
export function validarMembresias(
  nombreInstructor: string,
  existentes: number,
  añadidas: number,
  removidas: number,
): void {
  if (añadidas === 0) return;
  if (existentes > MAX_GRUPOS_POR_INSTRUCTOR)
    throw new ConvexError(
      `«${nombreInstructor}» excede el límite de grupos por instructor ` +
        `(${MAX_GRUPOS_POR_INSTRUCTOR}) por datos previos a la cota; no se le ` +
        "pueden añadir grupos hasta depurar sus membresías.",
    );
  if (existentes - removidas + añadidas > MAX_GRUPOS_POR_INSTRUCTOR)
    throw new ConvexError(
      `«${nombreInstructor}» alcanzó el máximo de grupos por instructor ` +
        `(${MAX_GRUPOS_POR_INSTRUCTOR}).`,
    );
}
