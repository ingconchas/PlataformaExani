/**
 * Chips de icono del UNX Design System: recuadro de 44 px con fondo TINTE y el
 * icono en color ACENTO. Vocabulario compartido por `MetricCard` y `ShortcutCard`,
 * que pintan exactamente el mismo chip.
 *
 * El nombre del tono es el del **tinte** (por eso `orange` = tinte naranja).
 *
 * ⚠️ OJO con `yellow`: su acento es **naranja** (`--unx-orange-text`), no amarillo.
 * No es un descuido — el amarillo de marca (#FFBF54) sobre el tinte amarillo
 * (#FFF6E5) no pasa contraste AA, y `globals.css` lo dice explícito: «Amarillo …
 * Texto encima: SIEMPRE #1F2937». El par lo fija el propio design system
 * (`design-reference/screens/06-panel-admin.html`, la 3ª métrica y el acceso
 * directo de Temario). **No lo «arregles» a `text-unx-yellow`.**
 *
 * Las clases se escriben completas a propósito: el escáner JIT de Tailwind v4 no
 * ve nombres construidos por concatenación.
 */
export type Tone = "blue" | "green" | "purple" | "orange" | "yellow";

export const tones: Record<Tone, string> = {
  blue: "bg-unx-blue-tint text-unx-blue",
  green: "bg-unx-green-tint text-unx-green",
  purple: "bg-unx-purple-tint text-unx-purple",
  orange: "bg-unx-orange-tint text-unx-orange-text",
  yellow: "bg-unx-yellow-tint text-unx-orange-text",
};
