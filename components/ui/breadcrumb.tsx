import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = { label: string; href?: string };

/** Ruta de navegación: el último elemento es la página actual (sin enlace). */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Ruta de navegación" className="text-small">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="inline-flex items-center gap-2">
              {last || !item.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(last ? "font-semibold text-ink" : "text-muted")}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-muted transition-colors hover:text-unx-blue"
                >
                  {item.label}
                </Link>
              )}
              {!last && (
                <ChevronRight
                  className="size-3.5 text-border-strong"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
