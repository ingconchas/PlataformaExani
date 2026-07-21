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
