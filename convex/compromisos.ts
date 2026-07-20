import { type QueryCtx, type MutationCtx } from "./_generated/server";
import { type Id } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/**
 * LA pregunta «¿este examen tiene algún compromiso?», en un solo lugar (LUI-21 B).
 *
 * Un compromiso es **una asignación O un intento** — y la sonda de intentos va por
 * `intentos.by_examen` **SIN filtrar estado**: `intentos.asignacionId` es OPCIONAL (existen
 * respuestas reales sin asignación que las respalde) y un `en_curso` es una alumna leyendo
 * el reactivo AHORA. Sondar solo asignaciones, o solo intentos enviados, reproduce el
 * agujero que la revisión de LUI-20 cerró en `calcularBloqueo`.
 *
 * Consumidores: `reactivos.calcularBloqueo` (el candado de edición) y
 * `examenes.despublicar` (la guarda del contrato `examenEstado.ts` — mismo criterio, mismo
 * índice, cero re-derivación). `examenes.listar` NO lo llama: su estampado reutiliza la
 * evidencia que ya carga (el `.collect()` global de asignaciones + sus sondas
 * `by_examen_estado`, donde `enviado ∨ en_curso ≡ cualquier intento` porque el schema solo
 * admite esos dos literales) — la AUTORIDAD es siempre la mutation, que sí pasa por aquí.
 *
 * Módulo propio y neutral para no crear el ciclo `examenes.ts ↔ reactivos.ts`.
 */
export async function compromisosDe(
  ctx: Ctx,
  examenId: Id<"examenes">,
): Promise<{ asignacion: boolean; intento: boolean }> {
  const [asignacion, intento] = await Promise.all([
    ctx.db
      .query("asignaciones")
      .withIndex("by_examen", (q) => q.eq("examenId", examenId))
      .first(),
    ctx.db
      .query("intentos")
      .withIndex("by_examen", (q) => q.eq("examenId", examenId))
      .first(),
  ]);
  return { asignacion: asignacion !== null, intento: intento !== null };
}
