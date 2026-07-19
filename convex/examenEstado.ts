import { v, type Infer } from "convex/values";

/**
 * Ciclo de vida del EXAMEN (LUI-20), en un módulo PURO.
 *
 * Vive aparte —y no dentro de `examenes.ts`— por dos razones independientes:
 *
 *  1. **`npx convex run` NO pasa `requireStaff`** (corre sin identidad), así que una prueba
 *     de estas reglas por CLI se rechazaría por falta de sesión ANTES de llegar a la lógica:
 *     un falso verde. Lo decidible sin BD se prueba aquí (`scripts/test-examenes.ts`) o no se
 *     prueba. Mismo motivo que `convex/bloque.ts` y `convex/lecturaCompat.ts`.
 *  2. **`schema.ts` importa `estadoExamenValidator` de aquí**, y un módulo con `ctx` no puede
 *     ser importado por el schema.
 *
 * Es puro de verdad: solo `convex/values`. **No importa `_generated/dataModel`** ni siquiera
 * como tipo — los tipos se derivan de los propios validadores con `Infer`, que para
 * `v.id("secciones")` produce exactamente el mismo `GenericId<"secciones">` que `Id`. Así se
 * evita el ciclo `schema → examenEstado → dataModel → schema`.
 *
 * Convex rechaza GUIONES en las rutas de módulo (`examen-estado.ts` → `InvalidConfig`): de
 * ahí el camelCase, como `seedAuth` y `lecturaCompat`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Estado de edición
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ **FUENTE ÚNICA del estado de edición.** `schema.ts` usa ESTE validador; no declara su
 * propia unión de literales. Es lo que hace que `CONGELA` sea una defensa estructural de
 * verdad: con la unión duplicada en el schema, añadir un cuarto estado allá no rompería nada
 * aquí y el candado se olvidaría en silencio otra vez — exactamente el bug que LUI-20 vino a
 * corregir. Con una sola fuente, un estado nuevo entra por aquí o no entra.
 *
 * borrador → publicado → archivado. `archivado` = retirado de uso; CONSERVA todo su
 * historial de resultados. El ciclo de la VENTANA de cada asignación (programada / abierta /
 * cerrada) es INDEPENDIENTE, se deriva de las fechas y no vive en el examen.
 */
export const estadoExamenValidator = v.union(
  v.literal("borrador"),
  v.literal("publicado"),
  v.literal("archivado"),
);

export type EstadoExamen = Infer<typeof estadoExamenValidator>;

/**
 * ¿Este estado COMPROMETE el contenido del examen? Un examen comprometido **con al menos una
 * asignación o al menos un intento** congela sus reactivos —y el bloque de lectura completo—
 * en `reactivos.calcularBloqueo`. El intento cuenta aunque no venga de una asignación:
 * `intentos.asignacionId` es opcional y existen respuestas reales sin ella.
 *
 * `archivado` congela igual que `publicado` porque un examen archivado «conserva todo su
 * historial de resultados» (criterio de aceptación de LUI-20), y esos resultados solo son
 * interpretables si el contenido que los produjo no cambia. Congelar de más es la dirección
 * segura, mismo criterio conservador que `lecturaCompat.lecturaParaBloqueo`.
 *
 * ⚠️ El tipo `Record<EstadoExamen, boolean>` es DELIBERADO y es media defensa: añadir un
 * cuarto estado al validador de arriba **deja de compilar** hasta que alguien decida su
 * semántica de candado. La otra media es que el schema use ese mismo validador — sin eso,
 * este `Record` no se enteraría del estado nuevo.
 *
 * ⚠️ `Readonly` + `Object.freeze` porque es una exportación compartida: sin congelar, otro
 * módulo podría reasignar una entrada y hacer que las dos vistas del candado discrepen en
 * caliente. El tipo detiene el error honesto en compilación; el `freeze` detiene también el
 * acceso dinámico que el tipo no ve. Una defensa estructural que se puede mutar no lo es.
 */
export const CONGELA: Readonly<Record<EstadoExamen, boolean>> = Object.freeze({
  borrador: false,
  publicado: true,
  archivado: true,
});

/** Derivado de `CONGELA`, nunca escrito a mano: así las dos vistas no pueden discrepar.
 *  Congelado por lo mismo — un `push("borrador")` desde cualquier módulo desactivaría medio
 *  candado sin tocar `CONGELA` ni romper ningún tipo. */
export const ESTADOS_QUE_CONGELAN: readonly EstadoExamen[] = Object.freeze(
  (Object.keys(CONGELA) as EstadoExamen[]).filter((e) => CONGELA[e]),
);

