"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  title?: string;
  children?: ReactNode;
  /** Botones de acción alineados a la derecha. */
  actions?: ReactNode;
  onClose?: () => void;
  width?: number;
  /** true = posición absolute (para previews dentro de un contenedor relative). */
  contained?: boolean;
};

/**
 * Modal accesible: overlay + tarjeta. Cierra con Escape y clic en el overlay;
 * atrapa el foco (Tab cíclico), enfoca el primer campo y restaura el foco al
 * disparador al cerrar. `aria-labelledby` apunta al título.
 */
export function Modal({
  title,
  children,
  actions,
  onClose,
  width = 440,
  contained = false,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elementoPrevio = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Foco inicial: primer campo del formulario si lo hay; si no, el primer enfocable.
    const primerCampo = panel?.querySelector<HTMLElement>("input, select, textarea");
    const enfocables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (primerCampo ?? enfocables?.[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      elementoPrevio?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={cn(
        "z-50 flex items-center justify-center bg-ink/45 p-5",
        contained ? "absolute inset-0" : "fixed inset-0",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className="flex w-full flex-col gap-3 rounded-modal bg-surface p-6 shadow-modal outline-none"
      >
        {title && (
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-h2 text-ink">
              {title}
            </h2>
            {onClose && (
              <button
                type="button"
                aria-label="Cerrar"
                onClick={onClose}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg"
              >
                <X className="size-[18px]" aria-hidden />
              </button>
            )}
          </div>
        )}
        <div className="text-body text-text">{children}</div>
        {actions && <div className="mt-2 flex justify-end gap-2.5">{actions}</div>}
      </div>
    </div>
  );
}
