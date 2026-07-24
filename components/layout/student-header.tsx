"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Encabezado de la app de la alumna: saludo + avatar que lleva al PERFIL (Diseño 23).
 *
 * «Cerrar sesión» ya no vive aquí: se mudó al Perfil (Diseño 30), que es donde el diseño la
 * pone y donde acompaña al resto de las acciones de cuenta. El botón sobrevive a un fallo de
 * la query del perfil gracias a `perfil/error.tsx` — ver `boton-cerrar-sesion.tsx`.
 *
 * El subtítulo «{carrera} — {institución}» del Diseño 23 es de LUI-24 (Inicio), que es quien
 * arma esa pantalla; aquí no se adelanta.
 */
export function StudentHeader({ nombre }: { nombre: string }) {
  const sesion = useQuery(api.sesion.actual);
  const nombreReal = sesion?.nombre ?? nombre;
  const primero = nombreReal.split(" ")[0] || nombreReal;

  return (
    <header className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-caption text-muted">Hola,</p>
        <p className="text-h3 text-ink">{primero}</p>
      </div>
      <Link
        href="/perfil"
        aria-label="Mi perfil"
        data-ir-perfil
        className="flex size-10 items-center justify-center rounded-full bg-unx-blue-tint text-small font-semibold text-unx-blue transition-colors hover:bg-unx-blue/20"
      >
        {primero.charAt(0).toUpperCase()}
      </Link>
    </header>
  );
}