/**
 * El grafo COMPLETO del ciclo de edición, como dato.
 *
 * `publicado → borrador` está AUSENTE a propósito: el AC de LUI-20 dice que «un examen
 * publicado con asignaciones no puede volver a borrador», y aquí se es deliberadamente MÁS
 * estricto que el AC — no hay ningún camino de vuelta a borrador, ni siquiera vía
 * `archivado`. LUI-21 puede ENSANCHARLO tras sondar `asignaciones.by_examen`: ensanchar
 * después es seguro, estrechar después no.
 *
 * ⚠️ **No hay autotransiciones** (`archivado → archivado`). Repetir una operación NO es una
 * transición: es un no-op, y lo resuelve la salida idempotente de la mutation ANTES de
 * llegar a esta comprobación. Meterlas aquí mezclaría «transición válida» con «no cambió
 * nada», que son cosas distintas — y dejaría pasar como válido un `archivar` sobre un
 * archivado que sí debería contestar `{cambiado:false}`.
 */
// Congelado en los DOS niveles —el objeto y cada arreglo— por lo mismo que `CONGELA`: un
// `TRANSICIONES.publicado.push("borrador")` desde cualquier módulo abriría el camino que el
// criterio de aceptación prohíbe, sin romper un solo tipo. Auditoría lo señaló para `CONGELA`
// y `ESTADOS_QUE_CONGELAN`; esta tabla tiene la misma exposición y se endurece igual.
export const TRANSICIONES: Readonly<
  Record<EstadoExamen, readonly EstadoExamen[]>
> = Object.freeze({
  borrador: Object.freeze(["publicado"]), // LUI-21; aquí solo se documenta
  publicado: Object.freeze(["archivado"]), // LUI-20 · archivar
  archivado: Object.freeze(["publicado"]), // LUI-20 · desarchivar
} as Record<EstadoExamen, readonly EstadoExamen[]>);

export function transicionPermitida(
  desde: EstadoExamen,
  hacia: EstadoExamen,
): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipo del examen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipo del examen: simulacro general o examen de un módulo concreto.
 *
 * **ALMACENADO, no derivado** de la clasificación de sus reactivos: es una DECISIÓN del autor
 * (LUI-21), no una consecuencia de lo que acabó metiendo. Un borrador vacío ya tiene tipo, y
 * un examen que mezclara reactivos de núcleo y de módulo no tendría respuesta derivable sin
 * inventar una regla de desempate arbitraria.
 *
 * **Unión DISCRIMINADA en un campo**, no `esModulo: boolean` + `seccionId` suelto: dos campos
 * sueltos admiten los estados ilegales «módulo sin sección» y «sección zombi en un general».
 * Aquí son irrepresentables. Mismo criterio que `reactivos.bloque` (LUI-17).
 *
 * Guarda el **id**, no el nombre: el chip dice «Módulo: {nombre}» y las secciones se renombran
 * desde el temario (LUI-18); con el nombre copiado el chip mentiría en silencio. El precio es
 * una referencia que hay que proteger → índice `by_tipo_seccion` + sonda en `temario.eliminar`.
 */
export const tipoExamenValidator = v.union(
  v.object({ clase: v.literal("general") }),
  v.object({ clase: v.literal("modulo"), seccionId: v.id("secciones") }),
);

export type TipoExamen = Infer<typeof tipoExamenValidator>;

/**
 * AUSENTE = «Simulacro general» (legado). Mismo contrato que `reactivos.contenidoFormato`
 * ausente = texto plano. Existe para que ningún consumidor vuelva a preguntar por `undefined`
 * y para que la regla viva en UN solo sitio.
 */
export function normalizarTipo(tipo: TipoExamen | undefined): TipoExamen {
  return tipo ?? { clase: "general" };
}

/**
 * La etiqueta del chip. El nombre de la sección lo resuelve el LLAMADOR (contra `secciones`);
 * si la referencia quedó colgada pasa `null` y la etiqueta **no inventa** — nunca
 * «Módulo: undefined».
 */
export function etiquetaTipo(
  tipo: TipoExamen,
  seccionNombre: string | null,
): string {
  return tipo.clase === "general"
    ? "Simulacro general"
    : `Módulo: ${seccionNombre ?? "—"}`;
}

