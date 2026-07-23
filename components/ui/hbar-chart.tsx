import { cn } from "@/lib/utils";

export type HBarChartItem = {
  label: string;
  /** 0–100 (el componente lo acota; la fracción→porcentaje es del caller). */
  value: number;
  /** Texto del extremo derecho; default `«{value}%»`. */
  display?: string;
  highlight?: boolean;
};

/**
 * Barras horizontales del UNX Design System (porte a Tailwind del
 * `design-reference/components/charts/HBarChart.jsx`, para LUI-30 «Desempeño por área
 * temática»). El caller decide `highlight` — el umbral de refuerzo es NEGOCIO y vive en
 * `convex/resultados.UMBRAL_REFUERZO_AREA`, no aquí (mismo reparto que `ProgressBar` con
 * `tonoParticipacion`). El tag y el texto del porcentaje hacen que el color nunca sea el
 * único canal (regla del sistema).
 */
export function HBarChart({
  data,
  highlightTag,
  className,
}: {
  data: HBarChartItem[];
  highlightTag?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {data.map((item, i) => {
        const pct = Math.max(0, Math.min(100, item.value));
        return (
          <div key={`${item.label}-${i}`} data-hbar={item.label}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-small text-text">{item.label}</span>
              {item.highlight && highlightTag && (
                <span className="font-condensed rounded-full bg-unx-orange-tint px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-unx-orange-text">
                  {highlightTag}
                </span>
              )}
              <span className="font-condensed ml-auto text-small font-semibold tabular-nums text-ink">
                {item.display ?? `${pct}%`}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  item.highlight ? "bg-unx-orange" : "bg-unx-blue",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
