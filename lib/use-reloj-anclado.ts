"use client";

import { useEffect, useRef, useState } from "react";

/** `setTimeout` con retardo mayor dispara INMEDIATAMENTE en los navegadores. */
export const CLAMP_TIMER_MS = 2 ** 31 - 1;
/** Margen al disparar en una frontera: evita re-evaluar un instante ANTES del cruce. */
export const MARGEN_FRONTERA_MS = 250;
/** Deriva a partir de la cual el estado se refresca ANTES de armar el siguiente timer. */
const DERIVA_MAX_MS = 1000;

/**
 * RELOJ ANCLADO al servidor — el «ahora» con el que el cliente deriva estados de tiempo.
 *
 * Extraído al TERCER consumidor, como estaba declarado en `app/instructor/inicio-client.tsx`
 * («regla de tres»): nació en `components/examenes/asignar-examen-client.tsx` (LUI-22, 11
 * rondas de auditoría encima), se copió una vez para el panel del instructor (LUI-19) y el
 * player de la alumna (LUI-26) lo habría copiado dos veces más. Las dos copias previas
 * quedaron migradas a este hook en el mismo cambio, con sus suites (`e2e:lui22`,
 * `e2e:lui19`) como red: ambas incluyen testigos de tiempo que demuestran el cruce en vivo.
 *
 * ══ EL CONTRATO ══
 *
 *  · `ahoraServidor` es el ancla de INICIO: el runtime de Convex congela `Date.now()` al
 *    empezar la query, así que ese número es «cuándo se leyó», no «qué hora es ahora».
 *  · El avance lo pone `performance.now()` (tiempo transcurrido monótono), **jamás el reloj
 *    del dispositivo**, que puede estar desfasado horas.
 *  · Cada entrega reactiva re-ancla (la dependencia `[ahoraServidor]`), así que la deriva
 *    acumulada se corrige sola con cualquier cambio de datos.
 *  · El timer despierta en la PRÓXIMA frontera (+ margen) y no antes: nada de sondeo por
 *    segundo para saber si una ventana abrió. Con `tickMs` se añade además un despertar
 *    periódico ALINEADO al segundo — lo que necesita una cuenta regresiva, y solo ella.
 *  · Si al armar el timer detecta deriva > 1 s (p. ej. el efecto re-corrió por datos, no
 *    por el timer), refresca el estado PRIMERO y se re-arma ya al día: sin esto, una
 *    actualización a mitad de espera re-armaba el retardo contra un `ahora` viejo y el
 *    cruce llegaba tarde.
 *  · El ref se escribe SOLO en efectos y todo `setState` es asíncrono (reglas de hooks del
 *    repo: `react-hooks/refs`, `set-state-in-effect`).
 *
 * ⚠️ Las fronteras se piden como FUNCIÓN de `ahora`, no como arreglo, y por una razón:
 * algunas dependen del propio reloj (la próxima medianoche MX, que cambia justo al
 * cruzarla). Con un arreglo fijo, tras el primer cruce el timer se quedaría sin próxima
 * frontera y la pantalla se congelaría hasta la siguiente entrega reactiva. El efecto la
 * llama con el ESTIMADO fresco del ancla, así que además filtra contra el instante correcto.
 * La función debe venir MEMOIZADA (`useCallback`): el efecto depende de su identidad.
 */
export function useRelojAnclado(
  ahoraServidor: number,
  fronterasDe: (ahora: number) => readonly number[],
  tickMs?: number,
): number {
  const ancla = useRef<{ servidor: number; perf: number } | null>(null);
  const [ahora, setAhora] = useState(() => Math.floor(ahoraServidor));

  const tick = () => {
    const a = ancla.current;
    if (a) setAhora(Math.floor(a.servidor + (performance.now() - a.perf)));
  };

  useEffect(() => {
    ancla.current = { servidor: ahoraServidor, perf: performance.now() };
    const t = setTimeout(tick, 0);
    return () => clearTimeout(t);
  }, [ahoraServidor]);

  useEffect(() => {
    const a = ancla.current;
    const estimado = a
      ? Math.floor(a.servidor + (performance.now() - a.perf))
      : ahora;
    if (estimado - ahora > DERIVA_MAX_MS) {
      const t0 = setTimeout(tick, 0);
      return () => clearTimeout(t0);
    }

    const proximos = fronterasDe(estimado)
      .filter((f) => f > estimado)
      .map((f) => f + MARGEN_FRONTERA_MS);
    if (tickMs && tickMs > 0) {
      // Alineado al múltiplo: la cuenta regresiva cambia de cifra en el borde del
      // segundo, no en un instante arbitrario del montaje.
      proximos.push(estimado + tickMs - (estimado % tickMs));
    }
    if (proximos.length === 0) return;

    const retardo = Math.min(
      Math.max(Math.min(...proximos) - estimado, 0),
      CLAMP_TIMER_MS,
    );
    const t = setTimeout(tick, retardo);
    return () => clearTimeout(t);
  }, [ahora, fronterasDe, tickMs, ahoraServidor]);

  return ahora;
}
