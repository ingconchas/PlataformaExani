import { type Key, type ReactNode } from "react";
import { ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataTableColumn = {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
};

/** Cada fila mapea columnKey → nodo, más un `id` estable (clave de fila). */
export type DataTableRow = Record<string, ReactNode> & { id: string };

const alignClass: Record<NonNullable<DataTableColumn["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

type DataTableProps = {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Clave estable de fila; por defecto `row.id` (nunca el índice). */
  getRowKey?: (row: DataTableRow, index: number) => Key;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyText?: string;
  emptyAction?: ReactNode;
};

export function DataTable({
  columns,
  rows,
  getRowKey = (row) => row.id,
  sortBy,
  sortDir = "asc",
  onSort,
  page = 1,
  pageCount = 1,
  onPageChange,
  emptyTitle = "Sin resultados",
  emptyText,
  emptyAction,
}: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-10 text-center shadow-card">
        <Search className="mx-auto mb-3 size-11 text-border-strong" aria-hidden />
        <p className="text-body font-semibold text-ink">{emptyTitle}</p>
        {emptyText && (
          <p className="mx-auto mt-1 max-w-md text-small text-muted">{emptyText}</p>
        )}
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    );
  }

  const align = (c: DataTableColumn) => alignClass[c.align ?? "left"];

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "font-condensed whitespace-nowrap border-b border-border px-4 py-3 text-caption font-semibold uppercase tracking-[0.05em] text-muted",
                    align(c),
                  )}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1",
                        sortBy === c.key ? "text-unx-blue" : "text-muted",
                      )}
                    >
                      {c.label}
                      <ChevronUp
                        className={cn(
                          "size-3 transition-transform",
                          sortBy === c.key ? "opacity-100" : "opacity-40",
                          sortBy === c.key && sortDir === "desc" && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={getRowKey(row, i)} className="transition-colors hover:bg-bg">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3.5 align-middle text-body",
                      i === rows.length - 1 ? "" : "border-b border-border",
                      align(c),
                    )}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-2.5">
          <PageBtn label="‹" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)} />
          {pageList(page, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="min-w-6 text-center text-small text-muted">
                …
              </span>
            ) : (
              <PageBtn
                key={p}
                label={String(p)}
                active={p === page}
                onClick={() => onPageChange?.(Number(p))}
              />
            ),
          )}
          <PageBtn label="›" disabled={page >= pageCount} onClick={() => onPageChange?.(page + 1)} />
        </div>
      )}
    </div>
  );
}

function pageList(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = [1, 2, pageCount, page - 1, page, page + 1].filter(
    (p) => p >= 1 && p <= pageCount,
  );
  const uniq = [...new Set(keep)].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of uniq) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function PageBtn({
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-control px-1.5 text-small font-semibold transition-colors",
        active ? "bg-unx-blue text-white" : "text-ink hover:bg-bg",
        disabled && "cursor-not-allowed text-disabled-text hover:bg-transparent",
      )}
    >
      {label}
    </button>
  );
}
