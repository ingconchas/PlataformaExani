"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DifficultyMeter,
  type NivelDificultad,
} from "@/components/ui/difficulty-meter";
import { aTextoPlano } from "@/convex/sanitizar";
import { cn } from "@/lib/utils";

/**
 * Campos COMUNES a toda pregunta de opción múltiple: el editor de opciones, el selector de
 * dificultad y el espejo de validación del cliente. Los comparten el formulario de reactivo
 * (LUI-15/16) y el drawer de preguntas de una lectura (LUI-17).
 *
 * Se extrajo SOLO lo presentacional sin estado propio: el estado sigue viviendo en cada
 * formulario y baja por props. Extraer el `Formulario` entero habría puesto en riesgo las 80
 * aserciones de `e2e:lui15` + `e2e:lui16` por un refactor sin cambio visible.
 *
 * ⚠️ Los nombres accesibles de aquí son contrato de prueba: los E2E localizan por
 * «Marcar la opción A como correcta», «Quitar la opción A», el placeholder «Opción A» y
 * «Agregar opción (máx. 4)». No renombrar sin actualizar las suites.
 */

/** Ids canónicos de opción. El servidor los revalida (`convex/reactivos.ts`): la posición en
 *  el arreglo ES la letra, y se materializa al enviar. */
export const LETRAS = ["a", "b", "c", "d"] as const;
export const NIVELES: NivelDificultad[] = ["facil", "medio", "dificil"];
export const MIN_OPCIONES = 3;
export const MAX_OPCIONES = 4;

export function EditorOpciones({
  opciones,
  correctaIdx,
  disabled,
  onTexto,
  onCorrecta,
  onAgregar,
  onQuitar,
}: {
  opciones: { texto: string }[];
  correctaIdx: number;
  disabled: boolean;
  onTexto: (i: number, texto: string) => void;
  onCorrecta: (i: number) => void;
  onAgregar: () => void;
  onQuitar: (i: number) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-small font-medium text-ink">
        Opciones de respuesta (marca la correcta)
      </span>
      <div className="grid gap-2">
        {opciones.map((o, i) => (
          // `key={i}` es CORRECTO aquí y no debe «arreglarse»: `<Input>` es controlado, así
          // que reconciliar por posición no puede dejar contenido rancio. (Los renglones de
          // material sí necesitan uid porque su editor NO es controlado.)
          <div key={i} className="flex items-center gap-2.5">
            <label className="inline-flex shrink-0 items-center gap-2">
              <input
                type="radio"
                name="correcta"
                checked={i === correctaIdx}
                disabled={disabled}
                onChange={() => onCorrecta(i)}
                className="size-4 accent-unx-blue"
                aria-label={`Marcar la opción ${LETRAS[i].toUpperCase()} como correcta`}
              />
              <span className="w-4 font-condensed font-semibold text-muted">
                {LETRAS[i].toUpperCase()}
              </span>
            </label>
            <Input
              value={o.texto}
              disabled={disabled}
              onChange={(e) => onTexto(i, e.target.value)}
              placeholder={`Opción ${LETRAS[i].toUpperCase()}`}
            />
            {opciones.length > MIN_OPCIONES && !disabled && (
              <button
                type="button"
                onClick={() => onQuitar(i)}
                aria-label={`Quitar la opción ${LETRAS[i].toUpperCase()}`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg hover:text-unx-error"
              >
                <Trash2 className="size-[17px]" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onAgregar}
          disabled={opciones.length >= MAX_OPCIONES}
          className="mt-2 inline-flex items-center gap-1 text-small font-semibold text-unx-blue disabled:cursor-not-allowed disabled:text-disabled-text"
        >
          <Plus className="size-4" aria-hidden /> Agregar opción (máx. {MAX_OPCIONES})
        </button>
      )}
    </div>
  );
}

export function SelectorDificultad({
  valor,
  disabled,
  onChange,
}: {
  valor: NivelDificultad | "";
  disabled: boolean;
  onChange: (n: NivelDificultad) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-small font-medium text-ink">
        Nivel de dificultad
      </span>
      <div className="grid grid-cols-3 gap-2">
        {NIVELES.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            aria-pressed={valor === n}
            className={cn(
              "rounded-card border p-3 text-left transition-colors",
              valor === n
                ? "border-unx-blue ring-1 ring-unx-blue"
                : "border-border hover:bg-bg",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <DifficultyMeter level={n} size="chip" showLabel />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Espejo en cliente de las reglas de `validarContenido` (`convex/reactivos.ts`). La AUTORIDAD
 * es el servidor: esto solo evita un viaje y da un mensaje inmediato.
 *
 * ⚠️ El ORDEN de las comprobaciones es contrato: el primer error gana y los E2E afirman
 * mensajes concretos. Cubre los cuatro campos comunes; lo que es propio de cada formulario
 * (el subtema del reactivo, la dificultad) lo comprueba su llamador DESPUÉS, para no alterar
 * la secuencia existente.
 */
export function validarPregunta(v: {
  enunciado: string;
  opciones: { texto: string }[];
  correctaIdx: number;
  retroalimentacion: string;
}): string | null {
  if (!aTextoPlano(v.enunciado).trim()) return "Escribe el enunciado.";
  const textos = v.opciones.map((o) => o.texto.trim());
  if (textos.length < MIN_OPCIONES)
    return `Agrega al menos ${MIN_OPCIONES} opciones.`;
  if (textos.some((t) => !t)) return "Cada opción debe tener texto.";
  if (v.correctaIdx < 0 || v.correctaIdx >= textos.length)
    return "Marca cuál es la opción correcta.";
  if (!aTextoPlano(v.retroalimentacion).trim())
    return "Escribe la explicación de la respuesta correcta.";
  return null;
}
