import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * Rate limiting propio (LUI-103, Entrega 2). Token bucket, sin componentes de
 * Convex.
 *
 * **Los recursos protegidos son la CUOTA DE ENVÍO DE CORREO y —desde LUI-15 E3— el
 * ALMACENAMIENTO de blobs (bucket `subidaImagenUsuario`, cobrado en
 * `reactivos.autorizarSubida`, que invoca el HTTP action de subida), no la CPU ni la BD.** Para el correo, de ahí salen
 * las dos decisiones que explican todo lo demás:
 *
 * 1. **La cuota se cobra donde se gasta el recurso**, es decir DESPUÉS de
 *    resolver al destinatario (ver `invitaciones.solicitarRecuperacion`). Un
 *    correo inexistente no produce envío, así que no hay nada que limitar: quien
 *    inventa 10 000 direcciones ni consume cuota ni crea una sola fila. Como
 *    efecto, la clave puede ser el `userId` y **nunca se almacena un correo**.
 *
 * 2. **Token bucket, no ventana fija.** Con ventana fija de 30/día un atacante
 *    manda 30 a las 23:59 y 30 a las 00:00 (60 en dos minutos contra una cuota
 *    diaria de ~100). El bucket acota la ráfaga a la capacidad SIEMPRE, y su
 *    recarga gradual es lo que vuelve tolerable el peor caso: tras un drenado,
 *    quien tiene derecho espera UN token (30 min), no que voltee una ventana
 *    (hasta 24 h). Cuesta lo mismo: dos números por fila.
 *
 * **Invariante que hace correcto al cron: la AUSENCIA de fila == cubeta llena.**
 * `expiraEn` marca cuándo vuelve a llenarse, así que borrar una fila vencida es
 * un no-op semántico: la limpieza no puede regalar tokens ni competir con el
 * consumo.
 */

/** Definición de una cubeta: ráfaga máxima y ritmo de recarga. */
export type DefCuota = { capacidad: number; msPorToken: number };

const MIN = 60_000;

/**
 * TODOS los números del rate limiting, en un solo lugar: son parámetros de
 * OPERACIÓN y se reajustan según la cuota real del proveedor de correo.
 *
 * Presupuesto de referencia (Resend, plan gratuito ≈100 correos/día): se
 * reservan ~50/día para invitaciones —que llegan en ráfaga, p. ej. al dar de
 * alta un grupo entero—, y por eso el techo sostenido de recuperación es 48/día.
 */
export const CUOTAS = {
  /** Anti-bombardeo del buzón de UNA persona. El enlace vive 60 min y cada envío
   *  invalida el anterior: 3 seguidos cubren «no me llegó»; más, es abuso. */
  recuperacionUsuario: { capacidad: 3, msPorToken: 20 * MIN },
  /**
   * Techo GLOBAL de recuperación. Dos restricciones independientes convergen en
   * 1 token/30 min, que es buena señal:
   *  · Presupuesto: ~48/día deja siempre ≥50/día libres para invitaciones.
   *  · UX del peor caso: 30 min es la espera máxima de alguien legítimo si un
   *    atacante drena la cubeta — el máximo tolerable.
   * Capacidad 15 = pico legítimo real (un grupo que arranca ciclo y varios
   * olvidaron su contraseña el mismo día) sin bloquear a nadie.
   *
   * OJO: esta cubeta introduce un DoS acotado (drenarla bloquea a terceros). Es
   * una mejora estricta igualmente: sin ella, el atacante quema los ~100 correos
   * del día y además tumba las INVITACIONES, que comparten presupuesto. La
   * solución de fondo para un endpoint anónimo sin IP es CAPTCHA/Turnstile.
   */
  recuperacionGlobal: { capacidad: 15, msPorToken: 30 * MIN },
  /** Reenvío de invitación a UNA cuenta. Absorbe el doble clic; la invitación
   *  dura 72 h, así que 2 reenvíos en 10 min a la misma cuenta ya es un error. */
  reenvioPerfil: { capacidad: 2, msPorToken: 10 * MIN },
  /**
   * Subida de imagen de reactivos (LUI-15 E3). Acota el VOLUMEN de OPERACIONES de subida por
   * usuario; el TAMAÑO lo corta el HTTP action `/reactivos/imagen` ANTES de almacenar, y el
   * sweeper acota la DURACIÓN de un huérfano. Se cobra en `reactivos.autorizarSubida`.
   * Ráfaga 40 = una sesión de autoría pesada + la suite E2E (~5 tokens/corrida, reiniciada
   * en el reset del seed); recarga 1/3 min (~20/hora) acota el abuso sostenido. Clave por
   * `userId`, como el resto.
   */
  subidaImagenUsuario: { capacidad: 40, msPorToken: 3 * MIN },
} satisfies Record<string, DefCuota>;

export type ResultadoCuota = { ok: true } | { ok: false; esperaMs: number };

