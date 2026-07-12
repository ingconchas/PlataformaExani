"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { adminNav, instructorNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Barra lateral fija del panel institucional (256px).
 * Activo = fondo azul-tinte + barra indicadora azul de 3px en el borde.
 * Recibe solo `role` (string): los iconos no pueden cruzar la frontera
 * servidor→cliente, así que el menú se resuelve aquí, en el cliente.
 */
export function SidebarNav({
  role,
  userName,
  userRole,
}: {
  role: "admin" | "instructor";
  userName: string;
  userRole: string;
}) {
  const pathname = usePathname();
  const items = role === "admin" ? adminNav : instructorNav;
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center px-6">
        <Image
          src="/logo/unx-logotipo.png"
          alt="UNX Simuladores"
          width={42}
          height={32}
          priority
        />
      </div>
      <div className="border-b border-border px-6 pb-4">
        <p className="truncate text-small font-semibold text-ink">{userName}</p>
        <p className="text-caption text-muted">{userRole}</p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-control px-3 py-2.5 text-small transition-colors",
                active
                  ? "bg-unx-blue-tint font-medium text-unx-blue"
                  : "text-text hover:bg-bg",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-unx-blue" />
              )}
              <Icon className="size-5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-small text-text transition-colors hover:bg-bg">
          <LogOut className="size-5 shrink-0" aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
