import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Transporte de correo (LUI-103, Entrega 2 — Resend).
 *
 * **El transporte se elige con una variable EXPLÍCITA, nunca por la presencia de
 * la API key.** La razón es concreta: `RESEND_API_KEY` también está en el
 * deployment de dev, y el seed de dev usa direcciones ficticias `@demo.unx.mx`
 * (dominio inexistente). Si dev enviara de verdad, serían rebotes duros contra un
 * dominio que no existe → daño a la reputación de envío desde el primer día, que
 * es caro y lento de revertir.
 *
 * | CORREO_TRANSPORTE | Efecto                                        |
 * |-------------------|-----------------------------------------------|
 * | ausente / vacía   | `dev` (default seguro)                        |
 * | `dev`             | log — valor explícitamente válido             |
 * | `resend`          | envío real (solo prod)                        |
 * | cualquier otro    | LANZA — un typo no puede degradar en silencio |
 *
 * `dev` es un valor aceptado a propósito: el rollback documentado en `DEPLOY.md`
 * es «poner la variable en dev», y también sirve borrarla. Ambas rutas funcionan,
 * para que no haya trampa según cuál elija quien esté apagando un incendio.
 *
 * **Higiene:** en modo `resend` no se registra el enlace, ni el HTML, ni el texto,
 * ni la llave — el enlace de un correo es una credencial viva. En modo `dev` sí se
 * registra el enlace: es justamente cómo se prueba el flujo sin enviar nada.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const INTENTOS_MAX = 3;
const ESPERAS_MS = [500, 1500]; // backoff entre intentos (INTENTOS_MAX - 1)
const TIMEOUT_MS = 10_000;

type Transporte = "dev" | "resend";

/** Lee y valida `CORREO_TRANSPORTE`. Lanza ante un valor desconocido: fallar
 *  ruidoso es preferible a mandar enlaces vivos a los logs creyendo que se
 *  enviaron correos. */
function transporteConfigurado(): Transporte {
  const raw = (process.env.CORREO_TRANSPORTE ?? "").trim();
  if (raw === "") return "dev";
  if (raw === "dev" || raw === "resend") return raw;
  throw new Error(
    `CORREO_TRANSPORTE tiene un valor desconocido: "${raw}". Válidos: "dev" o "resend" (o sin definir = dev).`,
  );
}

/** Error del proveedor que NO tiene sentido reintentar. */
class ErrorPermanente extends Error {}

/**
 * ¿Vale la pena reintentar?
 *
 * Resend usa **429 para dos cosas distintas**: `rate_limit_exceeded` (transitorio,
 * son demasiadas peticiones por segundo) y `daily_quota_exceeded` /
 * `monthly_quota_exceeded` (permanente: se acabó el plan). Reintentar el segundo
 * solo quema más cuota sin ninguna posibilidad de éxito.
 *
 * Un 429 con `name` desconocido se trata como PERMANENTE a propósito: ante la
 * duda, fallar seguro en vez de martillar al proveedor.
 */
function esTransitorio(status: number, name: string | undefined): boolean {
  if (status >= 500) return true;
  if (status === 429) return name === "rate_limit_exceeded";
  return false;
}

/** Envío real. Devuelve el `id` de Resend. Lanza si no se logró enviar. */
async function enviarPorResend(args: {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  claveIdempotencia?: string;
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.CORREO_REMITENTE;
  // Config incompleta ⇒ lanza. Nunca degradar en silencio a log: el admin creería
  // que la invitación salió.
  if (!apiKey) {
    throw new Error(
      "CORREO_TRANSPORTE=resend pero falta RESEND_API_KEY en el deployment.",
    );
  }
  if (!remitente) {
    throw new Error(
      "CORREO_TRANSPORTE=resend pero falta CORREO_REMITENTE en el deployment.",
    );
  }

  // Idempotency-Key: se genera UNA VEZ, antes del bucle, y viaja igual en todos
  // los intentos. Sin esto, un fallo de red DESPUÉS de que Resend aceptó el envío
  // haría que el reintento mandara un segundo correo → dos enlaces vivos para la
  // misma cuenta. `claveIdempotencia` es la costura que vuelve reproducible la
  // prueba de idempotencia (ver el docstring de `enviar`).
  const claveIdem = args.claveIdempotencia ?? crypto.randomUUID();

  let ultimoError = "desconocido";
  for (let intento = 1; intento <= INTENTOS_MAX; intento++) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": claveIdem,
        },
        body: JSON.stringify({
          from: remitente,
          to: args.para,
          subject: args.asunto,
          html: args.html,
          text: args.texto, // versión de texto plano: mejora entregabilidad
        }),
        signal: control.signal,
      });
      const cuerpo: unknown = await res.json().catch(() => ({}));
      if (res.ok) {
        return (cuerpo as { id?: string }).id ?? "";
      }
      const err = cuerpo as { name?: string; message?: string };
      const detalle =
        `${res.status} ${err.name ?? "sin_nombre"}: ${err.message ?? ""}`.trim();
      if (!esTransitorio(res.status, err.name)) {
        throw new ErrorPermanente(`Resend rechazó el envío — ${detalle}`);
      }
      ultimoError = detalle;
    } catch (e) {
      if (e instanceof ErrorPermanente) throw e;
      ultimoError =
        e instanceof Error
          ? e.name === "AbortError"
            ? `timeout tras ${TIMEOUT_MS} ms`
            : e.message
          : String(e);
    } finally {
      clearTimeout(temporizador);
    }
    if (intento < INTENTOS_MAX) {
      await new Promise((r) => setTimeout(r, ESPERAS_MS[intento - 1]));
    }
  }
  throw new Error(
    `Resend no aceptó el envío tras ${INTENTOS_MAX} intentos — último error: ${ultimoError}`,
  );
}

