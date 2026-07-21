"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tarjeta-radio del Diseño 19 (destino de la asignación): card grande seleccionable con
 * título y subtítulo, que EXPANDE contenido propio al elegirse.
 *
 * Estructura accesible OBLIGADA (auditoría del plan LUI-22): el `<label>` envuelve SOLO
 * el ENCABEZADO (radio + título + sub); el contenido expandido —que trae interactivos:
 * MultiSelect, buscador, checkboxes— se renderiza como HERMANO del label dentro de la
 * card. Interactivos DENTRO de un `<label>` son HTML inválido y cada click en ellos
 * conmutaría el radio. El contenedor del grupo lo pone la pantalla
 * (`role="radiogroup"` + `aria-label`).
 *
 * Radio nativo con el mismo patrón visual de `radio.tsx` (input invisible + círculo
 * `peer`): semántica de teclado y foco visible gratis.
 */
export function RadioCard({
  name,
  value,
  checked,
  onSelect,
  title,
  sub,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "rounded-card border-[1.5px] bg-surface transition-colors",
        checked ? "border-unx-blue" : "border-border",
      )}
    >
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 p-4">
        <span className="relative mt-0.5 inline-flex size-5 shrink-0">
          <input
            id={id}
            type="radio"
            name={name}
            value={value}
            checked={checked}
            onChange={onSelect}
            className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
          />
          <span
            aria-hidden
            className={cn(
              "size-5 rounded-full border-[1.5px] bg-surface transition-[border] peer-focus-visible:ring-2 peer-focus-visible:ring-unx-blue",
              checked ? "border-[6px] border-unx-blue" : "border-border-strong",
            )}
          />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-body font-semibold text-ink">{title}</span>
          <span className="text-small text-muted">{sub}</span>
        </span>
      </label>
      {checked && children ? (
        <div className="border-t border-border px-4 py-4">{children}</div>
      ) : null}
    </div>
  );
}
