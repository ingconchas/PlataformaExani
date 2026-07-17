import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { auth } from "./auth";
import { TIPOS_PERMITIDOS, MAX_BYTES } from "./imagenes";

const http = httpRouter();

auth.addHttpRoutes(http);

// CORS: el navegador (app en `.up.railway.app`/localhost) llama este endpoint en el
// dominio `.convex.site`. La autorización es por Bearer token (no cookies), así que
// `Allow-Origin: *` es seguro: una página atacante no posee el token del usuario.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/**
 * Subida de imagen de reactivos (LUI-15 E3). Se hace por HTTP action —NO por
 * `generateUploadUrl`— para poder **VALIDAR tamaño/tipo ANTES de `storage.store`**: la URL
 * de subida de Convex no tiene tope de tamaño propio, así que sin esto un cliente
 * manipulado persistiría blobs enormes (la cuota limita OPERACIONES, no bytes). El blob se
 * almacena SOLO si el tamaño real cumple → jamás se persiste un blob sobredimensionado. La
 * autorización (staff) + cuota se cobran en `internal.reactivos.autorizarSubida`; cuota y
 * sweeper son capas adicionales, no la barrera de tamaño.
 */
const subirImagenReactivo = httpAction(async (ctx, request) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) return json({ error: "Inicia sesión." }, 401);

  const tipo = request.headers.get("content-type") ?? "";
  if (!TIPOS_PERMITIDOS.has(tipo))
    return json({ error: "Formato no permitido: usa PNG, JPG, WEBP o GIF." }, 415);
  // Rechazo TEMPRANO por Content-Length (antes de leer el cuerpo).
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (declarado > MAX_BYTES)
    return json({ error: "La imagen supera el límite de 5 MB." }, 413);

  // Leer el cuerpo y RE-verificar el tamaño real (defensa ante un Content-Length mentido):
  // `store` solo se llama si cumple → nunca se persiste un blob > 5 MB.
  const blob = await request.blob();
  if (blob.size > MAX_BYTES)
    return json({ error: "La imagen supera el límite de 5 MB." }, 413);

  // Autorización (staff) + cuota por usuario, justo antes de almacenar.
  try {
    await ctx.runMutation(internal.reactivos.autorizarSubida, { userId });
  } catch (e) {
    return json(
      { error: e instanceof ConvexError ? String(e.data) : "No autorizado." },
      429,
    );
  }

  const storageId = await ctx.storage.store(blob);
  return json({ storageId }, 200);
});

http.route({
  path: "/reactivos/imagen",
  method: "POST",
  handler: subirImagenReactivo,
});
// Preflight CORS del POST con Authorization + Content-Type.
http.route({
  path: "/reactivos/imagen",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS }),
  ),
});

export default http;
