import { Badge } from "@/components/ui/badge";

/**
 * Marcador para pantallas aún por construir. Cada ruta del MVP ya tiene su
 * "casa"; al construir la pantalla se reemplaza este componente por la UI real
 * usando los componentes de `components/ui` y `components/layout`.
 */
export function ScreenPlaceholder({
  titulo,
  diseno,
  issue,
  descripcion,
}: {
  titulo: string;
  diseno?: string;
  issue?: string;
  descripcion?: string;
}) {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-surface p-8">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h2 text-ink">{titulo}</h2>
        {issue && <Badge tone="blue">{issue}</Badge>}
      </div>
      {descripcion && <p className="mt-2 text-small text-muted">{descripcion}</p>}
      {diseno && (
        <p className="mt-4 text-caption text-muted">
          Diseño de referencia:{" "}
          <code className="font-condensed">design-reference/screens/{diseno}</code>
        </p>
      )}
      <p className="mt-1 text-caption text-muted">Pantalla por construir.</p>
    </div>
  );
}
