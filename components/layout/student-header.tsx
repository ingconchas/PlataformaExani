"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Encabezado de la app de la alumna: saludo + subtítulo «{carrera} — {institución}» + avatar
 * que lleva al PERFIL (Diseño 23).
 *
 * «Cerrar sesión» vive en el Perfil (Diseño 30), no aquí; el botón sobrevive a un fallo de la
 * query del perfil gracias a `perfil/error.tsx` — ver `boton-cerrar-sesion.tsx`.
 *
 * El subtítulo lee `perfilAlumna.mio` (LUI-24/36). Como el header vive en el LAYOUT de TODA
 * la app de la alumna y Next NO captura errores del layout en el `error.tsx` de las rutas, el
 * subtítulo va aislado en `<SubtituloMeta/>` bajo un boundary LOCAL: un fallo de esa query
 * (p. ej. `metaDe` lanzando ante una tripleta parcial) degrada SOLO el subtítulo, jamás el
 * shell —el acceso al Perfil y al cierre de sesión sigue vivo—. El boundary se RESETEA al
 * cambiar de ruta, así que un perfil reparado hace reaparecer el subtítulo en la primera
 * navegación, sin recarga.
 */

class LimiteSubtitulo extends Component<
  { resetKey: string; children: ReactNode },
  { fallo: boolean; key: string }
> {
  constructor(props: { resetKey: string; children: ReactNode }) {
    super(props);
    this.state = { fallo: false, key: props.resetKey };
  }
  static getDerivedStateFromError() {
    return { fallo: true };
  }
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { fallo: boolean; key: string },
  ) {
    if (props.resetKey !== state.key) return { fallo: false, key: props.resetKey };
    return null;
  }
  render() {
    return this.state.fallo ? null : this.props.children;
  }
}

function SubtituloMeta() {
  const { isAuthenticated } = useConvexAuth();
  const perfil = useQuery(api.perfilAlumna.mio, isAuthenticated ? {} : "skip");
  const meta = perfil?.meta ?? null;
  // Cargando o sin meta ⇒ sin subtítulo (jamás un esqueleto que mienta).
  if (!meta) return null;
  return (
    <p className="text-caption text-muted" data-subtitulo-meta>
      {meta.carrera} — {meta.institucion}
    </p>
  );
}

export function StudentHeader({ nombre }: { nombre: string }) {
  const sesion = useQuery(api.sesion.actual);
  const pathname = usePathname();
  const nombreReal = sesion?.nombre ?? nombre;
  const primero = nombreReal.split(" ")[0] || nombreReal;

  return (
    <header className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-caption text-muted">Hola,</p>
        <p className="text-h3 text-ink">{primero}</p>
        <LimiteSubtitulo resetKey={pathname}>
          <SubtituloMeta />
        </LimiteSubtitulo>
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
