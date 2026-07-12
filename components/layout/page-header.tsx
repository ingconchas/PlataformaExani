import { type ReactNode } from "react";

/** Encabezado de página del panel: título + una sola acción primaria. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-h1 text-ink">{title}</h1>
        {description && <p className="mt-1 text-small text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