/**
 * Intención de una futura `actualizar` sobre el tipo. **ARGUMENTO AUSENTE = MANTENER.**
 *
 * ⚠️ LUI-20 no ship ningún escritor: esto queda escrito para que **LUI-21 no reinvente la
 * forma insegura**. Un `v.optional(tipoExamenValidator)` a secas en una mutation de
 * ACTUALIZACIÓN es incompatible hacia atrás — `ctx.db.patch` BORRA el campo al recibir
 * `undefined`, y `undefined` desaparece al serializar los argumentos, así que un frontend
 * viejo durante la ventana de despliegue (`DEPLOY.md`), una pestaña abierta desde antes o un
 * rollback convertirían un examen de módulo en general **en silencio**.
 *
 * El helper devuelve el **FRAGMENTO DE PATCH** y no un `{escribir, valor}`: con esa otra
 * forma nada impide que el handler escriba `tipo: resolucion.valor` y reintroduzca el
 * borrado. Así el handler solo puede esparcir. Calcado de `material.resolverIntencionMaterial`.
 */
export const intencionTipoValidator = v.union(
  v.object({ op: v.literal("quitar") }),
  v.object({ op: v.literal("reemplazar"), tipo: tipoExamenValidator }),
);

export type IntencionTipo = Infer<typeof intencionTipoValidator>;

export function resolverIntencionTipo(
  intencion: IntencionTipo | undefined,
): { tipo?: TipoExamen } {
  if (!intencion) return {}; // AUSENTE = MANTENER (ni siquiera la clave)
  if (intencion.op === "quitar") return { tipo: undefined }; // → «general» (legado)
  return { tipo: intencion.tipo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ventana de la asignación
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoVentana = "programada" | "abierta" | "cerrada";

/**
 * La ventana de una asignación, **DERIVADA** de sus fechas — nunca almacenada. El AC exige
 * que sea automática, y un campo materializado se desincroniza en cuanto alguien mueve una
 * fecha o un cron se retrasa.
 *
 * Intervalo SEMIABIERTO `[abreEn, cierraEn)`: en `ahora === abreEn` está ABIERTA y en
 * `ahora === cierraEn` está CERRADA. Así todo instante cae en EXACTAMENTE un estado —sin
 * hueco ni solape— y queda alineado con `metricas.fueAplicada`, que ya define «aplicada»
 * como `abreEn <= ahora`. La equivalencia
 *
 *     fueAplicada(a, t)  ⟺  estadoDeVentana(a, t) !== "programada"
 *
 * es un invariante que `scripts/test-examenes.ts` asegura: si alguien mueve un criterio sin
 * mover el otro, la prueba cae.
 *
 * `ahora` es PARÁMETRO, jamás `Date.now()` aquí dentro: la query lo muestrea UNA vez y lo
 * pasa a todas las filas (si cada fila leyera el reloj, dos asignaciones podrían evaluarse
 * contra instantes distintos y los contadores no sumarían), y la prueba pura puede fijarlo.
 *
 * TOTAL por construcción: con una ventana degenerada (`abreEn === cierraEn`) o invertida
 * (`abreEn > cierraEn`) devuelve programada o cerrada, **nunca abierta**. Rechazar ventanas
 * invertidas al ESCRIBIR es frontera de LUI-22; aquí no se rompe nada.
 *
 * ⚠️ Una query de Convex **no se re-invalida por el paso del tiempo**: se re-ejecuta cuando
 * cambia un documento que leyó. Una fila renderizada «programada» no salta sola a «abierta»
 * al cruzar `abreEn`. La derivación es automática *por evaluación*; la frescura en pantalla
 * es tarea del cliente. **Prohibido** «arreglarlo» con un cron que materialice el estado:
 * reintroduce justo la desincronización que esta función existe para eliminar.
 */
export function estadoDeVentana(
  abreEn: number,
  cierraEn: number,
  ahora: number,
): EstadoVentana {
  if (ahora < abreEn) return "programada";
  if (ahora >= cierraEn) return "cerrada";
  return "abierta";
}

/**
 * ¿La ventana ya concluyó? Es la pregunta que hace la frontera de archivado: solo se archiva
 * un examen cuyas asignaciones estén TODAS cerradas (o que no tenga ninguna).
 *
 * Una asignación **futura compromete tanto como una abierta**: al llegar su fecha, un examen
 * archivado quedaría en un estado que nadie definió — o le aparece a la alumna, o desaparece
 * sin aviso, y ambas contradicen «retirado de uso». La cancelación de asignaciones es de
 * LUI-22; esta regla no la presupone.
 */
export function ventanaConcluida(
  abreEn: number,
  cierraEn: number,
  ahora: number,
): boolean {
  return estadoDeVentana(abreEn, cierraEn, ahora) === "cerrada";
}
