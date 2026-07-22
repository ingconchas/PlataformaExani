import { Loader2, Send, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Pantallas TERMINALES del simulacro (Diseño 25, celda 6): «Se acabó el tiempo» y
 * «Perdiste conexión». Ambas ocupan la pantalla completa —sin pie de navegación, sin
 * preguntas detrás— porque en las dos la alumna ya no puede seguir contestando.
 *
 * ⚠️ **`pendiente` separa «se acabó el tiempo» de «ya se entregó».** El copy del mock
 * («se envió automáticamente con tus respuestas guardadas») es una AFIRMACIÓN sobre el
 * servidor, y solo puede hacerse cuando el read-model lo confirma: el cierre durable es
 * garantizado, no instantáneo (el scheduler tiene su propio retraso). Mientras tanto se
 * dice lo que sí es cierto —«Estamos entregando tu examen»— y el CTA queda deshabilitado.
 *
 * `conError` no contradice lo anterior: el cierre durable sigue en pie, así que el mensaje
 * ofrece reintentar sin alarmar ni prometer.
 */
export function TerminalIntento({
  tipo,
  pregunta,
  ctaTexto,
  onCta,
  ctaHabilitado = true,
  pendiente = false,
  conError = false,
  onReintentar,
}: {
  tipo: "tiempo" | "conexion";
  /** Número 1-based de la pregunta en curso (solo la variante de conexión). */
  pregunta?: number;
  ctaTexto: string;
  onCta: () => void;
  ctaHabilitado?: boolean;
  /** El servidor todavía no confirma la entrega (solo la variante de tiempo). */
  pendiente?: boolean;
  conError?: boolean;
  onReintentar?: () => void;
}) {
  const esTiempo = tipo === "tiempo";
  return (
    <div
      className="flex min-h-screen items-center justify-center p-5"
      data-terminal={tipo}
      data-pendiente={pendiente ? "si" : "no"}
    >
      <Card className="flex w-full max-w-[390px] flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-unx-blue-tint text-unx-blue">
          {!esTiempo ? (
            <WifiOff className="size-[22px]" aria-hidden />
          ) : pendiente ? (
            <Loader2 className="size-[22px] animate-spin" aria-hidden />
          ) : (
            <Send className="size-[22px]" aria-hidden />
          )}
        </span>
        <h1 className="text-h3 font-semibold text-ink">
          {esTiempo ? "Se acabó el tiempo" : "Perdiste conexión"}
        </h1>
        <p className="text-small text-muted" role="status">
          {!esTiempo
            ? `Tu examen sigue corriendo en el servidor. Continúa en la pregunta ${pregunta ?? 1} con el tiempo real transcurrido.`
            : pendiente
              ? "Estamos entregando tu examen con tus respuestas guardadas…"
              : "Tu examen se envió automáticamente con tus respuestas guardadas."}
        </p>
        {conError && (
          <p className="text-small text-unx-orange-text">
            Está tardando más de lo normal. Tu examen no se pierde: sigue guardado en el
            servidor.
          </p>
        )}
        <Button
          className="w-full"
          onClick={onCta}
          disabled={!ctaHabilitado}
          data-terminal-cta
        >
          {ctaTexto}
        </Button>
        {conError && onReintentar && (
          <button
            type="button"
            onClick={onReintentar}
            className="text-small font-semibold text-unx-blue underline"
            data-terminal-reintentar
          >
            Reintentar la entrega
          </button>
        )}
      </Card>
    </div>
  );
}
