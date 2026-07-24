"use client";

import { useId, useState } from "react";
import { MSG_META_RANGO, PASO_META } from "@/convex/metaAlumna";
import { PUNTAJE_BASE, PUNTAJE_MAX } from "@/convex/simulacro";

/** ¿El borrador es un puntaje válido? Devuelve el entero, o `null`. Acepta solo dígitos: un
 *  «1 147» o un «1,147» son ambiguos y se rechazan en vez de adivinarse. */
function puntajeDe(borrador: string): number | null {
  const t = borrador.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= PUNTAJE_BASE && n <= PUNTAJE_MAX ? n : null;
}

/**
 * Selector del PUNTAJE OBJETIVO (Diseño 22 y 30): slider 700–1300 con paso 10 **y** entrada
 * numérica.
 *
 * Los dos controles no son redundancia decorativa. El slider es cómodo con el pulgar y
 * comunica el rango de un vistazo; la entrada numérica es la ruta accesible (teclado y lector
 * de pantalla) y la única forma de escribir un corte que no sea múltiplo de 10 — 1147 existe
 * en la vida real. Por eso el SERVIDOR acepta cualquier entero del rango: `PASO_META` es del
 * slider, no de la regla (`convex/metaAlumna.ts`).
 *
 * ══ POR QUÉ EL CAMPO GUARDA UN BORRADOR DE TEXTO ══
 *
 * La primera versión compartía el número definitivo y lo ACOTABA en cada pulsación. Eso hacía
 * literalmente imposible teclear 1147: los estados intermedios «1», «11» y «114» saltaban a
 * 700 uno tras otro, y borrar el campo («») también, porque `Number("")` es 0. Además
 * convertía 699 en 700 y 1301 en 1300 en silencio, sin el mensaje de rango que el issue pide.
 *
 * Ahora el campo es TEXTO libre mientras se escribe y la validación ocurre sobre el borrador:
 * si no es un entero del rango, el componente reporta `null` al padre (que deshabilita
 * «Guardar cambios») y muestra el mensaje. Nada se corrige a espaldas de quien escribe.
 */
export function SliderMeta({
  valor,
  onChange,
  disabled,
}: {
  /** `null` = el borrador aún no es un puntaje válido. */
  valor: number | null;
  onChange: (valor: number | null) => void;
  disabled?: boolean;
}) {
  const idNumero = useId();
  const idError = useId();
  const [borrador, setBorrador] = useState(() =>
    valor === null ? "" : String(valor),
  );
  /** Posición del slider: el último puntaje válido. Un borrador a medias no debe moverlo. */
  const [ultimoValido, setUltimoValido] = useState(
    valor ?? Math.round((PUNTAJE_BASE + PUNTAJE_MAX) / 2),
  );

  // No hay efecto de sincronización con `valor`, y es deliberado: el borrador se siembra al
  // MONTAR y desde ahí manda él. Un efecto que lo re-sincronizara pelearía con quien está
  // tecleando (y la regla `set-state-in-effect` del repo lo prohíbe con razón). La hoja se
  // monta con la meta vigente y se desmonta al cerrarse, así que no existe el caso de un
  // cambio externo a mitad de edición.

  const escribir = (texto: string) => {
    setBorrador(texto);
    const n = puntajeDe(texto);
    if (n !== null) setUltimoValido(n);
    onChange(n);
  };

  const invalido = borrador.trim() !== "" && puntajeDe(borrador) === null;
  const vacio = borrador.trim() === "";

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={idNumero} className="text-small font-semibold text-ink">
          Puntaje objetivo
        </label>
        <input
          id={idNumero}
          // `type="text"` con teclado numérico: `type="number"` devuelve "" ante entradas
          // que el navegador considera inválidas, y ahí se pierde lo que la alumna tecleó.
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={borrador}
          disabled={disabled}
          aria-invalid={invalido || vacio}
          aria-describedby={invalido || vacio ? idError : undefined}
          data-meta-numero
          onChange={(e) => escribir(e.target.value)}
          className="font-condensed h-11 w-24 rounded-control border-[1.5px] border-border-strong bg-surface px-3 text-right text-h3 font-semibold tabular-nums text-unx-blue focus:border-unx-blue disabled:cursor-not-allowed disabled:bg-disabled-bg aria-[invalid=true]:border-unx-error"
        />
      </div>
      <input
        type="range"
        min={PUNTAJE_BASE}
        max={PUNTAJE_MAX}
        step={PASO_META}
        value={ultimoValido}
        disabled={disabled}
        data-meta-slider
        aria-label="Puntaje objetivo"
        onChange={(e) => escribir(e.target.value)}
        className="mt-3 w-full accent-unx-blue disabled:cursor-not-allowed"
      />
      <div className="flex justify-between text-caption text-muted tabular-nums">
        <span>{PUNTAJE_BASE}</span>
        <span>{PUNTAJE_MAX}</span>
      </div>
      {(invalido || vacio) && (
        <p id={idError} role="alert" className="mt-1 text-caption text-unx-error" data-meta-error>
          {MSG_META_RANGO}
        </p>
      )}
    </div>
  );
}
