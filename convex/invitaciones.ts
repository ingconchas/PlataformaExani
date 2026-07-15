import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { type Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import {
  createAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { requireAdmin } from "./authz";
import { validarContrasena } from "./politica";
import { ORIGEN_CONFIABLE } from "./auth";
import { credencialExiste, normalizarCorreo } from "./credenciales";
import {
  correoInvitacion,
  correoRecuperacion,
  correoConfirmacion,
} from "./plantillas";

/**
 * Invitación y recuperación de acceso (LUI-103, Entrega 1).
 *
 * Separación obligada action/mutation: la authz y la escritura ATÓMICA de tokens
 * van en mutations (`ctx.db`); el crypto (token/hash) y las APIs de credenciales
 * de Convex Auth (`createAccount`/`modifyAccountCredentials`) van en actions.
 *
 * Token: aleatorio Web Crypto (32 bytes, base64url) en la URL; en BD SOLO el
 * hash SHA-256. Un solo uso (lo marca EXCLUSIVAMENTE `consumirToken`). Vigencias:
 * invitación 72 h, recuperación 60 min.
 */

const INVITACION_MS = 72 * 60 * 60 * 1000;
const RECUPERACION_MS = 60 * 60 * 1000;

const tipoValidator = v.union(
  v.literal("invitacion"),
  v.literal("recuperacion"),
);

// ── Helpers de crypto / URL (solo en actions) ────────────────────────────────

/** Token aleatorio fuerte (32 bytes) en base64url. Nunca Math.random. */
function generarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Origen absoluto de la app para armar enlaces. Lanza si `SITE_URL` falta, no
 *  parsea, no es http(s), o no tiene un origen web válido — así nunca se generan
 *  enlaces parciales/`null/...`. Se valida ANTES de persistir/inutilizar tokens. */
function origenApp(): string {
  const raw = process.env.SITE_URL;
  if (!raw) {
    throw new Error(
      "SITE_URL no está definido en el deployment; no se pueden generar enlaces de correo.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL no es una URL válida: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SITE_URL debe usar http(s): ${raw}`);
  }
  if (url.origin === "null" || !url.origin) {
    throw new Error(`SITE_URL no tiene un origen web válido: ${raw}`);
  }
  return url.origin;
}

function fechaHoraMx(ts: number): string {
  const fecha = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ts));
  const hora = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
  return `${fecha} a las ${hora} h (hora del centro de México)`;
}

// ── Internal queries/mutations (acceso a BD) ─────────────────────────────────

/** Para actions: ¿la cuenta ya tiene credencial? (envuelve el helper compartido). */
export const tieneCredencialPassword = internalQuery({
  args: { correo: v.string() },
  handler: async (ctx, { correo }) => credencialExiste(ctx, correo),
});

/** Datos del destinatario para armar el correo. `null` si no hay perfil. */
export const datosDestinatario = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!perfil) return null;
    const user = await ctx.db.get(userId);
    return {
      email: user?.email ?? "",
      nombre: perfil.nombre,
      activo: perfil.activo,
    };
  },
});

/** Persiste un token nuevo e INVALIDA (borra) los previos NO usados del mismo
 *  usuario+tipo (reduce enlaces activos simultáneos; sugerencia de auditoría). */
export const guardarToken = internalMutation({
  args: {
    userId: v.id("users"),
    tipo: tipoValidator,
    tokenHash: v.string(),
    expiraEn: v.number(),
  },
  handler: async (ctx, args) => {
    const previos = await ctx.db
      .query("tokensAcceso")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const t of previos) {
      if (t.tipo === args.tipo && t.usadoEn === undefined) {
        await ctx.db.delete(t._id);
      }
    }
    await ctx.db.insert("tokensAcceso", {
      userId: args.userId,
      tipo: args.tipo,
      tokenHash: args.tokenHash,
      expiraEn: args.expiraEn,
    });
  },
});

/** Estado de un token (para pintar la pantalla). Revalida perfil existe+activo. */
export const estadoToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db
      .query("tokensAcceso")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row) return { estado: "invalido" as const };
    if (row.usadoEn !== undefined) return { estado: "usado" as const };
    if (row.expiraEn < Date.now()) return { estado: "expirado" as const };
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .first();
    if (!perfil || !perfil.activo) return { estado: "invalido" as const };
    return { estado: "valido" as const, nombre: perfil.nombre, tipo: row.tipo };
  },
});

