import { ConvexError, v, type Infer } from "convex/values";

/**
 * DESTINO y CAPACIDAD de la asignación de examen (LUI-22), en un módulo PURO.
 *
 * Vive aparte por las mismas razones que `constructorExamen.ts`: `npx convex run` corre sin
 * identidad (lo decidible sin BD se prueba en `scripts/test-asignacion.ts` o no se prueba) y
 * un módulo con `ctx` no podría ser compartido por escritores y lectores sin arrastrar el
 * backend completo. Solo importa `convex/values`; los tipos salen de `Infer`, jamás de
 * `_generated`.
 *
 * ══ EL INVARIANTE DEL DESTINO ══
 *
 * Una fila de `asignaciones` tiene EXACTAMENTE UNO de `grupoId` | `alumnoId`. El schema de
 * Convex no puede expresar un XOR entre campos opcionales, así que el invariante vive en dos
 * fronteras de este módulo:
 *
 *   · **Escritura** — `camposDestino` produce el FRAGMENTO de inserción con exactamente una
 *     clave; los escritores (la mutation `asignar` de LUI-22 y el seed) solo pueden
 *     esparcirlo (`...camposDestino(f)`), nunca armar el par de campos a mano. Mismo diseño
 *     que `resolverIntencionTipo`: el fragmento hace irrepresentable el estado inválido.
 *   · **Lectura** — `destinoDeFila` normaliza una fila ya cargada y LANZA ante ambos o
 *     ninguno: una fila malformada jamás se interpreta en silencio. Lo consumen todos los
 *     lectores que INTERPRETAN el destino (panel, oráculo y reconciliación del seed,
 *     `paraAsignar`/`existentesDe` en LUI-22-B). Los accesos POR ÍNDICE (`grupos.obtener`
 *     con `by_grupo eq id`, `panel.resumen` con `by_abre`) SELECCIONAN filas sin interpretar
 *     su destino y no validan el XOR — debilitación explícita, no promesa rota.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grupos por operación. UNX real opera con 3-4 grupos por ciclo; 20 cubre cualquier
 * institución plausible sin permitir que una sola operación consuma la capacidad del examen.
 * ⚠️ La rama `todosLosGrupos` NO trae arreglo que acotar en la entrada cruda: la mutation
 * comprueba este tope INMEDIATAMENTE tras coleccionar los grupos activos, antes de contar
 * alumnado o insertar — la cota no puede existir solo para la rama equivalente `grupos`.
 */
export const MAX_GRUPOS_DESTINO = 20;

/**
 * Alumnos individuales por operación. Lo individual son EXCEPCIONES (regularizaciones,
 * casos especiales); una asignación masiva va por grupos. Mantenerlo chico es además lo que
 * hace coherente la capacidad: ninguna operación única puede retirar un examen.
 */
export const MAX_ALUMNOS_DESTINO = 30;

/**
 * Techo del ACUMULADO de asignaciones por examen (política de producto, decisión nº 6 del
 * plan LUI-22). Los solapes y duplicados entre asignaciones DISTINTAS son legales (AC del
 * issue), así que sin techo el acumulado crece sin límite. La operación máxima posible
 * (30 filas) consume el 5 % de la capacidad; el uso real del fixture (≈6-12 filas por examen
 * por semestre) da decenas de años. La capacidad SE RECUPERA cancelando programadas (el
 * delete resta del conteo); un examen con 600 CONCLUIDAS queda retirado SOLO para
 * asignaciones nuevas — sigue jugable, con resultados y archivable.
 *
 * ⚠️ Lo que esta cota SÍ y NO hace: REDUCE LA PENDIENTE de los lectores acumulativos
 * (`examenes.listar` queda en peor-caso O(MAX × exámenes) — el número de exámenes no tiene
 * techo por construcción; `grupos.obtener` ídem por grupo; un legado >MAX entra completo a
 * esos collect) — NO los convierte en lecturas acotadas. El refactor real (agregados o
 * resumen materializado) es deuda declarada para cuando el volumen lo exija; hoy producción
 * tiene 0 asignaciones (auditoría remota previa a la Entrega A, 2026-07-20).
 */
export const MAX_ASIGNACIONES_POR_EXAMEN = 600;

