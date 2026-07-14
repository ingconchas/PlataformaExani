"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type RadioOption = { value: string; label: string };

/**
 * Grupo de radios accesible: `role="radiogroup"` + `aria-labelledby`, con
 * `<input type="radio">` reales (semántica nativa + compatibles con el
 * focus-trap del Modal). Círculo 20px; activo = borde azul grueso (punto).
 */
export function RadioGroup({
  name,
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div>
      {label && (
        <span id={labelId} className="mb-1.5 block text-small font-medium text-ink">
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-labelledby={label ? labelId : undefined}
        className="flex flex-wrap gap-x-6 gap-y-2"
      >
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                "inline-flex items-center gap-2.5 text-body",
                disabled
                  ? "cursor-not-allowed text-disabled-text"
                  : "cursor-pointer text-text",
              )}
            >
              <span className="relative inline-flex size-5">
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(o.value)}
                  className={cn(
                    "peer absolute inset-0 m-0 opacity-0",
                    !disabled && "cursor-pointer",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    "size-5 rounded-full border-[1.5px] bg-surface transition-[border] peer-focus-visible:ring-2 peer-focus-visible:ring-unx-blue",
                    checked ? "border-[6px] border-unx-blue" : "border-border-strong",
                    disabled && "bg-disabled-bg",
                  )}
                />
              </span>
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
