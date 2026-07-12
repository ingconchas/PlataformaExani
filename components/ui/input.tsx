import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Input: borde 1.5px, radio 8px, 44px de alto. Foco = borde azul + anillo. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-3 text-body text-ink transition-colors",
        "placeholder:text-muted focus:border-unx-blue",
        "disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-small font-medium text-ink", className)}
      {...props}
    />
  );
}