/**
 * Envía un correo ya compuesto (`plantillas.ts` produce `{asunto, html, texto}`).
 *
 * `claveIdempotencia` es una **costura de prueba**: si no viene, se genera un UUID.
 * Existe porque el UUID nace dentro del handler y, sin poder fijarlo, la prueba de
 * idempotencia no sería reproducible. Es segura porque `enviar` es
 * `internalAction`: inalcanzable desde el cliente, así que solo el CLI o un
 * llamador interno pueden pasarla.
 *
 * Registra el desenlace en `enviosCorreo` en **todos** los caminos —éxito, config
 * faltante, timeout, 4xx/5xx y transporte desconocido— **antes de re-lanzar**. Sin
 * eso, los caminos asíncronos (`alumnos.crear` / `usuarios.crear` agendan el envío
 * y ya respondieron al admin) podrían fallar sin dejar ningún rastro.
 */
export const enviar = internalAction({
  args: {
    para: v.string(),
    asunto: v.string(),
    html: v.string(),
    texto: v.string(),
    // El enlace se pasa aparte solo para dejarlo visible en el log del modo dev.
    enlace: v.optional(v.string()),
    claveIdempotencia: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { para, asunto, html, texto, enlace, claveIdempotencia },
  ): Promise<{ id: string | null }> => {
    try {
      const transporte = transporteConfigurado();

      if (transporte === "dev") {
        console.warn(
          `[correo:dev] TRANSPORTE DEV — NO se envió correo real. Para: ${para} · Asunto: ${asunto}` +
            (enlace ? `\n[correo:dev] Enlace: ${enlace}` : ""),
        );
        console.log(`[correo:dev:texto]\n${texto}`);
        await ctx.runMutation(internal.correo.registrar, {
          para,
          asunto,
          estado: "dev",
        });
        return { id: null };
      }

      const id = await enviarPorResend({
        para,
        asunto,
        html,
        texto,
        claveIdempotencia,
      });
      // Sin enlace, sin cuerpo, sin llave.
      console.log(
        `[correo:resend] Enviado. Para: ${para} · Asunto: ${asunto} · id: ${id}`,
      );
      await ctx.runMutation(internal.correo.registrar, {
        para,
        asunto,
        estado: "enviado",
        resendId: id,
      });
      return { id };
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      console.error(
        `[correo:error] NO se envió. Para: ${para} · Asunto: ${asunto} · ${detalle}`,
      );
      await ctx.runMutation(internal.correo.registrar, {
        para,
        asunto,
        estado: "fallido",
        error: detalle.slice(0, 500),
      });
      throw e;
    }
  },
});

// ── Bitácora de envíos ───────────────────────────────────────────────────────

/** Registra el desenlace de un envío. Nunca recibe enlace, cuerpo ni llave. */
export const registrar = internalMutation({
  args: {
    para: v.string(),
    asunto: v.string(),
    estado: v.union(
      v.literal("enviado"),
      v.literal("fallido"),
      v.literal("dev"),
    ),
    resendId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("enviosCorreo", { ...args, creadoEn: Date.now() });
  },
});

/** Retención de la bitácora (objetivo del cron diario). Acotado con `.take` y
 *  auto-reagendado, igual que `cuotas:limpiar`. */
export const purgarRegistro = internalMutation({
  args: { lote: v.optional(v.number()), diasRetencion: v.optional(v.number()) },
  handler: async (ctx, { lote = 200, diasRetencion = 90 }) => {
    const corte = Date.now() - diasRetencion * 24 * 60 * 60 * 1000;
    const viejos = await ctx.db
      .query("enviosCorreo")
      .withIndex("by_creado", (q) => q.lt("creadoEn", corte))
      .take(lote);
    for (const fila of viejos) await ctx.db.delete(fila._id);
    if (viejos.length === lote) {
      await ctx.scheduler.runAfter(0, internal.correo.purgarRegistro, {
        lote,
        diasRetencion,
      });
    }
    return { borrados: viejos.length };
  },
});
