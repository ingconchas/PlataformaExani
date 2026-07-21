"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./input";

export type MultiSelectOption = { value: string; label: string };

/**
 * Multiselect con chips removibles y lista desplegable.
 *
 * Accesibilidad dentro de un <Modal> (condiciones de auditoría LUI-12):
 * - El trigger es un `<div role="combobox" tabIndex={0}>` (NO un <button>), para
 *   no anidar botones; el focus-trap del Modal lo reconoce por `[tabindex]`.
 * - Los chips de quitar y las opciones del listbox son `<button type="button">`
 *   (no envían el <form> del modal).
 * - Escape con el dropdown ABIERTO lo cierra y CONSUME el evento
 *   (preventDefault + stopPropagation) para que el Modal no se cierre a la vez.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Selecciona…",
  // El default conserva el copy histórico de LUI-12 (instructores) byte-idéntico;
  // otros consumidores (grupos en LUI-22) pasan el suyo.
  emptyMessage = "No hay instructores disponibles.",
  error,
  disabled = false,
}: {
  label?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const seleccionadas = options.filter((o) => value.includes(o.value));

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  // Cerrar el dropdown al hacer clic fuera del componente.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if ((e.key === "Enter" || e.key === " " || e.key === "ArrowDown") && !open) {
      e.preventDefault();
      setOpen(true);
    }
  }

  // Escape en cualquier parte del componente: si el dropdown está abierto,
  // ciérralo y consume el evento para que el Modal (que respeta defaultPrevented)
  // no se cierre en este primer Escape. Devuelve el foco al trigger.
  function onRootKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onRootKeyDown}
      className="flex flex-col gap-1.5"
    >
      {label && <Label id={labelId}>{label}</Label>}
      <div className="relative">
        <div
          id={id}
          ref={triggerRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={label ? labelId : undefined}
          aria-haspopup="listbox"
          tabIndex={disabled ? -1 : 0}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-control border-[1.5px] bg-surface py-1.5 pl-2 pr-10 transition-colors focus:outline-none focus-visible:border-unx-blue",
            error
              ? "border-unx-error"
              : open
                ? "border-unx-blue"
                : "border-border-strong",
            disabled ? "cursor-not-allowed bg-disabled-bg" : "cursor-pointer",
          )}
        >
          {seleccionadas.length === 0 && (
            <span className="px-1.5 text-body text-muted">{placeholder}</span>
          )}
          {seleccionadas.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1.5 rounded-full bg-unx-blue-tint py-1 pl-3 pr-1.5 text-small font-semibold text-unx-blue"
            >
              {o.label}
              <button
                type="button"
                aria-label={`Quitar ${o.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.value);
                }}
                className="inline-flex size-[18px] items-center justify-center rounded-full text-unx-blue transition-colors hover:text-unx-blue-hover"
              >
                <X className="size-3" strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          ))}
          <ChevronDown
            className={cn(
              "pointer-events-none absolute right-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </div>

        {open && !disabled && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-control border border-border bg-surface py-1 shadow-modal"
          >
            {options.length === 0 && (
              <p className="px-3.5 py-2.5 text-small text-muted">
                {emptyMessage}
              </p>
            )}
            {options.map((o) => {
              const active = value.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(o.value);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-body transition-colors",
                    active ? "bg-unx-blue-tint text-ink" : "text-text hover:bg-bg",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-[18px] shrink-0 items-center justify-center rounded border-[1.5px]",
                      active
                        ? "border-unx-blue bg-unx-blue text-surface"
                        : "border-border-strong bg-surface",
                    )}
                  >
                    {active && (
                      <Check className="size-3" strokeWidth={3} aria-hidden />
                    )}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error && <p className="text-caption text-unx-error">{error}</p>}
    </div>
  );
}
