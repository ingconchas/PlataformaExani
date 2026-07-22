"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut, Menu, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { adminNav, instructorNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ETIQUETA_ROL: Record<"admin" | "instructor" | "alumno", string> = {
  admin: "Administrador",
  instructor: "Instructor",
  alumno: "Alumno",
};

/**
 * Barra lateral del panel institucional. Fija (256px) en ≥md; en móvil colapsa a
 * una top bar con hamburguesa que abre un **drawer `<dialog>` MODAL** (LUI-19).
 * Activo = fondo azul-tinte + barra indicadora azul de 3px en el borde.
 *
 * Por qué `<dialog>` + `showModal()` y no un div con translate: la plataforma da
 * gratis exactamente lo que un drawer accesible exige — top layer (cero guerras
 * de z-index con la top bar y el backdrop), **fondo inerte** (no se tabula al
 * contenido de atrás), **Escape nativo** y **restauración del foco** al botón
 * que lo abrió. El aside de escritorio lleva `max-md:hidden` (display:none):
 * cerrado en móvil NO deja enlaces en el orden de tabulación ni en el árbol
 * accesible — un translate fuera de pantalla sí los dejaría.
 *
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

  // El estado `abierto` SOLO alimenta `aria-expanded`: la verdad del drawer es
  // el propio <dialog>, y se sincroniza por su evento `close` (que dispara
  // igual con Escape, backdrop, la X o la navegación).
  const [abierto, setAbierto] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => setAbierto(false);
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, []);

  // Un modal `md:hidden` abierto al crecer el viewport dejaría la página inerte
  // con el control invisible: al cruzar el breakpoint se cierra solo.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) dialogRef.current?.close();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function abrir() {
    dialogRef.current?.showModal();
    setAbierto(true);
  }
  function cerrar() {
    dialogRef.current?.close();
  }

  async function cerrarSesion() {
    cerrar();
    await signOut();
    router.replace("/login");
  }

  return (
    <>
      {/* Top bar móvil: hamburguesa + logo. En ≥md no existe. */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:hidden">
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls="menu-lateral"
          aria-label={
            abierto ? "Cerrar menú de navegación" : "Abrir menú de navegación"
          }
          onClick={() => (abierto ? cerrar() : abrir())}
          className="flex size-10 items-center justify-center rounded-control text-text transition-colors hover:bg-bg"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Image
          src="/logo/unx-logotipo.png"
          alt="UNX Simuladores"
          width={42}
          height={32}
          priority
        />
      </div>

      {/* Drawer móvil: modal nativo en el top layer. `open:flex` porque el
          display por defecto de dialog[open] es block. */}
      <dialog
        ref={dialogRef}
        id="menu-lateral"
        aria-label="Navegación principal"
        onClick={(e) => {
          // El backdrop ES el propio dialog fuera de su contenido.
          if (e.target === e.currentTarget) cerrar();
        }}
        className="m-0 h-dvh max-h-none w-64 max-w-none flex-col border-r border-border bg-surface p-0 backdrop:bg-ink/40 open:flex md:hidden"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Image
            src="/logo/unx-logotipo.png"
            alt="UNX Simuladores"
            width={42}
            height={32}
          />
          <button
            type="button"
            aria-label="Cerrar menú de navegación"
            onClick={cerrar}
            className="flex size-10 items-center justify-center rounded-control text-text transition-colors hover:bg-bg"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <ContenidoNav
          items={items}
          pathname={pathname}
          nombre={nombre}
          etiqueta={etiqueta}
          onNavegar={cerrar}
          onCerrarSesion={cerrarSesion}
        />
      </dialog>

      {/* Aside de escritorio: EXACTAMENTE el layout previo en ≥md. */}
      <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface max-md:hidden">
        <div className="flex h-16 items-center px-6">
          <Image
            src="/logo/unx-logotipo.png"
            alt="UNX Simuladores"
            width={42}
            height={32}
            priority
          />
        </div>
        <ContenidoNav
          items={items}
          pathname={pathname}
          nombre={nombre}
          etiqueta={etiqueta}
          onCerrarSesion={cerrarSesion}
        />
      </aside>
    </>
  );
}

/** Identidad + menú + cierre de sesión — compartido por el aside y el drawer. */
function ContenidoNav({
  items,
  pathname,
  nombre,
  etiqueta,
  onNavegar,
  onCerrarSesion,
}: {
  items: NavItem[];
  pathname: string;
  nombre: string;
  etiqueta: string;
  onNavegar?: () => void;
  onCerrarSesion: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-6 pb-4 max-md:pt-2">
        <p className="truncate text-small font-semibold text-ink">{nombre}</p>
        <p className="text-caption text-muted">{etiqueta}</p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          // Activo = la coincidencia MÁS LARGA del pathname (LUI-20). El
          // `startsWith` a secas producía DOS resaltados cuando un href es
          // prefijo de otro: «Inicio» en todas las subpáginas (LUI-9 lo tapó con
          // un caso especial de raíz) y ahora «Resumen de exámenes»
          // (/admin/examenes) encendido a la vez que «Biblioteca de exámenes»
          // (/admin/examenes/biblioteca). La coincidencia más larga SUBSUME el
          // caso de la raíz: /admin coincide en todas partes, pero cualquier
          // subsección coincide MÁS — así que «Inicio» solo gana en /admin.
          const coincide = (href: string) =>
            pathname === href || pathname.startsWith(href + "/");
          const masLarga = items.reduce(
            (mejor, otro) =>
              coincide(otro.href) && otro.href.length > mejor.length
                ? otro.href
                : mejor,
            "",
          );
          const active = item.href === masLarga && coincide(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavegar}
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
          onClick={onCerrarSesion}
          className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-small text-text transition-colors hover:bg-bg"
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </>
  );
}
