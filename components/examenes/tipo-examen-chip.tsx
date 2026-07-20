import { cn } from "@/lib/utils";

/**
 * Chip de tipo de examen (Diseño 17): «Simulacro general» neutro / «Módulo: X»
 * morado. NO es un `Badge` a propósito: `Badge` fuerza MAYÚSCULAS con Barlow
 * Condensed («MÓDULO: BIOLOGÍA») y el mock pinta este chip en sentence-case con
 * peso medio. Antes de añadirle un prop `case` a `Badge`, un componente propio
 * de 20 líneas.
 *
 * La etiqueta viene RESUELTA del servidor (`tipoEtiqueta`, vía `normalizarTipo` +
 * `etiquetaTipo`): el cliente no decide qué es un módulo ni resuelve nombres —
 * solo colorea según `esModulo`, que también estampa el servidor.
 */
export function TipoExamenChip({
  esModulo,
  etiqueta,
  className,
}: {
  esModulo: boolean;
  etiqueta: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-caption font-medium",
        esModulo
          ? "bg-unx-purple-tint text-unx-purple"
          : "border border-border bg-bg text-ink",
        className,
      )}
    >
      {etiqueta}
    </span>
  );
}
