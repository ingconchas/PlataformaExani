"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { alumnaTabs } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Navegación inferior fija de la app de la alumna (4 pestañas, activa en azul). */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-[430px] items-stretch border-t border-border bg-surface">
      {alumnaTabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-caption transition-colors",
              active ? "text-unx-blue" : "text-muted",
            )}
          >
            <Icon className="size-6" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
