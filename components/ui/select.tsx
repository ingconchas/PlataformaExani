"use client";

import { type SelectHTMLAttributes, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./input";

export type SelectOption = { value: string; label: string };

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
};

/** Select UNX: control 44px, chevron, label opcional (reutiliza `Label` de input). */
export function Select({
  label,
  id,
  options,
  placeholder,
  className,
  containerClassName,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && <Label htmlFor={selectId}>{label}</Label>}
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            "h-11 w-full appearance-none rounded-control border-[1.5px] border-border-strong bg-surface pl-3 pr-9 text-body text-ink transition-colors",
            "focus:border-unx-blue disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text",
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </div>
  );
}
