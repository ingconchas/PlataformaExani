import { cn } from "@/lib/utils";

export type NivelDificultad = "facil" | "medio" | "dificil";

/**
 * Nomenclatura CANÓNICA de dificultad en toda la plataforma (decisión 2026-07-12):
 * el DATO es `facil|medio|dificil`; lo que se MUESTRA es Básico/Intermedio/Avanzado.
 * Se exporta para que el filtro y los chips del banco (LUI-14) usen las mismas
 * etiquetas que el medidor y nunca se desincronicen.
 */
export const etiquetaDificultad: Record<NivelDificultad, string> = {
  facil: "Básico",
  medio: "Intermedio",
  dificil: "Avanzado",
};

const NIVELES: Record<
  NivelDificultad,
  { barras: number; barra: string; texto: string }
> = {
  facil: { barras: 1, barra: "bg-unx-green", texto: "text-unx-green" },
  // Mostaza AA: el amarillo de marca (#FFBF54) no pasa contraste sobre blanco y no
  // hay token para este oscuro. Es el mismo valor que usa el prototipo para «medio»
  // (distinto del naranja de Avanzado, así el rótulo no depende solo del nº de barras).
  medio: { barras: 2, barra: "bg-unx-yellow", texto: "text-[#a87013]" },
  dificil: { barras: 3, barra: "bg-unx-orange", texto: "text-unx-orange-text" },
};

/**
 * Dificultómetro UNX — 3 barras ascendentes rellenas hasta el nivel + etiqueta de
 * texto (NUNCA solo color: la etiqueta es obligatoria por accesibilidad; sin ella
 * el medidor lleva `aria-label`). Calca `design-reference/components/gamification/
 * DifficultyMeter.jsx`, con la nomenclatura canónica en vez de FÁCIL/MEDIO/DIFÍCIL.
 */
export function DifficultyMeter({
  level = "facil",
  showLabel = true,
  size = "chip",
  className,
}: {
  level?: NivelDificultad;
  showLabel?: boolean;
  size?: "chip" | "card";
  className?: string;
}) {
  const nivel = NIVELES[level];
  const card = size === "card";
  const alturas = card ? [12, 20, 28] : [8, 14, 20];
  const anchoBarra = card ? 10 : 7;
  return (
    <span
      className={cn("font-condensed inline-flex items-center", className)}
      style={{ gap: card ? 12 : 10 }}
      {...(showLabel
        ? {}
        : { role: "img", "aria-label": `Dificultad: ${etiquetaDificultad[level]}` })}
    >
      <span
        className="inline-flex items-end"
        style={{ gap: card ? 4 : 3, height: card ? 28 : 20 }}
        aria-hidden
      >
        {alturas.map((h, i) => (
          <span
            key={i}
            className={cn(
              "inline-block",
              i < nivel.barras ? nivel.barra : "bg-border",
            )}
            style={{ width: anchoBarra, height: h, borderRadius: card ? 3 : 2 }}
          />
        ))}
      </span>
      {showLabel && (
        <span
          className={cn("font-semibold tracking-[0.04em]", nivel.texto)}
          style={{ fontSize: card ? 17 : 14 }}
        >
          {etiquetaDificultad[level]}
        </span>
      )}
    </span>
  );
}
