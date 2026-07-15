import { internalAction } from "./_generated/server";
import { v } from "convex/values";

/**
 * Costura de transporte de correo (LUI-103).
 *
 * **Entrega 1 (esta): transporte DEV.** NO envía correo real; registra en los
 * logs de Convex lo mínimo para probar el flujo en local — destinatario, asunto
 * y el **enlace completo** (que es el contenido del correo). NUNCA se registra el
 * token suelto ni su hash: el enlace ya lo lleva y es de un solo uso.
 *
 * **Entrega 2:** reemplazar SOLO el cuerpo de este handler por el proveedor real
 * (Resend/SES) usando el `html`/`texto` ya construidos. La firma no cambia.
 * Pendiente para Entrega 2: rate limiting de las solicitudes que disparan correos.
 */
export const enviar = internalAction({
  args: {
    para: v.string(),
    asunto: v.string(),
    html: v.string(),
    texto: v.string(),
    // El enlace se pasa aparte solo para dejarlo visible en el log dev.
    enlace: v.optional(v.string()),
  },
  handler: async (_ctx, { para, asunto, texto, enlace }) => {
    console.log(
      `[correo:dev] Para: ${para} · Asunto: ${asunto}` +
        (enlace ? `\n[correo:dev] Enlace: ${enlace}` : ""),
    );
    console.log(`[correo:dev:texto]\n${texto}`);
    // Entrega 2: aquí iría `await resend.emails.send({ to: para, subject: asunto, html })`.
  },
});
