"use client";

import { cn } from "@/lib/utils";

export type Tab = { id: string; label: string; count?: number };

/** Pestañas UNX: activa en azul con subrayado de 2px sobre el borde inferior.
 *  `disabled` apaga TODAS las pestañas (lo usa el formulario de reactivos cuando el
 *  reactivo está bloqueado o en solo lectura: si no, la UI ofrecería cambiar de
 *  presentación con el botón de guardar oculto).
 *
 *  `count` (opcional, LUI-20) pinta el pill contador del Diseño 17. Es un ESCALAR
 *  a propósito y no un `label: ReactNode`: el pill cambia de color según si la
 *  pestaña está activa y `active` se calcula AQUÍ — con un nodo libre, cada
 *  llamador tendría que recomparar `activeId` para colorear su pill (una segunda
 *  fuente de verdad sobre cuál está activa). Mismo criterio con que `DataTable`
 *  ganó `align` y `MetricCard` ganó `tint`: escalares, no aperturas de tipo.
 *  Se renderiza por `!== undefined`, no por truthiness: una pestaña en CERO
 *  conserva su pill «0».
 *
 *  ⚠️ El pill entra al NOMBRE ACCESIBLE de la pestaña («Borradores 2»): los
 *  locators de E2E casan por prefijo (`/^Borradores/`), nunca por igualdad. */
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
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-small font-semibold transition-colors",
              active
                ? "border-unx-blue text-unx-blue"
                : "border-transparent text-muted hover:text-ink",
              disabled && "cursor-not-allowed text-disabled-text hover:text-disabled-text",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  "inline-flex min-w-[22px] items-center justify-center rounded-full px-2 py-px text-caption font-semibold tabular-nums",
                  active
                    ? "bg-unx-blue-tint text-unx-blue"
                    : "bg-bg text-muted",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
