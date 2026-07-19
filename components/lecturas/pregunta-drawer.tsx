"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { type NivelDificultad } from "@/components/ui/difficulty-meter";
import {
  EditorOpciones,
  LETRAS,
  MAX_OPCIONES,
  MIN_OPCIONES,
  SelectorDificultad,
  validarPregunta,
} from "@/components/reactivos/campos-pregunta";

/** Los datos de una pregunta tal como los envía el drawer. */
export type PreguntaEnviada = {
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  dificultad: NivelDificultad;
  retroalimentacion: string;
};

export type PreguntaInicial = {
  enunciado: string;
  opciones: { id: string; texto: string }[];
  opcionCorrecta: string;
  dificultad: NivelDificultad;
  retroalimentacion: string | null;
};

/**
 * Panel lateral para crear o editar una pregunta del bloque de una lectura (LUI-17).
 *
 * ⚠️ **El llamador DEBE montarlo condicionalmente y con `key` por identidad**
 * (`key={reactivoId ?? "nueva-" + nonce}`), no ocultarlo por CSS. `RichTextEditor` lee
 * `value` una sola vez al montar: si la instancia se reutiliza entre aperturas, abrir la
 * pregunta 1, cerrar y abrir la 3 mostraría el enunciado de la 1 mientras la cabecera dice
 * «Pregunta 3», y la siguiente tecla escribiría ese texto encima al guardar. Es la misma
 * corrupción silenciosa que el `key={índice}` de LUI-16.
 *
 * No lleva clasificación (la fija la LECTURA y la mutation ni siquiera acepta `subtemaId`),
 * ni imagen, ni pestañas de presentación: las preguntas de lectura son siempre directas.
 */
export function PreguntaDrawer({
  ordinal,
  tituloLectura,
  inicial,
  guardando,
  errorServidor,
  onGuardar,
  onCerrar,
}: {
  ordinal: number;
  tituloLectura: string;
  inicial: PreguntaInicial | null;
  guardando: boolean;
  /** Rechazo del servidor. Se pinta AQUÍ dentro y no en el formulario padre: su `<Alert>`
   *  queda detrás del overlay, así que el usuario vería el panel sin explicación. */
  errorServidor: string | null;
  onGuardar: (p: PreguntaEnviada) => void;
  onCerrar: () => void;
}) {
  const esEdicion = inicial !== null;
  const [enunciado, setEnunciado] = useState(inicial?.enunciado ?? "");
  const [opciones, setOpciones] = useState<{ texto: string }[]>(
    inicial
      ? inicial.opciones.map((o) => ({ texto: o.texto }))
      : Array.from({ length: MIN_OPCIONES }, () => ({ texto: "" })),
  );
  const [correctaIdx, setCorrectaIdx] = useState(
    inicial ? inicial.opciones.findIndex((o) => o.id === inicial.opcionCorrecta) : -1,
  );
  const [dificultad, setDificultad] = useState<NivelDificultad | "">(
    inicial?.dificultad ?? "",
  );
  const [retroalimentacion, setRetro] = useState(inicial?.retroalimentacion ?? "");
  const [error, setError] = useState<string | null>(null);

  function enviar() {
    setError(null);
    // Espejo compartido con el formulario de reactivo; la AUTORIDAD es el servidor.
    const mal = validarPregunta({
      enunciado,
      opciones,
      correctaIdx,
      retroalimentacion,
    });
    if (mal) return setError(mal);
    if (!dificultad) return setError("Elige el nivel de dificultad.");
    onGuardar({
      enunciado, // HTML enriquecido; el servidor lo sanea
      opciones: opciones.map((o, i) => ({ id: LETRAS[i], texto: o.texto.trim() })),
      opcionCorrecta: LETRAS[correctaIdx],
      dificultad,
      retroalimentacion,
    });
  }

  return (
    <Modal
      position="right"
      width={460}
      title={esEdicion ? "Editar pregunta" : "Agregar pregunta"}
      onClose={onCerrar}
      actions={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={guardando}>
            {guardando
              ? "Guardando…"
              : esEdicion
                ? "Guardar pregunta"
                : "Agregar a la lectura"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-small text-muted">
          Pregunta {ordinal} · {tituloLectura}
        </p>

        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Enunciado de la pregunta
          </span>
          <RichTextEditor
            ariaLabel="Enunciado de la pregunta"
            value={enunciado}
            minHeight={70}
            onChange={setEnunciado}
          />
        </div>

        <EditorOpciones
          opciones={opciones}
          correctaIdx={correctaIdx}
          disabled={false}
          onTexto={(i, texto) =>
            setOpciones((prev) => prev.map((o, j) => (j === i ? { texto } : o)))
          }
          onCorrecta={setCorrectaIdx}
          onAgregar={() =>
            setOpciones((prev) =>
              prev.length >= MAX_OPCIONES ? prev : [...prev, { texto: "" }],
            )
          }
          onQuitar={(i) => {
            setOpciones((prev) =>
              prev.length <= MIN_OPCIONES ? prev : prev.filter((_, j) => j !== i),
            );
            // Mismo reajuste que el formulario de reactivo: la correcta se rastrea por
            // POSICIÓN, así que quitar una opción anterior la desplaza.
            setCorrectaIdx((c) => (c === i ? -1 : c > i ? c - 1 : c));
          }}
        />

        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Explicación de la respuesta correcta
          </span>
          {/* Editor rico, NO `Textarea`: el servidor guarda HTML saneado, igual que en el
              formulario de reactivo. El mock usaba `Textarea` y era incoherente con eso. */}
          <RichTextEditor
            ariaLabel="Explicación de la pregunta"
            value={retroalimentacion}
            minHeight={70}
            onChange={setRetro}
          />
          <p className="mt-1 text-caption text-muted">
            El alumno la verá al revisar sus respuestas.
          </p>
        </div>

        <SelectorDificultad
          valor={dificultad}
          disabled={false}
          onChange={setDificultad}
        />

        {(error ?? errorServidor) && (
          <Alert kind="error">{error ?? errorServidor}</Alert>
        )}
      </div>
    </Modal>
  );
}