/**
 * Techo de asignaciones NO CERRADAS (`cierraEn > ahora`: abiertas Y programadas) por
 * GRUPO. Nace como **cota de LECTURA del panel del instructor (LUI-19) aplicada en el
 * escritor**: el panel lee, por grupo, solo el conjunto vivo vía
 * `asignaciones.by_grupo_cierra` con `take(MAX + 1)`, y esta frontera es lo que hace a
 * esa sonda DEMOSTRABLE — a diferencia del techo de 600 (que solo reduce la pendiente),
 * esta cota SÍ ACOTA a su lector.
 *
 * La capacidad se **RECUPERA SOLA**: al cruzar `cierraEn` la fila deja de contar (y
 * cancelar una programada también resta) — sin estados muertos. El fixture real usa ≤4
 * vivas por grupo; 30 son semestres enteros de ventanas solapadas.
 *
 * Dimensiones independientes: 20 grupos/operación × 30 vivas/grupo se cruzan con el
 * acumulado de 600/examen sin contradicción — miden ejes distintos.
 */
export const MAX_ASIGNACIONES_VIVAS_POR_GRUPO = 30;

/**
 * El GEMELO por ALUMNA de la cota anterior, para las asignaciones INDIVIDUALES (LUI-25).
 *
 * Nace por la misma razón y con la misma mecánica: «Mis exámenes» lee las asignaciones de
 * la alumna por `by_alumno_cierra` en orden DESCENDENTE de cierre y corta en
 * `MAX_FILAS_MIS_EXAMENES_DIRECTAS`; esta frontera es lo que convierte ese corte en SEGURO
 * —con ≤30 vivas por alumna, las abiertas siempre caben en la página y lo omitido es
 * historial ya cerrado—, no en un truncado que podría esconder un examen presentable.
 *
 * Hasta LUI-25 las filas-alumno no tenían cota de vivas porque nadie las leía por alumna:
 * el panel del instructor las excluye por construcción del índice. Con su primer lector
 * llegan el índice y la frontera, juntos.
 *
 * La capacidad se RECUPERA SOLA al cerrar ventanas, igual que la de grupo. Lo individual
 * son excepciones (regularizaciones): 30 vivas simultáneas es un techo generosísimo.
 */
export const MAX_ASIGNACIONES_VIVAS_POR_ALUMNA = 30;

/**
 * Techo del HISTORIAL COMPLETO (vivas + cerradas) de asignaciones de GRUPO — la cota de
 * LECTURA del Resumen de exámenes (LUI-32) aplicada en el escritor. A diferencia de las
 * VIVAS (30, que se recupera al cerrar ventanas), esta cuenta TODO el historial y NO se
 * recupera: es un tope acumulativo, como `MAX_ASIGNACIONES_POR_EXAMEN` pero POR GRUPO.
 *
 * ══ Por qué existe ══ El Resumen lista, por bloque de grupo, sus asignaciones aplicadas
 * leyendo `asignaciones.by_grupo` con `take(MAX + 1)`. Esta frontera es lo que hace ese
 * corte DEMOSTRABLE: `cota de lectura (MAX + 1) ≥ dominio de escritura (MAX)` de forma
 * EXACTA, así que un desborde solo puede ser legado anterior a la cota (o fabricado en un
 * seed de prueba) y el bloque responde FAIL-CLOSED («Datos incompletos»), jamás un vacío
 * falso ni un prefijo presentado como historial completo.
 *
 * Aprobado por el dueño del producto (2026-07-23). El fixture real usa ≈6-12 aplicaciones
 * por grupo por semestre; 100 es margen de más de una década, y de ~3× sobre las 30 vivas.
 */
export const MAX_HISTORIAL_ASIGNACIONES_GRUPO = 100;

// ─────────────────────────────────────────────────────────────────────────────
// El destino
// ─────────────────────────────────────────────────────────────────────────────

const grupoIdValidator = v.id("grupos");
const alumnoIdValidator = v.id("users");

type GrupoId = Infer<typeof grupoIdValidator>;
type AlumnoId = Infer<typeof alumnoIdValidator>;

/**
 * Args de la mutation `asignar` (unión discriminada) AUNQUE el schema sea plano: el validator
 * de args hace irrepresentable «grupos y alumnos a la vez» desde el cliente, y la
 * materialización a filas planas ocurre una sola vez, en el escritor, vía `camposDestino`.
 *
 * `alumnoId` es `v.id("users")` —no `perfiles`— por consistencia con `intentos.alumnoId` y
 * `asignaciones.creadoPor`.
 */
