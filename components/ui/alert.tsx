import { type ReactNode } from "react";
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

export function Alert({
  kind = "info",
  children,
}: {
  kind?: Kind;
  children: ReactNode;
}) {
  const { icon: Icon, className } = config[kind];
  return (
    <div className={cn("flex items-start gap-3 rounded-card p-4 text-small", className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-ink">{children}</div>
    </div>
  );
}
