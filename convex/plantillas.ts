/**
 * Plantillas de los 3 correos transaccionales de cuenta (LUI-103), como HTML
 * **email-safe**: tablas, estilos en línea, colores hex literales, sin `var()`
 * ni flex. Copy tomado del diseño `screens/04-correos-transaccionales.html`.
 *
 * **Encabezado (Entrega 2):** si llega `logoUrl` se usa el logo hospedado; si no,
 * el wordmark de texto de la Entrega 1. La degradación es a propósito y va en dos
 * niveles: sin configuración no hay imagen rota, y con configuración el `alt` va
 * estilizado para que —si el cliente bloquea imágenes, como hacen Gmail y Outlook
 * con remitentes desconocidos— se lea igual «UNX Simuladores» en blanco sobre azul
 * en vez de un icono roto.
 */

const AZUL = "#0228C9";
const AMARILLO = "#FFBF54";
const VERDE = "#0B9944";
const VERDE_TINT = "#E7F5EC";
const INK = "#1F2937";
const TEXTO = "#374151";
const MUTED = "#6B7280";
const PIE = "#9CA3AF";
const BORDE = "#E5E7EB";
const FONDO = "#F3F4F6";
const FUENTE =
  "Barlow, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export type Correo = { asunto: string; html: string; texto: string };

/** Escapa texto para interpolarlo con seguridad en HTML/atributos (evita
 *  inyección de HTML en correos: un nombre con `<...>` no puede alterar el
 *  correo ni inyectar enlaces). Se aplica a TODO valor dinámico; el HTML
 *  intencional (p. ej. `<strong>`) va en fragmentos constantes. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function boton(href: string, texto: string, outline = false): string {
  const estilo = outline
    ? `background:#FFFFFF;color:${AZUL};border:1.5px solid ${AZUL};`
    : `background:${AZUL};color:#FFFFFF;border:1.5px solid ${AZUL};`;
  return `<a href="${esc(href)}" style="display:inline-block;${estilo}font-weight:600;font-size:16px;line-height:46px;padding:0 36px;border-radius:8px;text-decoration:none;font-family:${FUENTE};">${texto}</a>`;
}

function nota(html: string): string {
  return `<tr><td style="padding:20px 0 0;border-top:1px solid ${BORDE};font-size:14px;line-height:20px;color:${MUTED};font-family:${FUENTE};">${html}</td></tr>`;
}

/**
 * Marca del encabezado. Con `logoUrl`, una imagen cuyo `alt` lleva **los mismos
 * estilos tipográficos que el wordmark**: es la técnica estándar para que el texto
 * alternativo se pinte igual cuando el cliente de correo bloquea la imagen. Sin
 * `logoUrl`, el wordmark de texto tal cual.
 */
function marca(logoUrl?: string): string {
  if (!logoUrl) {
    return `<span style="font-family:${FUENTE};font-weight:700;font-size:22px;letter-spacing:0.5px;color:#FFFFFF;">UNX Simuladores</span>`;
  }
  return `<img src="${esc(logoUrl)}" alt="UNX Simuladores" height="28" style="display:inline-block;height:28px;width:auto;border:0;outline:none;text-decoration:none;font-family:${FUENTE};font-weight:700;font-size:22px;letter-spacing:0.5px;color:#FFFFFF;">`;
}

