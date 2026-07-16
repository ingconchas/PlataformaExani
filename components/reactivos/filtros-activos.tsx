import { X } from "lucide-react";

export type ChipFiltro = { key: string; label: string; onRemove: () => void };

/**
 * Chips de los filtros activos del banco (LUI-14), con ✕ para quitar cada uno y un
 * enlace «Limpiar filtros». Es un patrón nuevo del repo (ni grupos ni usuarios lo
 * tienen); vive local hasta que aparezca un segundo uso. Quitar un chip de
 * clasificación resetea sus dependientes — la lógica la resuelve el padre en el
 * `onRemove` de cada chip.
 */
export function FiltrosActivos({
  chips,
  onLimpiar,
}: {
  chips: ChipFiltro[];
  onLimpiar: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          aria-label={`Quitar filtro: ${c.label}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-unx-blue-tint px-3 py-1 text-small font-semibold text-unx-blue transition-colors hover:bg-unx-blue/15"
        >
          {c.label}
          <X className="size-3.5" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={onLimpiar}
        className="text-small font-semibold text-muted underline underline-offset-2 transition-colors hover:text-ink"
      >
        Limpiar filtros
      </button>
    </div>
  );
}
