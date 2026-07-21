"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";

/**
 * Toast de éxito (Diseño 19): pill flotante inferior, autodescartable a los 6 s con botón
 * de cierre. `role="status"` — anuncio no intrusivo para lectores de pantalla.
 *
 * `onClose` se lee vía ref para que el timeout NO se re-arme con cada render del padre
 * (un handler inline cambia de identidad en cada render y reiniciaría el reloj: el toast
 * jamás se cerraría solo).
 */
export function Toast({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const cerrarRef = useRef(onClose);
  useEffect(() => {
    cerrarRef.current = onClose;
  });

  useEffect(() => {
    const t = setTimeout(() => cerrarRef.current(), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-ink py-3 pl-4 pr-3 text-small text-surface shadow-modal"
    >
      <CheckCircle2 className="size-[18px] shrink-0 text-unx-green" aria-hidden />
      <span>{children}</span>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={() => cerrarRef.current()}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-surface/70 transition-colors hover:text-surface"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
