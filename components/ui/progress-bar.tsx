import { cn } from "@/lib/utils";

type Tone = "blue" | "green" | "orange";

// Clases COMPLETAS (el JIT de Tailwind v4 no ve nombres concatenados). El
// relleno usa el color PLENO (`unx-orange` está permitido en rellenos e iconos;
// el texto naranja sería `unx-orange-text`, que aquí no se usa).
const tones: Record<Tone, string> = {
  blue: "bg-unx-blue",
  green: "bg-unx-green",
  orange: "bg-unx-orange",
};

/**
 * Barra de progreso (porte del design-reference para LUI-19; molde de clases del
 * medidor del constructor). El TONO llega decidido por el caller — el umbral de
 * participación es negocio y vive en `convex/participacion.tonoParticipacion`,
 * no aquí (presentación pura). La etiqueta lleva las cifras («{Grupo} · X de Y
 * completaron»): el color jamás es el único canal (regla del sistema).
 *
 * ARIA solo cuando hay algo que medir: con `max <= 0` un rango
 * `aria-valuemin=0 / aria-valuemax=0` es INVÁLIDO, así que se omiten `role` y
 * `aria-value*` y el texto de la etiqueta carga la información. `pct` y
 * `aria-valuenow` van acotados por AMBOS lados (0 ≤ valor ≤ max).
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = "blue",
  className,
}: {
  value: number;
  max: number;
  /** OBLIGATORIA: es el único nombre accesible del progressbar (y el texto que
   *  hace que el color nunca sea el único canal). Una barra sin nombre no debe
   *  poder escribirse. */
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const medible = max > 0;
  const acotado = medible ? Math.min(max, Math.max(0, value)) : 0;
  const pct = medible ? (acotado / max) * 100 : 0;
  return (
    <div className={className}>
      <p className="mb-1 text-small text-text">{label}</p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        {...(medible
          ? {
              role: "progressbar",
              "aria-valuemin": 0,
              "aria-valuemax": max,
              "aria-valuenow": acotado,
              "aria-label": label,
            }
          : {})}
      >
        <div
          className={cn("h-full rounded-full", tones[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
