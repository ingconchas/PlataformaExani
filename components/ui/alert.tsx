import { type HTMLAttributes, type ReactNode } from "react";
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "info" | "success" | "warning" | "error";

// Error/estado = color + icono + mensaje, nunca solo color (regla del sistema).
const config: Record<Kind, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "bg-unx-blue-tint text-unx-blue" },
  success: { icon: CheckCircle2, className: "bg-unx-green-tint text-unx-green" },
  warning: { icon: AlertTriangle, className: "bg-unx-orange-tint text-unx-orange-text" },
  error: { icon: XCircle, className: "bg-unx-error-tint text-unx-error" },
};

/**
 * Aviso con icono. Reenvía el resto de props al contenedor (como `Card` y `Badge`).
 *
 * ⚠️ Sin ese reenvío, un `data-*` puesto por un E2E COMPILA —TypeScript admite props con
 * guion en cualquier componente— pero NUNCA llega al DOM: el selector no encuentra nada y el
 * fallo parece de la funcionalidad, no del componente. Costó una tarde en LUI-36.
 */
export function Alert({
  kind = "info",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { kind?: Kind; children: ReactNode }) {
  const { icon: Icon, className: tono } = config[kind];
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-card p-4 text-small",
        tono,
        className,
      )}
      {...props}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-ink">{children}</div>
    </div>
  );
}