export const destinoValidator = v.union(
  v.object({ tipo: v.literal("todosLosGrupos") }),
  v.object({ tipo: v.literal("grupos"), grupoIds: v.array(grupoIdValidator) }),
  v.object({ tipo: v.literal("alumnos"), alumnoIds: v.array(alumnoIdValidator) }),
);

export type Destino = Infer<typeof destinoValidator>;

/**
 * Validación de la entrada CRUDA del destino — cero lecturas de BD: rama vacía, cotas por
 * operación e ids duplicados. La mutation la ejecuta ANTES de resolver cualquier documento
 * (patrón de `validarGuardado`: primero lo decidible sobre la entrada misma).
 */
export function validarDestinoCrudo(destino: Destino): void {
  if (destino.tipo === "todosLosGrupos") return; // sin arreglo; su tope se aplica post-collect
  if (destino.tipo === "grupos") {
    if (destino.grupoIds.length === 0)
      throw new ConvexError("Elige al menos un grupo.");
    if (destino.grupoIds.length > MAX_GRUPOS_DESTINO)
      throw new ConvexError(
        `No puedes asignar a más de ${MAX_GRUPOS_DESTINO} grupos en una sola operación.`,
      );
    if (new Set(destino.grupoIds).size !== destino.grupoIds.length)
      throw new ConvexError("La lista de grupos tiene elementos repetidos.");
    return;
  }
  if (destino.alumnoIds.length === 0)
    throw new ConvexError("Elige al menos un alumno.");
  if (destino.alumnoIds.length > MAX_ALUMNOS_DESTINO)
    throw new ConvexError(
      `No puedes asignar a más de ${MAX_ALUMNOS_DESTINO} alumnos en una sola operación; ` +
        "para un grupo completo usa la asignación por grupos.",
    );
  if (new Set(destino.alumnoIds).size !== destino.alumnoIds.length)
    throw new ConvexError("La lista de alumnos tiene elementos repetidos.");
}

/**
 * FRAGMENTO de inserción del destino — exactamente UNA clave. El escritor solo puede
 * esparcirlo; armar `{grupoId, alumnoId}` a mano es el único camino hacia una fila
 * malformada y este helper lo cierra.
 *
 * ⚠️ LANZA ante ambos o ninguno, igual que `destinoDeFila`: el tipo unión NO basta —
 * TypeScript acepta un literal con AMBAS claves contra `{a} | {b}` (cada propiedad existe
 * en algún miembro), así que elegir una en silencio normalizaría una entrada malformada.
 */
export function camposDestino(
  f: { grupoId: GrupoId } | { alumnoId: AlumnoId },
): { grupoId: GrupoId } | { alumnoId: AlumnoId } {
  const grupoId = "grupoId" in f ? f.grupoId : undefined;
  const alumnoId =
    "alumnoId" in f ? (f as { alumnoId: AlumnoId }).alumnoId : undefined;
  if (grupoId !== undefined && alumnoId !== undefined)
    throw new ConvexError("Destino malformado: grupo y alumno a la vez.");
  if (grupoId !== undefined) return { grupoId };
  if (alumnoId !== undefined) return { alumnoId };
  throw new ConvexError("Destino malformado: ni grupo ni alumno.");
}

/**
 * Lector NORMALIZADOR del destino de una fila ya cargada. Ambos campos o ninguno → lanza:
 * una fila malformada es un bug de integridad y jamás se interpreta en silencio (la promesa
 * del invariante). Las filas legadas (pre-LUI-22) traen siempre `grupoId` y normalizan a la
 * rama grupo sin tocarse.
 */