/**
 * ÚNICA ruta que marca `usadoEn`. Atómico: verifica hash/expiración/no-usado/
 * tipo/perfil-activo y marca el uso en la MISMA transacción, antes de cualquier
 * side effect. También marca el correo verificado (el token prueba propiedad).
 * Dos submits concurrentes → solo uno consume.
 */
export const consumirToken = internalMutation({
  args: { tokenHash: v.string(), tipo: tipoValidator },
  handler: async (ctx, { tokenHash, tipo }) => {
    const row = await ctx.db
      .query("tokensAcceso")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row || row.tipo !== tipo) {
      throw new ConvexError({
        code: "TOKEN_INVALIDO",
        message: "El enlace no es válido.",
      });
    }
    if (row.usadoEn !== undefined) {
      throw new ConvexError({
        code: "TOKEN_USADO",
        message: "Este enlace ya se usó. Solicita uno nuevo.",
      });
    }
    if (row.expiraEn < Date.now()) {
      throw new ConvexError({
        code: "TOKEN_EXPIRADO",
        message: "El enlace expiró. Solicita uno nuevo.",
      });
    }
    const perfil = await ctx.db
      .query("perfiles")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .first();
    if (!perfil || !perfil.activo) {
      throw new ConvexError({
        code: "CUENTA_INACTIVA",
        message: "La cuenta no está disponible.",
      });
    }
    const user = await ctx.db.get(row.userId);
    if (!user?.email) {
      throw new ConvexError({
        code: "TOKEN_INVALIDO",
        message: "El enlace no es válido.",
      });
    }
    await ctx.db.patch(row._id, { usadoEn: Date.now() });
    if (user.emailVerificationTime === undefined) {
      await ctx.db.patch(row.userId, { emailVerificationTime: Date.now() });
    }
    return { userId: row.userId, email: user.email, nombre: perfil.nombre };
  },
});

// ── Internal actions: emitir tokens + enviar correos ─────────────────────────

async function emitirYEnviar(
  ctx: ActionCtx,
  userId: Id<"users">,
  tipo: "invitacion" | "recuperacion",
): Promise<void> {
  const info = await ctx.runQuery(internal.invitaciones.datosDestinatario, {
    userId,
  });
  if (!info || !info.activo || !info.email) return; // sin perfil/ inactivo → no enviar
  // Valida SITE_URL ANTES de generar/persistir el token: una mala config no debe
  // invalidar tokens previos ni dejar el flujo sin enlace útil.
  const origen = origenApp();
  const token = generarToken();
  const tokenHash = await hashToken(token);
  const esInv = tipo === "invitacion";
  const expiraEn = Date.now() + (esInv ? INVITACION_MS : RECUPERACION_MS);
  await ctx.runMutation(internal.invitaciones.guardarToken, {
    userId,
    tipo,
    tokenHash,
    expiraEn,
  });
  const ruta = esInv ? "crear-contrasena" : "restablecer";
  const enlace = `${origen}/${ruta}?token=${token}`;
  const correo = esInv
    ? correoInvitacion({ nombre: info.nombre, enlace })
    : correoRecuperacion({ nombre: info.nombre, enlace });
  await ctx.runAction(internal.correo.enviar, {
    para: info.email,
    asunto: correo.asunto,
    html: correo.html,
    texto: correo.texto,
    enlace,
  });
}

export const enviarInvitacion = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await emitirYEnviar(ctx, userId, "invitacion");
  },
});

export const enviarRecuperacion = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await emitirYEnviar(ctx, userId, "recuperacion");
  },
});

// ── Mutations públicas (disparan correos) ────────────────────────────────────

/** Reenvía la invitación de una cuenta de staff/alumno. Solo si aún NO tiene
 *  credencial (accesoPendiente). Rate limiting: deuda de Entrega 2. */
