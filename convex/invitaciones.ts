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
import { consumirCuotas, CUOTAS, textoEspera } from "./cuotas";
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

/**
 * URL absoluta y pública del logo de los correos (Entrega 2).
 *
 * **Desacoplada de `SITE_URL` a propósito.** Derivarla del origen de la app la
 * volvía `localhost:3000` en dev, y ningún cliente de correo puede cargar eso →
 * era imposible verificar que el logo carga sin desplegar a producción.
 *
 * A diferencia de `origenApp()`, esto **NO lanza**: un logo mal configurado es
 * cosmético y no debe impedir que alguien reciba su acceso. Ausencia o URL
 * inválida → `undefined` → las plantillas caen al wordmark de texto, que es un
 * diseño válido y ya aprobado. `esc()` evita la inyección de HTML, pero no evita
 * una URL rota: por eso esta validación va aparte.
 */
function logoCorreo(): string | undefined {
  const raw = process.env.CORREO_LOGO_URL;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn(
      `[correo] CORREO_LOGO_URL no es una URL válida: ${raw}. Se usa el wordmark de texto.`,
    );
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    console.warn(
      `[correo] CORREO_LOGO_URL debe usar http(s): ${raw}. Se usa el wordmark de texto.`,
    );
    return undefined;
  }
  return url.href;
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
  const logoUrl = logoCorreo();
  const correo = esInv
    ? correoInvitacion({ nombre: info.nombre, enlace, logoUrl })
    : correoRecuperacion({ nombre: info.nombre, enlace, logoUrl });
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

// ── Reenvío de invitación (admin) ────────────────────────────────────────────

/**
 * Authz + validaciones + cuota del reenvío, **atómico en UNA sola mutation**. La
 * llama la action `reenviar` vía `ctx.runMutation`: Convex propaga la identidad
 * autenticada de la action a la mutation, así que `requireAdmin` funciona aquí.
 */
export const autorizarReenvio = internalMutation({
  args: { perfilId: v.id("perfiles") },
  handler: async (ctx, { perfilId }): Promise<{ userId: Id<"users"> }> => {
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
    // La cuota va AL FINAL: los rechazos de arriba no envían correo, así que no
    // deben gastar tokens (mismo principio que en `solicitarRecuperacion`).
    const cuota = await consumirCuotas(ctx, [
      { clave: `reenvio:perfil:${perfilId}`, def: CUOTAS.reenvioPerfil },
    ]);
    if (!cuota.ok) {
      // Aquí SÍ se es explícito: la llamada está autenticada como admin, que ya ve
      // esa cuenta en su tabla — no hay nada que ocultar, y un error mudo solo
      // lograría que hiciera clic diez veces.
      // ConvexError de TEXTO PLANO: los clientes hacen `String(e.data)`; la forma
      // {code, message} pintaría "[object Object]" al usuario.
      throw new ConvexError(
        `Ya se reenviaron varias invitaciones a esta cuenta. Intenta de nuevo en ${textoEspera(cuota.esperaMs)}.`,
      );
    }
    return { userId: perfil.userId };
  },
});

/**
 * Reenvía la invitación de una cuenta de staff/alumno que aún NO activó su acceso.
 *
 * **Es una action SÍNCRONA a propósito**, no una mutation que agenda: la *única
 * razón de existir* de este botón es que salga el correo, así que si el proveedor
 * falla no hay nada que reportar como éxito — el admin ve el error real.
 *
 * Contrasta con `alumnos.crear` / `usuarios.crear`, que **siguen siendo
 * asíncronos y así debe ser**: ahí la cuenta tiene que crearse aunque el correo
 * falle (el listado la marca con `accesoPendiente` y el admin puede reenviar).
 * Bloquear un alta por un fallo de correo sería peor que el problema.
 */
export const reenviar = action({
  args: { perfilId: v.id("perfiles") },
  handler: async (ctx, { perfilId }): Promise<{ ok: true }> => {
    const { userId } = await ctx.runMutation(
      internal.invitaciones.autorizarReenvio,
      { perfilId },
    );
    await emitirYEnviar(ctx, userId, "invitacion");
    return { ok: true as const };
  },
});

// ── Recuperación de contraseña (pública, anónima) ────────────────────────────

/**
 * "¿Olvidaste tu contraseña?": si hay EXACTAMENTE 1 usuario activo con ese correo,
 * agenda el correo de recuperación.
 *
 * **NUNCA LANZA, ni siquiera por un error interno.** No es paranoia: los fallos de
 * esta función solo pueden ocurrir en la rama de los correos que SÍ existen, así
 * que propagarlos sería un oráculo de enumeración perfecto. Y el `try{}catch{}`
 * del formulario no protege nada — oculta el error en la UI, pero el `ConvexError`
 * viaja por el cable y se lee en la pestaña Network. El grito va a los LOGS.
 *
 * Alcance de la garantía: aplica de la validación de argumentos de Convex hacia
 * adentro. Una llamada con tipo inválido falla en el `v.string()` antes de entrar
 * aquí, y eso NO es un oráculo: ese rechazo depende solo del tipo del argumento y
 * es idéntico exista o no el correo.
 *
 * Contrapartida asumida: esto también enmudece bugs reales, y por eso el
 * `console.error` de abajo no es opcional — es el único canal que queda.
 */
export const solicitarRecuperacion = mutation({
  args: { correo: v.string() },
  handler: async (ctx, { correo }) => {
    try {
      const email = normalizarCorreo(correo);
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .take(2);
      if (users.length === 1) {
        const userId = users[0]._id;
        const perfil = await ctx.db
          .query("perfiles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first();
        if (perfil && perfil.activo) {
          // La cuota se cobra SOLO aquí, donde de verdad se gasta el recurso: un
          // correo inexistente no produce envío, así que no hay nada que limitar.
          // Efecto: quien inventa direcciones ni consume cuota ni crea filas, y la
          // clave puede ser el userId (nunca se almacena un correo).
          //
          // ORDEN: usuario ANTES que global. Todo-o-nada: si la global rechaza, la
          // cubeta del usuario NO se toca — no se castiga a alguien legítimo por
          // un ataque ajeno.
          const cuota = await consumirCuotas(ctx, [
            {
              clave: `recuperacion:usuario:${userId}`,
              def: CUOTAS.recuperacionUsuario,
            },
            { clave: "recuperacion:global", def: CUOTAS.recuperacionGlobal },
          ]);
          if (!cuota.ok) {
            console.warn(
              `[cuota] recuperacion agotada para ${userId}; no se envía. Libre en ${textoEspera(cuota.esperaMs)}.`,
            );
          } else {
            await ctx.scheduler.runAfter(
              0,
              internal.invitaciones.enviarRecuperacion,
              { userId },
            );
          }
        }
      }
    } catch (e) {
      // No se registra el correo recibido: es entrada controlada por quien llama y
      // acabaría inyectando líneas falsas en la bitácora.
      console.error(
        `[recuperacion:error] Fallo interno al procesar una solicitud de recuperación: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    // Respuesta uniforme SIEMPRE: indistinguible entre correo inexistente, envío
    // real, cuota agotada y error interno.
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
      logoUrl: logoCorreo(),
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
