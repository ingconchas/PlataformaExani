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

/**
 * «YYYY-MM-DDTHH:mm» (el `value` de un `<input datetime-local>`, leído como RELOJ DE PARED
 * mexicano) → epoch ms (LUI-22). ⚠️ JAMÁS `new Date(str)`: el navegador NO está
 * necesariamente en zona MX — parsearía en la zona local del dispositivo y la ventana
 * quedaría corrida horas enteras. Regex estricta + `Date.UTC` + el offset fijo.
 *
 * `Date.UTC` NORMALIZA fechas imposibles EN SILENCIO (30-feb → 2-mar, mes 13 → enero del
 * año siguiente, 24:00 → medianoche del día siguiente), así que la forma no basta: tras
 * construir el instante se RE-leen los cinco campos (round-trip) y cualquier discrepancia
 * → `null`. Devuelve `null` ante todo lo malformado; el que decide qué hacer es el caller.
 */
export function epochDeRelojMx(reloj: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(reloj);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const hora = Number(m[4]);
  const minuto = Number(m[5]);
  const utc = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const d = new Date(utc);
  if (
    d.getUTCFullYear() !== anio ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia ||
    d.getUTCHours() !== hora ||
    d.getUTCMinutes() !== minuto
  ) {
    return null;
  }
  return utc + OFFSET_MX_MS;
}

/**
 * Rango humano de una ventana (Diseño 19: la lista de asignaciones y el toast — «8 al 12
 * de julio»). Cuatro ramas según lo que comparten las fechas en reloj MX: mismo día →
 * «8 de julio» · mismo mes → «8 al 12 de julio» · mismo año → «28 de junio al 3 de julio»
 * · años distintos → ambos años explícitos. Se formatean los instantes TAL CUAL se
 * capturaron (el cierre semiabierto no se «corrige» aquí: la administradora escribió esa
 * fecha y esa fecha se le muestra).
 */
export function rangoCortoMx(abreEn: number, cierraEn: number): string {
  const a = new Date(abreEn - OFFSET_MX_MS);
  const c = new Date(cierraEn - OFFSET_MX_MS);
  const mismoAnio = a.getUTCFullYear() === c.getUTCFullYear();
  const mismoMes = mismoAnio && a.getUTCMonth() === c.getUTCMonth();
  if (mismoMes && a.getUTCDate() === c.getUTCDate()) {
    return `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]}`;
  }
  if (mismoMes) {
    return `${a.getUTCDate()} al ${c.getUTCDate()} de ${MESES[a.getUTCMonth()]}`;
  }
  if (mismoAnio) {
    return `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${c.getUTCDate()} de ${MESES[c.getUTCMonth()]}`;
  }
  return `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} de ${a.getUTCFullYear()} al ${c.getUTCDate()} de ${MESES[c.getUTCMonth()]} de ${c.getUTCFullYear()}`;
}
