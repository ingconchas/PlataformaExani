"use client";

import { cn } from "@/lib/utils";

export type Tab = { id: string; label: string };

/** Pestañas UNX: activa en azul con subrayado de 2px sobre el borde inferior.
 *  `disabled` apaga TODAS las pestañas (lo usa el formulario de reactivos cuando el
 *  reactivo está bloqueado o en solo lectura: si no, la UI ofrecería cambiar de
 *  presentación con el botón de guardar oculto). */
export function Tabs({
  tabs,
  activeId,
  onChange,
  disabled = false,
}: {
  tabs: Tab[];
  activeId: string;
  onChange?: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange?.(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-small font-semibold transition-colors",
              active
                ? "border-unx-blue text-unx-blue"
                : "border-transparent text-muted hover:text-ink",
              disabled && "cursor-not-allowed text-disabled-text hover:text-disabled-text",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
