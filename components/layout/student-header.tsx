"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut } from "lucide-react";
import { api } from "@/convex/_generated/api";

/** Encabezado de la app de la alumna: saludo (nombre de la sesión) + cerrar sesión. */
export function StudentHeader({ nombre }: { nombre: string }) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const sesion = useQuery(api.sesion.actual);
  const nombreReal = sesion?.nombre ?? nombre;
  const primero = nombreReal.split(" ")[0] || nombreReal;

  return (
    <header className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-caption text-muted">Hola,</p>
        <p className="text-h3 text-ink">{primero}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-unx-blue-tint text-small font-semibold text-unx-blue">
          {primero.charAt(0).toUpperCase()}
        </span>
        <button
          type="button"
          aria-label="Cerrar sesión"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          className="inline-flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg hover:text-ink"
        >
          <LogOut className="size-5" aria-hidden />
        </button>
      </div>
    </header>
  );
}
