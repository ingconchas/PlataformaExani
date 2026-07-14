import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "blue" | "green" | "purple" | "orange";

const tones: Record<Tone, string> = {
  blue: "bg-unx-blue-tint text-unx-blue",
  green: "bg-unx-green-tint text-unx-green",
  purple: "bg-unx-purple-tint text-unx-purple",
  orange: "bg-unx-orange-tint text-unx-orange-text",
};

/** Tarjeta de métrica: cifra grande (Barlow Condensed) + etiqueta + icono. */
export function MetricCard({
  value,
  label,
  icon,
  tone = "blue",
}: {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-border bg-surface p-5 shadow-card">
      {icon && (
        <span
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-[10px]",
            tones[tone],
          )}
        >
          {icon}
        </span>
      )}
      <div className="flex flex-col gap-0.5">
        <span className="font-condensed text-[32px] font-semibold leading-9 text-ink">
          {value}
        </span>
        <span className="text-small text-muted">{label}</span>
      </div>
    </div>
  );
}
