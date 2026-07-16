import { ConvexError } from "convex/values";

/**
 * Guard de las funciones **SOLO-DEV** (seeds, credenciales demo y borrados
 * masivos).
 *
 * Existe porque esas funciones son `internalMutation`/`internalAction`: quedan
 * fuera del gate de administrador y se invocan por CLI, y el procedimiento de
 * producción documentado en `DEPLOY.md` enseña comandos `npx convex run … --prod`.
 * Un `--prod` accidental no solo contaminaría datos: `seedAuth:credencialesDemo`
 * crearía cuentas con la contraseña conocida `Demo1234` y `seed:cargarDatosDePrueba`
 * un perfil `rol:"admin"` — es decir, un **bypass de autenticación en un sistema
 * vivo**, que es peor que cualquier borrado (los borrados al menos son ruidosos y
 * el fixture los reconstruye).
 *
 * **FAIL-CLOSED y con lista BLANCA**, no negra: si el deployment no se puede
 * identificar, la función NO corre. Una lista negra de producción se abriría sola
 * ante un deployment de producción nuevo.
 *
 * Verificado el 2026-07-15 con una sonda temporal: `CONVEX_CLOUD_URL` está
 * disponible tanto en el runtime de `mutation` como en el de `action`, así que
 * este guard sirve en ambos.
 *
 * No aplica a `bootstrap:*`: esas funciones **sí** están diseñadas para correr
 * contra producción.
 */

/** Deployments de desarrollo autorizados. Si entra otra persona al proyecto,
 *  agrega aquí el suyo — no quites el guard. */
const DEPLOYMENTS_DEV = ["beloved-caterpillar-518"];

/** El literal que toda función solo-dev exige como argumento. Uniforme a
 *  propósito: la regla debe ser una sola y no se olvida. La fuerza la pone
 *  `exigirDeploymentDeDesarrollo`, no la creatividad del string. */
export const CONFIRMACION_SOLO_DEV = "SOLO_DEV" as const;

export function exigirDeploymentDeDesarrollo(): void {
  const url = process.env.CONVEX_CLOUD_URL ?? "";
  if (!DEPLOYMENTS_DEV.some((d) => url.includes(d))) {
    throw new ConvexError(
      `Función solo-dev bloqueada: «${url || "deployment desconocido"}» no está en la lista de desarrollo. ` +
        `Si esto es producción, era exactamente el accidente que este guard previene.`,
    );
  }
}
