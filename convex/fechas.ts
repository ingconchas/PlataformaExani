/**
 * Fechas en hora del centro de México (America/Mexico_City), la zona que fija el
 * PRD para toda la plataforma. Sin librerías y **sin `Intl`**, por dos razones:
 *
 * 1. **México abolió el horario de verano** (Ley de los Husos Horarios,
 *    30-oct-2022): el centro del país es **UTC−6 fijo**. La aritmética del mes es
 *    un desplazamiento constante — no hay una base de datos de zonas que consultar.
 * 2. `Intl.DateTimeFormat("es-MX", …)` devuelve «lunes, 6 de julio de 2026»
 *    (minúscula + coma) y el diseño de LUI-9 pide «Lunes 6 de julio de 2026».
 *    Usarlo obligaría a parchear su salida con cirugía de strings — más frágil que
 *    las dos constantes de abajo, y dependiente de la versión de ICU del runtime.
 *
 * Efecto lateral útil: no dependemos de si el runtime de **queries** de Convex trae
 * datos ICU completos (hay precedente en un *action* —`invitaciones.ts`— pero no
 * está verificado en queries, y no vale la pena construir un AC sobre eso).
 *
 * Si México reinstaurara el horario de verano, `OFFSET_MX_MS` es el ÚNICO punto a
 * cambiar (y entonces sí haría falta `Intl` o una tabla de transiciones).
 *
 * El truco: `new Date(ts - OFFSET_MX_MS)` leído con los getters `getUTC*` da el
 * «reloj de pared» mexicano; volver a sumar el offset devuelve el epoch real.
 */

const OFFSET_MX_MS = 6 * 60 * 60 * 1000;

const DIAS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/**
 * Epoch ms del primer instante del mes calendario en curso, hora del centro de
 * México. `Date.UTC(y, 12, 1)` normaliza solo a enero del año siguiente, así que
 * diciembre no necesita caso especial.
 */
export function inicioDeMesMx(ahora: number): number {
  const local = new Date(ahora - OFFSET_MX_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + OFFSET_MX_MS;
}

/** «Lunes 6 de julio de 2026» — el formato exacto del encabezado del panel (LUI-9). */
export function fechaLargaMx(ts: number): string {
  const d = new Date(ts - OFFSET_MX_MS);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** «28 jun» — el formato de la columna «Fecha» de la tabla del panel (LUI-9). */
export function fechaCortaMx(ts: number): string {
  const d = new Date(ts - OFFSET_MX_MS);
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;
}
