import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

// Azul UNX = acción. Un solo CTA primario por vista (regla del sistema).
const variants: Record<Variant, string> = {
  primary: "bg-unx-blue text-white hover:bg-unx-blue-hover",
  secondary:
    "border-[1.5px] border-unx-blue bg-surface text-unx-blue hover:bg-unx-blue-tint",
  ghost: "text-unx-blue hover:bg-unx-blue-tint",
  danger: "bg-unx-error text-white hover:brightness-95",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-4", // 44px — densidad cómoda
  lg: "h-12 px-5", // 48px
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control text-body font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