export const reenviar = mutation({
  args: { perfilId: v.id("perfiles") },
  handler: async (ctx, { perfilId }) => {
    await requireAdmin(ctx);
    const perfil = await ctx.db.get(perfilId);
    if (!perfil) throw new ConvexError("Cuenta no encontrada.");
    const user = await ctx.db.get(perfil.userId);
    if (!user?.email) throw new ConvexError("La cuenta no tiene correo.");
    if (await credencialExiste(ctx, user.email)) {
      throw new ConvexError(
        "Esta cuenta ya activó su acceso; no requiere invitación.",
      );
    }
    await ctx.scheduler.runAfter(0, internal.invitaciones.enviarInvitacion, {
      userId: perfil.userId,
    });
    return { ok: true as const };
  },
});

/** "¿Olvidaste tu contraseña?": si hay EXACTAMENTE 1 usuario activo con ese
 *  correo, agenda el correo de recuperación. Responde IGUAL en todos los casos
 *  (no revela existencia/estado del correo). Rate limiting: deuda de Entrega 2. */
export const solicitarRecuperacion = mutation({
  args: { correo: v.string() },
  handler: async (ctx, { correo }) => {
    const email = normalizarCorreo(correo);
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(2);
    if (users.length === 1) {
      const perfil = await ctx.db
        .query("perfiles")
        .withIndex("by_user", (q) => q.eq("userId", users[0]._id))
        .first();
      if (perfil && perfil.activo) {
        await ctx.scheduler.runAfter(
          0,
          internal.invitaciones.enviarRecuperacion,
          { userId: users[0]._id },
        );
      }
    }
    return { ok: true as const };
  },
});

// ── Actions públicas: validar/fijar contraseña ───────────────────────────────

export const validarToken = action({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<{
    estado: "valido" | "usado" | "expirado" | "invalido";
    nombre?: string;
    tipo?: "invitacion" | "recuperacion";
  }> => {
    const tokenHash = await hashToken(token);
    return await ctx.runQuery(internal.invitaciones.estadoToken, { tokenHash });
  },
});

/** Fija la contraseña. Tres casos: invitación con cuenta ya activada → rechaza;
 *  sin credencial → createAccount (engancha por ORIGEN_CONFIABLE); con credencial
 *  → modifyAccountCredentials. */
async function fijarContrasena(
  ctx: ActionCtx,
  email: string,
  password: string,
  esInvitacion: boolean,
): Promise<void> {
  const tiene: boolean = await ctx.runQuery(
    internal.invitaciones.tieneCredencialPassword,
    { correo: email },
  );
  if (esInvitacion && tiene) {
    throw new ConvexError({
      code: "YA_ACTIVADA",
      message: "Ya activaste tu cuenta. Inicia sesión con tu contraseña.",
    });
  }
  if (tiene) {
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: password },
    });
  } else {
    await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: password },
      // `origen` viaja en runtime (lo lee createOrUpdateUser); el tipo de profile
      // solo admite campos de `users`, por eso el cast.
      profile: { email, origen: ORIGEN_CONFIABLE } as { email: string },
      shouldLinkViaEmail: true,
    });
  }
}

export const establecerContrasenaInvitacion = action({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, { token, password }): Promise<{ email: string }> => {
    validarContrasena(password);
    const tokenHash = await hashToken(token);
    const { email } = await ctx.runMutation(
      internal.invitaciones.consumirToken,
      { tokenHash, tipo: "invitacion" },
    );
    await fijarContrasena(ctx, email, password, true);
    return { email };
  },
});

export const restablecerContrasena = action({
  args: { token: v.string(), password: v.string() },
  handler: async (ctx, { token, password }): Promise<{ email: string }> => {
    validarContrasena(password);
    const tokenHash = await hashToken(token);
    const { userId, email, nombre } = await ctx.runMutation(
      internal.invitaciones.consumirToken,
      { tokenHash, tipo: "recuperacion" },
    );
    await fijarContrasena(ctx, email, password, false);
    await invalidateSessions(ctx, { userId });
    // Correo 3: confirmación de cambio.
    const correo = correoConfirmacion({
      nombre,
      fechaHora: fechaHoraMx(Date.now()),
      enlace: `${origenApp()}/login`,
    });
    await ctx.runAction(internal.correo.enviar, {
      para: email,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
    });
    return { email };
  },
});
