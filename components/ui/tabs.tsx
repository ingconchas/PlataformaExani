"use client";

import { cn } from "@/lib/utils";

export type Tab = { id: string; label: string };

/** Pestañas UNX: activa en azul con subrayado de 2px sobre el borde inferior. */
export function Tabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: Tab[];
  activeId: string;
  onChange?: (id: string) => void;
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
            onClick={() => onChange?.(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-small font-semibold transition-colors",
              active
                ? "border-unx-blue text-unx-blue"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