/** Envoltura común: fondo gris, banda azul con la marca, línea amarilla, card. */
function envoltura(cuerpoFilas: string, logoUrl?: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${FONDO};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
  <tr><td style="background:${AZUL};padding:22px 48px;text-align:center;border-radius:12px 12px 0 0;">
    ${marca(logoUrl)}
  </td></tr>
  <tr><td style="height:5px;background:${AMARILLO};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="background:#FFFFFF;border:1px solid ${BORDE};border-top:0;border-radius:0 0 12px 12px;padding:40px 48px 44px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cuerpoFilas}</table>
  </td></tr>
  <tr><td style="padding:20px 24px 4px;text-align:center;font-family:${FUENTE};">
    <div style="font-size:12px;line-height:16px;color:${MUTED};font-weight:600;">Transformar aspirantes en admitidos</div>
    <div style="font-size:12px;line-height:16px;color:${MUTED};">UNX · Preparación para tu examen de admisión · <a href="https://unx.mx" style="color:${AZUL};text-decoration:none;">unx.mx</a></div>
    <div style="font-size:12px;line-height:16px;color:${PIE};margin-top:6px;">Este es un correo automático, por favor no lo respondas. © 2026 UNX. Todos los derechos reservados.</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function h2(texto: string): string {
  return `<tr><td style="font-weight:600;font-size:24px;line-height:32px;color:${INK};font-family:${FUENTE};padding-bottom:16px;">${texto}</td></tr>`;
}
function parrafo(html: string): string {
  return `<tr><td style="font-size:16px;line-height:24px;color:${TEXTO};font-family:${FUENTE};padding-bottom:16px;">${html}</td></tr>`;
}
function ctaFila(href: string, texto: string, outline = false): string {
  return `<tr><td style="padding:8px 0 24px;">${boton(href, texto, outline)}</td></tr>`;
}

// ── Correo 1 · Invitación ────────────────────────────────────────────────────
export function correoInvitacion(args: {
  nombre: string;
  enlace: string;
  logoUrl?: string;
}): Correo {
  const { nombre, enlace, logoUrl } = args;
  const html = envoltura(
    h2("¡Te damos la bienvenida a UNX Simuladores!") +
      parrafo(`Hola, ${esc(nombre)}:`) +
      parrafo(
        "Tu institución te creó una cuenta en UNX Simuladores para que practiques con simulacros del EXANI II y llegues con confianza a tu examen de admisión.",
      ) +
      parrafo("Para empezar, solo falta que elijas tu contraseña:") +
      ctaFila(enlace, "Crear mi contraseña") +
      parrafo("Nos da gusto acompañarte en tu preparación.") +
      nota(
        "El enlace es válido durante <strong>72 horas</strong>. Si no esperabas este correo, avisa a la coordinación de tu institución.",
      ),
    logoUrl,
  );
  const texto = `Te damos la bienvenida a UNX Simuladores

Hola, ${nombre}:

Tu institución te creó una cuenta en UNX Simuladores para que practiques con simulacros del EXANI II. Para empezar, elige tu contraseña aquí:

${enlace}

El enlace es válido durante 72 horas. Si no esperabas este correo, avisa a la coordinación de tu institución.`;
  return { asunto: "Crea tu contraseña — UNX Simuladores", html, texto };
}

// ── Correo 2 · Recuperación ──────────────────────────────────────────────────
export function correoRecuperacion(args: {
  nombre: string;
  enlace: string;
  logoUrl?: string;
}): Correo {
  const { nombre, enlace, logoUrl } = args;
  const html = envoltura(
    h2("Restablece tu contraseña") +
      parrafo(`Hola, ${esc(nombre)}:`) +
      parrafo(
        "Recibimos una solicitud para restablecer la contraseña de tu cuenta de UNX Simuladores. Para elegir una nueva, da clic en el botón:",
      ) +
      ctaFila(enlace, "Restablecer contraseña") +
      nota(
        "El enlace es válido durante <strong>60 minutos</strong>. Si tú no solicitaste el cambio, ignora este correo: tu contraseña seguirá siendo la misma.",
      ),
    logoUrl,
  );
  const texto = `Restablece tu contraseña

Hola, ${nombre}:

Recibimos una solicitud para restablecer la contraseña de tu cuenta de UNX Simuladores. Elige una nueva aquí:

${enlace}

El enlace es válido durante 60 minutos. Si tú no solicitaste el cambio, ignora este correo.`;
  return { asunto: "Restablece tu contraseña — UNX Simuladores", html, texto };
}

// ── Correo 3 · Confirmación de cambio ────────────────────────────────────────
export function correoConfirmacion(args: {
  nombre: string;
  fechaHora: string; // ya formateada en hora del centro de México
  enlace: string; // a la app (login)
  logoUrl?: string;
}): Correo {
  const { nombre, fechaHora, enlace, logoUrl } = args;
  const banner = `<tr><td style="padding:0 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${VERDE_TINT};border-radius:8px;padding:14px 16px;font-size:14px;line-height:20px;color:${INK};font-family:${FUENTE};"><span style="color:${VERDE};font-weight:700;">✓</span>&nbsp; Cambio realizado el <strong>${esc(fechaHora)}</strong>.</td></tr></table></td></tr>`;
  const html = envoltura(
    h2("Tu contraseña se actualizó") +
      parrafo(`Hola, ${esc(nombre)}:`) +
      parrafo(
        "La contraseña de tu cuenta de UNX Simuladores se cambió correctamente.",
      ) +
      banner +
      ctaFila(enlace, "Ir a UNX Simuladores", true) +
      nota(
        "¿No reconoces este cambio? Contacta de inmediato a la coordinación de tu institución para proteger tu cuenta.",
      ),
    logoUrl,
  );
  const texto = `Tu contraseña se actualizó

Hola, ${nombre}:

La contraseña de tu cuenta de UNX Simuladores se cambió correctamente el ${fechaHora}.

¿No reconoces este cambio? Contacta de inmediato a la coordinación de tu institución.

${enlace}`;
  return { asunto: "Tu contraseña se actualizó", html, texto };
}