/**
 * Consume 1 token de CADA cubeta pedida, **todo o nada**.
 *
 * Evalúa en orden y, si CUALQUIERA rechaza, retorna **sin escribir ninguna**.
 * Solo si todas pasan, escribe todas. Es atómico gratis: el read-modify-write
 * vive entero en la transacción de la mutation llamadora, y el OCC de Convex
 * reintenta ante conflicto.
 *
 * Por qué todo-o-nada: cobrar la cubeta del usuario y *luego* rechazar por la
 * global le quemaría un token a alguien legítimo **sin que saliera ningún
 * correo** — castigar al usuario real por un ataque ajeno, y violar el propio
 * principio de «cobrar donde se gasta el recurso».
 *
 * El ORDEN de `peticiones` importa y es parte del diseño: poniendo la cubeta
 * por-usuario ANTES que la global, un ataque repetido contra UNA cuenta se frena
 * en la primera y **ni siquiera llega a mirar la compartida**. Para drenar la
 * global hay que rotar entre destinatarios reales y activos distintos.
 *
 * NO escribe al rechazar, a propósito: la recarga es derivable de `recargadoEn`,
 * así que persistirla no aporta nada. A cambio, bajo ataque sostenido la fila
 * caliente (`recuperacion:global`) queda en SOLO LECTURA justo cuando más carga
 * hay → cero conflictos OCC; el limiter no se vuelve su propio cuello de botella.
 * Y deja el estado de la fila intacto como señal observable del bloqueo.
 */
export async function consumirCuotas(
  ctx: MutationCtx,
  peticiones: Array<{ clave: string; def: DefCuota }>,
): Promise<ResultadoCuota> {
  const ahora = Date.now();
  const evaluadas: Array<{
    clave: string;
    def: DefCuota;
    filaId: Id<"cuotas"> | null;
    disponibles: number;
  }> = [];

  // ── Fase 1: evaluar TODAS, sin escribir ninguna ──
  for (const { clave, def } of peticiones) {
    const fila = await ctx.db
      .query("cuotas")
      .withIndex("by_clave", (q) => q.eq("clave", clave))
      .unique();
    // Sin fila = cubeta llena. Con fila = tokens guardados + recarga proporcional.
    const disponibles =
      fila === null
        ? def.capacidad
        : Math.min(
            def.capacidad,
            fila.tokens + (ahora - fila.recargadoEn) / def.msPorToken,
          );
    if (disponibles < 1) {
      return {
        ok: false,
        esperaMs: Math.ceil((1 - disponibles) * def.msPorToken),
      };
    }
    evaluadas.push({ clave, def, filaId: fila?._id ?? null, disponibles });
  }

  // ── Fase 2: comprometer TODAS (solo se llega aquí si ninguna rechazó) ──
  for (const e of evaluadas) {
    const restantes = e.disponibles - 1;
    const expiraEn =
      ahora + Math.ceil((e.def.capacidad - restantes) * e.def.msPorToken);
    if (e.filaId === null) {
      await ctx.db.insert("cuotas", {
        clave: e.clave,
        tokens: restantes,
        recargadoEn: ahora,
        expiraEn,
      });
    } else {
      await ctx.db.patch(e.filaId, {
        tokens: restantes,
        recargadoEn: ahora,
        expiraEn,
      });
    }
  }
  return { ok: true };
}

/** «45 segundos» / «1 minuto» / «8 minutos» — para mensajes al usuario. */
export function textoEspera(ms: number): string {
  const seg = Math.ceil(ms / 1000);
  if (seg < 60) return `${seg} ${seg === 1 ? "segundo" : "segundos"}`;
  const min = Math.ceil(seg / 60);
  if (min < 60) return `${min} ${min === 1 ? "minuto" : "minutos"}`;
  const hrs = Math.ceil(min / 60);
  return `${hrs} ${hrs === 1 ? "hora" : "horas"}`;
}

// ── Higiene y operación (CLI-only, misma convención que bootstrap.ts) ─────────

/**
 * Borra cubetas ya recargadas al tope. Es HIGIENE, no un dique: como la clave es
 * el `userId`, la tabla se queda en decenas de filas. Borrar una fila vencida es
 * un no-op semántico (ausencia == llena), así que no hay carrera con el consumo.
 *
 * Acotado con `.take` para no rozar los límites de transacción; se reagenda solo
 * si llenó el lote, para que una purga grande drene en segundos y no en horas.
 */
export const limpiar = internalMutation({
  args: { lote: v.optional(v.number()) },
  handler: async (ctx, { lote = 200 }) => {
    const vencidas = await ctx.db
      .query("cuotas")
      .withIndex("by_expira", (q) => q.lt("expiraEn", Date.now()))
      .take(lote);
    for (const fila of vencidas) await ctx.db.delete(fila._id);
    if (vencidas.length === lote) {
      await ctx.scheduler.runAfter(0, internal.cuotas.limpiar, { lote });
    }
    return { borradas: vencidas.length };
  },
});

