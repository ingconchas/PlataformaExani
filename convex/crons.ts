import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Tareas periódicas (LUI-103, Entrega 2 — primeras del proyecto).
 *
 * Ambas son HIGIENE, no diques: con la clave por `userId`, `cuotas` se queda en
 * decenas de filas, y `enviosCorreo` crece al ritmo de los correos reales. Sirven
 * para que ninguna de las dos tablas crezca sin cota con el tiempo.
 *
 * Que `cuotas:limpiar` sea seguro no es casualidad: `expiraEn` marca cuándo la
 * cubeta vuelve a estar llena, y una cubeta llena es indistinguible de la ausencia
 * de fila. Borrar una fila vencida es un no-op semántico ⇒ el cron no puede
 * regalarle tokens a nadie ni competir con un consumo en curso.
 */
const crons = cronJobs();

crons.interval(
  "limpiar cuotas vencidas",
  { hours: 1 },
  internal.cuotas.limpiar,
  {},
);

// OJO: el identificador de un cron debe ser ASCII sin caracteres de control
// (`validatedCronIdentifier` en convex/server/cron.ts lo exige). Nada de tildes.
crons.interval(
  "purgar bitacora de correos",
  { hours: 24 },
  internal.correo.purgarRegistro,
  {},
);

// Sweeper de imágenes de reactivos huérfanas (LUI-15 E3). Sin args: la 1ª página fija el
// corte en `Date.now() - GRACIA_MS` y se auto-reagenda propagándolo (ver reactivos.ts).
crons.interval(
  "barrer imagenes huerfanas de reactivos",
  { hours: 24 },
  internal.reactivos.barrerImagenesHuerfanas,
  {},
);

export default crons;
