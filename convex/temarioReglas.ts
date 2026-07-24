import { ConvexError } from "convex/values";

/**
 * Reglas PURAS del temario compartidas entre el CRUD (`temario.ts`) y las pruebas
 * (`scripts/test-resultados.ts`). Viven aparte porque `temario.ts` define funciones de
 * Convex (importa `_generated/server`) y un script `tsx` no puede importarlo — la misma
 * razón de existir que `examenEstado.ts` y `simulacro.ts`.
 */

/**
 * Longitud máxima del `nombre` de una sección/área/subtema (LUI-30, plan v3). Es una
 * frontera de ESCRITURA nueva: antes `nombreLimpio` solo exigía no-vacío, así que un nombre
 * válido podía pesar hasta ~1 MiB (el límite duro por documento) — y las queries que
 * resuelven nombres del catálogo por `ctx.db.get` (LUI-30 Q3) no podrían presupuestar sus
 * bytes contra el dominio de escritura. 120 caracteres cubre el nombre real más largo del
 * temario canónico con margen; el legado anterior a esta cota queda protegido del lado de
 * LECTURA por el paro temprano de `CATALOGO_CLASIF_BYTES` (resultados.ts), así que no
 * necesita reconciliación.
 */
export const MAX_NOMBRE_TEMARIO = 120;

export const MSG_NOMBRE_OBLIGATORIO = "El nombre es obligatorio.";
export const MSG_NOMBRE_LARGO = `El nombre no puede exceder ${MAX_NOMBRE_TEMARIO} caracteres.`;

/**
 * Techo GLOBAL de secciones tipo `modulo` **activas** (LUI-36). Techo APROBADO por el dueño
 * del producto (2026-07-23): el EXANI II real ronda 14 módulos, así que 30 no se toca en uso
 * normal.
 *
 * Existe porque el selector de módulos de la alumna (`temario.modulosParaAlumna`) lee el
 * catálogo completo en UNA query, y una cota de LECTURA sin frontera de ESCRITURA es una
 * bomba: al crear el módulo activo 31, la lectura fail-closed dejaría sin editor de módulos
 * a TODAS las alumnas a la vez. Con la frontera puesta, lectura (31 = 30+centinela) ≥
 * dominio de escritura (30) ⇒ el desborde es imposible con datos válidos y el centinela solo
 * protege legado.
 *
 * ⚠️ La exigen los **TRES** escritores del dominio, no dos: `temario.crear` (un módulo nace
 * `activo: true`), `temario.cambiarEstado` (reactivación) y `seed.ts` (inserta secciones
 * directamente, saltándose el CRUD — un fixture no puede fabricar un estado que el producto
 * considera inválido). Desactivar nunca desborda.
 *
 * Verificado antes de desplegar (`npx convex data secciones [--prod]`, 2026-07-23):
 * dev `beloved-caterpillar-518` = 2 módulos activos · prod `tough-bee-720` = 1. Ningún
 * entorno vivo viola la frontera, así que no hace falta reconciliar datos.
 */
export const MAX_MODULOS_ACTIVOS = 30;

export const MSG_MODULOS_LLENO =
  `Ya hay ${MAX_MODULOS_ACTIVOS} módulos activos; desactiva uno antes de agregar otro.`;

/**
 * Normaliza y valida el `nombre` de un elemento del temario: sin espacios extremos,
 * no vacío, ≤ `MAX_NOMBRE_TEMARIO` caracteres. LANZA con el copy exacto que pinta el
 * formulario. La frontera exacta (120 pasa, 121 rechaza) la fija `test-resultados.ts`.
 */
export function validarNombreTemario(bruto: string): string {
  const nombre = bruto.trim();
  if (!nombre) throw new ConvexError(MSG_NOMBRE_OBLIGATORIO);
  if (nombre.length > MAX_NOMBRE_TEMARIO) throw new ConvexError(MSG_NOMBRE_LARGO);
  return nombre;
}