export function destinoDeFila(f: {
  grupoId?: GrupoId;
  alumnoId?: AlumnoId;
}):
  | { tipo: "grupo"; grupoId: GrupoId }
  | { tipo: "alumno"; alumnoId: AlumnoId } {
  const tieneGrupo = f.grupoId !== undefined;
  const tieneAlumno = f.alumnoId !== undefined;
  if (tieneGrupo && tieneAlumno)
    throw new ConvexError(
      "Asignación malformada: tiene grupo y alumno a la vez.",
    );
  if (tieneGrupo) return { tipo: "grupo", grupoId: f.grupoId as GrupoId };
  if (tieneAlumno) return { tipo: "alumno", alumnoId: f.alumnoId as AlumnoId };
  throw new ConvexError("Asignación malformada: no tiene ni grupo ni alumno.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Capacidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda de CAPACIDAD del acumulado. La mutation le pasa el conteo acotado
 * `take(MAX_ASIGNACIONES_POR_EXAMEN + 1).length` (jamás un `collect()` sin techo) ANTES del
 * conteo proporcional de alumnado y de `validarPublicable`. El mensaje es NEUTRAL a
 * propósito: el servidor no sabe si quedan programadas cancelables — los matices de
 * recuperación son del cliente, que ve las filas.
 */
export function validarCapacidad(existentes: number, nuevas: number): void {
  if (existentes + nuevas > MAX_ASIGNACIONES_POR_EXAMEN)
    throw new ConvexError(
      `Este examen alcanzó el máximo de asignaciones (${MAX_ASIGNACIONES_POR_EXAMEN}).`,
    );
}

/**
 * Guarda de la cota de VIVAS por grupo (LUI-19). La mutation `asignar` le pasa, POR CADA
 * grupo destino (ramas `grupos` Y `todosLosGrupos` — la cota no puede existir solo en la
 * rama equivalente), el conteo acotado `by_grupo_cierra … take(MAX + 1).length` de las
 * asignaciones aún no cerradas. Cada operación inserta UNA fila por grupo, así que la
 * pregunta es siempre `existentes + 1`. El mensaje nombra al grupo: en una operación
 * multi-grupo la administradora necesita saber CUÁL está lleno.
 */
export function validarCapacidadVivas(
  nombreGrupo: string,
  existentesVivas: number,
): void {
  if (existentesVivas + 1 > MAX_ASIGNACIONES_VIVAS_POR_GRUPO)
    throw new ConvexError(
      `El grupo «${nombreGrupo}» alcanzó el máximo de asignaciones vivas ` +
        `(${MAX_ASIGNACIONES_VIVAS_POR_GRUPO}). La capacidad se libera al cerrar ` +
        "ventanas o al cancelar programadas.",
    );
}

/**
 * Guarda de la cota de VIVAS por ALUMNA (LUI-25) — el gemelo exacto de la anterior, sobre
 * `by_alumno_cierra`. `asignar` la aplica por cada alumno de la rama `alumnos`, con el
 * conteo acotado `take(MAX + 1).length`; cada operación inserta UNA fila por alumno, así que
 * la pregunta es siempre `existentes + 1`. El mensaje NOMBRA a la alumna: en una operación
 * de hasta 30 destinatarias, quien asigna necesita saber cuál está llena.
 */
export function validarCapacidadVivasAlumna(
  nombreAlumna: string,
  existentesVivas: number,
): void {
  if (existentesVivas + 1 > MAX_ASIGNACIONES_VIVAS_POR_ALUMNA)
    throw new ConvexError(
      `La alumna «${nombreAlumna}» alcanzó el máximo de asignaciones vivas ` +
        `(${MAX_ASIGNACIONES_VIVAS_POR_ALUMNA}). La capacidad se libera al cerrar ` +
        "ventanas o al cancelar programadas.",
    );
}

/**
 * Guarda del HISTORIAL COMPLETO por grupo (LUI-32). `asignar` le pasa, por cada grupo
 * destino (ramas `grupos` Y `todosLosGrupos` — la cota no puede existir solo en la rama
 * equivalente), el conteo acotado `by_grupo … take(MAX + 1).length` de TODAS sus
 * asignaciones. Cada operación inserta UNA fila por grupo ⇒ la pregunta es `existentes + 1`.
 *
 * A diferencia de las vivas, este historial NO se recupera al cerrar ventanas: el mensaje lo
 * dice para que la administradora no espere una liberación que no llegará (solo cancelar
 * programadas resta, y una vez aplicadas ya no se cancelan).
 */
export function validarCapacidadHistorialGrupo(
  nombreGrupo: string,
  existentes: number,
): void {
  if (existentes + 1 > MAX_HISTORIAL_ASIGNACIONES_GRUPO)
    throw new ConvexError(
      `El grupo «${nombreGrupo}» alcanzó el máximo de asignaciones históricas ` +
        `(${MAX_HISTORIAL_ASIGNACIONES_GRUPO}).`,
    );
}
