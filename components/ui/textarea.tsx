import { type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Textarea con el mismo lenguaje visual que `Input` (borde 1.5px, foco azul);
 *  la altura la fija `rows`. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      "w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3 py-2.5 text-body text-ink transition-colors",
      "placeholder:text-muted focus:border-unx-blue focus:outline-none",
      "disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
