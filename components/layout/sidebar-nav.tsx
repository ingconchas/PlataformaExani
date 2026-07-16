"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { adminNav, instructorNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ETIQUETA_ROL: Record<"admin" | "instructor" | "alumno", string> = {
  admin: "Administrador",
  instructor: "Instructor",
  alumno: "Alumno",
};

/**
 * Barra lateral fija del panel institucional (256px).
 * Activo = fondo azul-tinte + barra indicadora azul de 3px en el borde.
 * Recibe solo `role` (string): los iconos no pueden cruzar la frontera
 * servidor→cliente, así que el menú se resuelve aquí, en el cliente. El nombre y
 * el rol se toman de la sesión (`sesion.actual`); `userName`/`userRole` son
 * respaldo mientras carga (LUI-7).
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
  const router = useRouter();
  const { signOut } = useAuthActions();
  const sesion = useQuery(api.sesion.actual);
  const items = role === "admin" ? adminNav : instructorNav;

  const nombre = sesion?.nombre ?? userName;
  const etiqueta = sesion ? ETIQUETA_ROL[sesion.rol] : userRole;

  async function cerrarSesion() {
    await signOut();
    router.replace("/login");
  }

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
        <p className="truncate text-small font-semibold text-ink">{nombre}</p>
        <p className="text-caption text-muted">{etiqueta}</p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          // El ítem raíz («Inicio» → /admin o /instructor) SOLO está activo en su
          // propia ruta: con `startsWith` a secas se marcaba activo en TODAS las
          // subpáginas, y «Inicio» quedaba resaltado a la vez que «Grupos» en
          // /admin/grupos (corregido en LUI-9).
          const esRaiz = item.href === "/admin" || item.href === "/instructor";
          const active = esRaiz
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              // El estado activo era SOLO una clase visual, invisible para un
              // lector de pantalla. `aria-current` lo anuncia (LUI-9).
              aria-current={active ? "page" : undefined}
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
        <button
          type="button"
          onClick={cerrarSesion}
          className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-small text-text transition-colors hover:bg-bg"
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
