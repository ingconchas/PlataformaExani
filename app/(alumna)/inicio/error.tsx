"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Boundary del segmento `/inicio` (LUI-24). El header con acceso al Perfil y al cierre de
 * sesión vive en el LAYOUT, FUERA de este boundary, así que un fallo de las queries de Inicio
 * degrada SOLO el contenido de la pantalla —nunca la salida de la app—. Ofrece reintentar.
 */
export default function ErrorInicio({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4 py-6" data-inicio-error>
      <Alert kind="error">No pudimos cargar tu inicio. Intenta de nuevo.</Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
