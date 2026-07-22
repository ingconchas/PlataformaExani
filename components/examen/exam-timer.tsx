import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cronómetro del modo examen (Diseño 25): chip con reloj y cuenta regresiva en cifras
 * condensadas tabulares. En los últimos 5 minutos pasa a naranja pleno con texto blanco.
 *
 * ⚠️ **`aria-live="off"` SIEMPRE**, divergencia DELIBERADA del mock (que lo pone
 * `assertive` en alerta): con la cuenta actualizándose cada segundo, un lector de pantalla
 * anunciaría «cero cero cero cuatro cincuenta y nueve… cero cero cero cuatro cincuenta y
 * ocho…» sin parar, tapando el examen. El umbral se anuncia UNA sola vez con el banner
 * «Quedan 5 minutos» (`role="status"`), que es lo que la alumna necesita oír; el chip
 * conserva `role="timer"` para que se pueda consultar a voluntad. Divergencia registrada en
 * LUI-26.
 *
 * El color no es el único canal: el texto del banner acompaña siempre al cambio de tono.
 */
export function ExamTimer({
  tiempo,
  alerta = false,
  className,
}: {
  tiempo: string;
  alerta?: boolean;
  className?: string;
}) {
  return (
    <span
      role="timer"
      aria-live="off"
      data-alerta={alerta ? "si" : "no"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 font-condensed text-[18px] font-semibold leading-[22px] tracking-[0.03em] tabular-nums transition-colors duration-150",
        alerta
          ? "bg-unx-orange text-white"
          : "border-[1.5px] border-border-strong bg-surface text-ink",
        className,
      )}
    >
      <Clock className="size-[17px]" aria-hidden />
      {tiempo}
    </span>
  );
}
