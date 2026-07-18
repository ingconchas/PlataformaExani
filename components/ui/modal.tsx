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
  /**
   * `"right"` = panel lateral a altura completa pegado al borde derecho (drawer de
   * preguntas de lectura, LUI-17). Solo cambia el layout: la gestión de foco, el Tab
   * cíclico, el Escape y la restauración del foco son los MISMOS — que es justo por lo
   * que esto es una prop y no un `drawer.tsx` que los duplicara u omitiera.
   */
  position?: "center" | "right";
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
  position = "center",
}: ModalProps) {
  const lateral = position === "right";
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elementoPrevio = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Foco inicial: primer campo del formulario si lo hay; si no, el primer enfocable.
    // `[contenteditable]` incluido para TipTap: no es input/select/textarea, así que sin él
    // el foco caería en el primer botón de su barra de herramientas («Negrita»).
    const primerCampo = panel?.querySelector<HTMLElement>(
      'input, select, textarea, [contenteditable="true"]',
    );
    const enfocables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (primerCampo ?? enfocables?.[0] ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Un hijo (p. ej. el MultiSelect con su dropdown abierto) puede consumir
        // Escape con preventDefault para cerrarse primero; en ese caso NO
        // cerramos el modal. Escuchamos en fase de burbuja para que el manejador
        // React del hijo corra antes que este.
        if (e.defaultPrevented) return;
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

    // Fase de burbuja (sin captura): así los manejadores React de los hijos
    // corren antes y pueden consumir el evento (defaultPrevented) — p. ej. el
    // MultiSelect cerrando su dropdown con Escape sin cerrar el modal.
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      elementoPrevio?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={cn(
        "z-50 flex bg-ink/45",
        contained ? "absolute inset-0" : "fixed inset-0",
        lateral ? "items-stretch justify-end" : "items-center justify-center p-5",
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
        className={cn(
          "flex w-full flex-col gap-3 bg-surface p-6 outline-none",
          lateral
            ? "h-full overflow-y-auto border-l border-border shadow-modal"
            : "rounded-modal shadow-modal",
        )}
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
