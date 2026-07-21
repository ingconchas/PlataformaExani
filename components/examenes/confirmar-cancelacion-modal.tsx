"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

/**
 * Confirmación de «Cancelar asignación» (LUI-22). Patrón de `ConfirmarDespublicadoModal`:
 * la fila solo ofrece la acción cuando `puedeSolicitarCancelar ∧ programada` (derivado en
 * el cliente con el reloj anclado), pero la AUTORIDAD es `asignaciones.cancelar` — que
 * recalcula ventana, autoría y la sonda de intentos; un rechazo del servidor se pinta
 * aquí dentro (p. ej. la ventana ABRIÓ mientras el diálogo estaba en pantalla).
 *
 * La lista de asignaciones se actualiza sola al confirmar (reactividad de Convex): el
 * modal solo cierra.
 */
export function ConfirmarCancelacionModal({
  asignacionId,
  destinoNombre,
  rango,
  onClose,
}: {
  asignacionId: Id<"asignaciones">;
  destinoNombre: string;
  rango: string;
  onClose: () => void;
}) {
  const cancelar = useMutation(api.asignaciones.cancelar);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await cancelar({ asignacionId });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title="¿Cancelar esta asignación?"
      width={460}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Conservarla
          </Button>
          <Button variant="danger" onClick={confirmar} disabled={enviando}>
            {enviando ? "Cancelando…" : "Cancelar asignación"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-small text-text">
        <p>
          <strong>{destinoNombre}</strong> · {rango}. La asignación se eliminará y
          los alumnos destino ya no la recibirán. Solo es posible mientras la
          ventana <strong>no ha abierto</strong> y nadie la ha presentado.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
