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
 * Confirmación de archivar/desarchivar (LUI-20). Patrón de `ConfirmarCerrarModal`
 * (LUI-12): `enviando`/`error` locales, el error se pinta DENTRO del diálogo.
 *
 * Cuando el examen NO es archivable ahora (`archivableAhora === false`), el botón
 * de la fila SÍ se muestra y este diálogo EXPLICA el impedimento con la
 * confirmación deshabilitada — ocultar el botón dejaría al instructor sin saber
 * por qué unos publicados se archivan y otros no. La mutation sigue siendo la
 * autoridad: `archivableAhora` es una pista de UI que puede estar obsoleta (las
 * queries no se re-evalúan por el paso del tiempo), así que el servidor recalcula
 * y un rechazo suyo también se pinta aquí dentro.
 *
 * El motivo llega ESTAMPADO del servidor (`motivoNoArchivable`) con precedencia
 * fija — asignaciones primero, que es lo accionable —; el cliente solo lo redacta.
 */
export function ConfirmarArchivadoModal({
  examen,
  modo,
  onClose,
}: {
  examen: Fila;
  modo: "archivar" | "desarchivar";
  onClose: () => void;
}) {
  const archivar = useMutation(api.examenes.archivar);
  const desarchivar = useMutation(api.examenes.desarchivar);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esArchivar = modo === "archivar";
  const bloqueado = esArchivar && !examen.archivableAhora;

  const motivo =
    !esArchivar || examen.motivoNoArchivable === null
      ? null
      : examen.motivoNoArchivable.tipo === "asignaciones"
        ? examen.motivoNoArchivable.pendientes === 1
          ? "Tiene 1 asignación sin concluir. Podrás archivarlo cuando cierre su ventana."
          : `Tiene ${examen.motivoNoArchivable.pendientes} asignaciones sin concluir. Podrás archivarlo cuando cierren sus ventanas.`
        : "Hay un intento en curso; no se puede archivar mientras alguien lo presenta.";

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      if (esArchivar) await archivar({ examenId: examen.id });
      else await desarchivar({ examenId: examen.id });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={
        esArchivar
          ? `¿Archivar «${examen.titulo}»?`
          : `¿Desarchivar «${examen.titulo}»?`
      }
      width={460}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant={esArchivar ? "danger" : "primary"}
            onClick={confirmar}
            disabled={enviando || bloqueado}
          >
            {enviando
              ? esArchivar
                ? "Archivando…"
                : "Desarchivando…"
              : esArchivar
                ? "Archivar"
                : "Desarchivar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-small text-text">
        {esArchivar ? (
          <p>
            El examen saldrá de la biblioteca activa y ya no podrá asignarse. Sus
            asignaciones y todos sus resultados se conservan, y sus reactivos
            siguen bloqueados para edición.
          </p>
        ) : (
          <p>
            El examen vuelve a <strong>publicado</strong> y podrá asignarse de
            nuevo. Nunca regresa a borrador: su contenido sigue congelado.
          </p>
        )}
        {motivo && <Alert kind="warning">{motivo}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
