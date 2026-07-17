"use client";

import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";

/**
 * Control de imagen del formulario de reactivo (LUI-15 E3). PRESENTACIONAL: la subida
 * real (POST al HTTP action `/reactivos/imagen`) la orquesta el formulario y pasa el resultado por
 * `previewUrl`/`onPick`; aquí solo va el `<input type=file>` oculto y la UI. Vacío =
 * enlace «+ Adjuntar imagen»; con imagen = miniatura + chip removible. Respeta `disabled`
 * (candado/solo-lectura) y `uploading` (mientras llega el `storageId`).
 */
export function ImageUpload({
  previewUrl,
  fileName,
  uploading = false,
  disabled = false,
  onPick,
  onRemove,
  ariaLabel,
}: {
  previewUrl: string | null;
  fileName: string | null;
  uploading?: boolean;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  ariaLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bloqueado = disabled || uploading;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label={ariaLabel}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Permitir re-elegir el MISMO archivo (onChange no dispara si el value no cambia).
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      {previewUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- objectURL local o URL de Convex storage; next/image exige configurar dominios */}
          <img
            src={previewUrl}
            alt="Imagen del reactivo"
            className="max-h-24 w-fit rounded-card border border-border"
          />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-unx-blue-tint px-2.5 py-[3px] text-[13px] text-unx-blue">
              {uploading ? "Subiendo…" : (fileName ?? "Imagen adjunta")}
            </span>
            {!bloqueado && (
              <button
                type="button"
                onClick={onRemove}
                aria-label="Quitar la imagen"
                className="inline-flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-bg hover:text-unx-error"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={bloqueado}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-small font-semibold text-unx-blue transition-colors hover:text-unx-blue-hover disabled:cursor-not-allowed disabled:text-disabled-text"
        >
          <ImagePlus className="size-4" aria-hidden />
          {uploading ? "Subiendo…" : "Adjuntar imagen"}
        </button>
      )}
    </div>
  );
}
