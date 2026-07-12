import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "blue" | "green" | "yellow" | "orange" | "purple" | "error";

const tones: Record<Tone, string> = {
  neutral: "bg-disabled-bg text-muted",
  blue: "bg-unx-blue-tint text-unx-blue",
  green: "bg-unx-green-tint text-unx-green",
  yellow: "bg-unx-yellow-tint text-ink",
  orange: "bg-unx-orange-tint text-unx-orange-text",
  purple: "bg-unx-purple-tint text-unx-purple",
  error: "bg-unx-error-tint text-unx-error",
};

/** Badge en MAYÚSCULAS, 12px, tracking 0.06em, radio pill, Barlow Condensed. */
export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "font-condensed inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-[0.06em]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
