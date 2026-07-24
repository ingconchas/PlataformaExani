"use client";

import Link from "next/link";
import { BotonCerrarSesion } from "@/components/alumna/boton-cerrar-sesion";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Boundary del segmento `/perfil` (LUI-36).
 *
 * Existe por una razón puntual: al mudar «Cerrar sesión» del header al Perfil (Diseño 23/30),
 * esta pantalla quedó como la ÚNICA salida de la app de la alumna. Y `perfilAlumna.mio`
 * LANZA a propósito ante una fila inconsistente (`metaAlumna.metaDe` con una tripleta
 * parcial) — sin este boundary, ese fallo dejaría a la alumna dentro de su sesión sin forma
 * de salir. En un dispositivo compartido eso es privacidad, no comodidad.
 *
 * Por eso el fallback no es un error genérico: renderiza la MISMA acción de cerrar sesión que
 * la pantalla sana, más un reintento.
 */
export default function ErrorPerfil({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4 py-6" data-perfil-error>
      <h1 className="text-h2 text-ink">Mi perfil</h1>
      <Alert kind="error">
        No pudimos cargar tu perfil. Puedes reintentar o cerrar sesión.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
      <BotonCerrarSesion />
      <Link href="/examenes" className="text-center text-small font-semibold text-unx-blue underline">
        Ir a Mis exámenes
      </Link>
    </div>
  );
}