/** Estado de las cubetas vivas. Observabilidad de guardia: como el rechazo NO
 *  escribe, la fila queda con `tokens ≈ 0` durante todo el drenado y esto lo ve. */
export const inspeccionar = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ahora = Date.now();
    const filas = await ctx.db.query("cuotas").collect();
    return filas.map((f) => ({
      clave: f.clave,
      tokensGuardados: f.tokens,
      recargadoHaceMs: ahora - f.recargadoEn,
      llenaEnMs: f.expiraEn - ahora,
    }));
  },
});

/**
 * ESCOTILLA DE OPERACIÓN: borra una cubeta (= dejarla llena). Sirve para
 * desbloquear a alguien legítimo durante un ataque a `recuperacion:global`, y
 * para dejar estado limpio al verificar por CLI.
 *
 * Usa `.collect()` y borra TODAS las filas de esa clave, no `.unique()`: así
 * también limpia el estado duplicado que fabrica `insertarFilaPrueba` a
 * propósito (si usara `.unique()`, la herramienta de limpieza tronaría con el
 * desastre que la prueba G2 crea adrede).
 */
export const restablecer = internalMutation({
  args: { clave: v.string() },
  handler: async (ctx, { clave }) => {
    const filas = await ctx.db
      .query("cuotas")
      .withIndex("by_clave", (q) => q.eq("clave", clave))
      .collect();
    for (const fila of filas) await ctx.db.delete(fila._id);
    return { borradas: filas.length };
  },
});

/**
 * SOLO VERIFICACIÓN: coloca una cubeta en un estado arbitrario (upsert). Permite
 * probar el rechazo y la recarga sin esperar 30 minutos reales ni fabricar 15
 * usuarios. `internalMutation` ⇒ inalcanzable desde el cliente.
 *
 * `expiraEn` por defecto se pone lejos (24 h) para que el cron no reape la fila a
 * media prueba. No afecta la aritmética del bucket: los tokens disponibles se
 * derivan de `tokens` + `recargadoEn`; `expiraEn` solo lo usa `limpiar`.
 *
 * `expiraHaceMs` fuerza una fila YA VENCIDA (`expiraEn` en el pasado). Es lo único
 * que permite probar el cron `limpiar` sin esperar a que una cubeta real se
 * recargue al tope — que en la práctica serían 30 minutos.
 */
export const fijar = internalMutation({
  args: {
    clave: v.string(),
    tokens: v.number(),
    recargadoHaceMs: v.optional(v.number()),
    expiraHaceMs: v.optional(v.number()),
  },
  handler: async (ctx, { clave, tokens, recargadoHaceMs = 0, expiraHaceMs }) => {
    const ahora = Date.now();
    const recargadoEn = ahora - recargadoHaceMs;
    const expiraEn =
      expiraHaceMs !== undefined ? ahora - expiraHaceMs : ahora + 24 * 60 * MIN;
    const campos = { tokens, recargadoEn, expiraEn };
    const fila = await ctx.db
      .query("cuotas")
      .withIndex("by_clave", (q) => q.eq("clave", clave))
      .first();
    if (fila) await ctx.db.patch(fila._id, campos);
    else await ctx.db.insert("cuotas", { clave, ...campos });
    return { ok: true as const };
  },
});

/**
 * SOLO PRUEBAS (prueba G2 del plan). Inserta una fila CRUDA sin upsert — es la
 * única forma de fabricar una clave duplicada y hacer que el `.unique()` de
 * `consumirCuotas` truene, para comprobar que un error interno de la rama real
 * de `solicitarRecuperacion` NO se filtra al cliente (sería un oráculo de
 * enumeración) y solo aparece en los logs.
 *
 * Exige `confirmar: "SOLO_PRUEBAS"` para que un tecleo accidental en el CLI no
 * baste para invocarla. No hay escalada de privilegios: es `internalMutation`, y
 * quien tiene acceso de admin al CLI ya puede escribir la BD entera de todos
 * modos; su único poder es insertar una fila de rate limiting.
 *
 * LIMPIEZA: `npx convex run cuotas:restablecer '{"clave":"<la misma>"}'`.
 */
export const insertarFilaPrueba = internalMutation({
  args: {
    clave: v.string(),
    tokens: v.optional(v.number()),
    confirmar: v.string(),
  },
  handler: async (ctx, { clave, tokens = 0, confirmar }) => {
    if (confirmar !== "SOLO_PRUEBAS") {
      throw new Error(
        'insertarFilaPrueba es una utilidad de PRUEBAS: pasa confirmar:"SOLO_PRUEBAS" para invocarla.',
      );
    }
    const ahora = Date.now();
    const id = await ctx.db.insert("cuotas", {
      clave,
      tokens,
      recargadoEn: ahora,
      expiraEn: ahora + 24 * 60 * MIN,
    });
    return { id };
  },
});
