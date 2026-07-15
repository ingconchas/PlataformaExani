import { Check } from "lucide-react";
import { REQUISITOS_CONTRASENA } from "@/convex/politica";
import { cn } from "@/lib/utils";

/** Checklist en vivo de la política de contraseña (verde = cumplido). Las
 *  etiquetas y pruebas vienen de `convex/politica.ts` (misma fuente que el
 *  servidor), así el cliente nunca se desincroniza. */
export function ChecklistContrasena({ password }: { password: string }) {
  return (
    <ul className="grid gap-1.5">
      {REQUISITOS_CONTRASENA.map((r) => {
        const ok = r.prueba(password);
        return (
          <li
            key={r.id}
            className={cn(
              "flex items-center gap-2 text-small transition-colors",
              ok ? "text-unx-green" : "text-muted",
            )}
          >
            <Check className="size-4 shrink-0" aria-hidden />
            {r.etiqueta}
          </li>
        );
      })}
    </ul>
  );
}
