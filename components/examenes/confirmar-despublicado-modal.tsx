"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type Fila = FunctionReturnType<typeof api.examenes.listar>[number];

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

/**
 * Confirmación de «Volver a borrador» (despublicar, LUI-21). Espejo EXACTO del patrón de
 * `ConfirmarArchivadoModal`: el botón de la fila se muestra en TODO publicado gestionable
 * (`puedeSolicitarDespublicar`) y, cuando las guardas lo impiden
 * (`despublicableAhora === false`), este diálogo EXPLICA el impedimento con la
 * confirmación deshabilitada — el motivo llega ESTAMPADO (`motivoNoDespublicable`, con
 * precedencia asignaciones primero, espejo de la mutation).
 *
 * La AUTORIDAD es `examenes.despublicar`, que recalcula con `compromisosDe`; la pista de
 * UI puede estar obsoleta y un rechazo del servidor también se pinta aquí dentro.
 */
export function ConfirmarDespublicadoModal({
  examen,
  onClose,
}: {
  examen: Fila;
  onClose: () => void;
}) {
  const despublicar = useMutation(api.examenes.despublicar);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bloqueado = !examen.despublicableAhora;
  const motivo =
    examen.motivoNoDespublicable === null
      ? null
      : examen.motivoNoDespublicable.tipo === "asignaciones"
        ? examen.motivoNoDespublicable.total === 1
          ? "Ya tiene 1 asignación: sus resultados dependen de este contenido y no puede volver a borrador."
          : `Ya tiene ${examen.motivoNoDespublicable.total} asignaciones: sus resultados dependen de este contenido y no puede volver a borrador.`
        : "Ya tiene intentos registrados: sus respuestas dependen de este contenido y no puede volver a borrador.";

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await despublicar({ examenId: examen.id });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Devolver «${examen.titulo}» a borrador?`}
      width={460}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={enviando || bloqueado}
          >
            {enviando ? "Devolviendo…" : "Volver a borrador"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-small text-text">
        <p>
          El examen dejará de estar publicado y podrás editar su contenido en el
          constructor. Solo es posible mientras <strong>nadie lo ha usado</strong>:
          sin asignaciones y sin intentos.
        </p>
        {motivo && <Alert kind="warning">{motivo}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
