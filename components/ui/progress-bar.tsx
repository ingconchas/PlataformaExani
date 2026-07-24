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
 *
 * ── MARCADOR DE META (LUI-28/LUI-36) ──
 * `goal` dibuja una línea vertical sobre la pista. Es OPCIONAL: los call sites
 * anteriores (LUI-19) no cambian. La marca NUNCA es el único canal — `goalLabel`
 * («Meta 1150») entra en el texto accesible de la barra, así que quien no ve la
 * línea recibe el mismo dato. Una meta fuera de la pista se ACOTA en vez de
 * desbordar el contenedor.
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = "blue",
  goal,
  goalLabel,
  trailing,
  className,
}: {
  value: number;
  max: number;
  /** OBLIGATORIA: es el único nombre accesible del progressbar (y el texto que
   *  hace que el color nunca sea el único canal). Una barra sin nombre no debe
   *  poder escribirse. */
  label: string;
  tone?: Tone;
  /** Posición de la meta EN LAS MISMAS UNIDADES que `value`/`max`. */
  goal?: number;
  /** Texto de la meta. Obligatorio en la práctica cuando hay `goal`: sin él, la
   *  línea sería información disponible solo para quien la ve. */
  goalLabel?: string;
  /** Cifra al extremo derecho de la etiqueta («17 de 30»). Distinta de `goalLabel`
   *  a propósito: aquélla describe la MARCA, ésta describe el VALOR. Ambas entran
   *  en el nombre accesible. */
  trailing?: string;
  className?: string;
}) {
  const medible = max > 0;
  const acotado = medible ? Math.min(max, Math.max(0, value)) : 0;
  const pct = medible ? (acotado / max) * 100 : 0;
  const hayMeta = medible && goal !== undefined && Number.isFinite(goal);
  const metaAcotada = hayMeta ? Math.min(max, Math.max(0, goal)) : 0;
  const pctMeta = hayMeta ? (metaAcotada / max) * 100 : 0;
  const textoAccesible = [label, trailing, goalLabel].filter(Boolean).join(" · ");
  return (
    <div className={className}>
      <p className="mb-1 flex items-baseline justify-between gap-2 text-small text-text">
        <span>{label}</span>
        {(trailing ?? goalLabel) && (
          <span
            className={cn(
              "tabular-nums",
              trailing
                ? "text-small font-semibold text-ink"
                : "text-caption text-muted",
            )}
            data-meta-etiqueta={goalLabel && !trailing ? "" : undefined}
          >
            {trailing ?? goalLabel}
          </span>
        )}
      </p>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-border"
        {...(medible
          ? {
              role: "progressbar",
              "aria-valuemin": 0,
              "aria-valuemax": max,
              "aria-valuenow": acotado,
              "aria-label": textoAccesible,
            }
          : {})}
      >
        <div
          className={cn("h-full rounded-full", tones[tone])}
          style={{ width: `${pct}%` }}
        />
        {hayMeta && (
          <span
            aria-hidden
            data-meta-marcador
            className="absolute top-0 h-full w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: `${pctMeta}%` }}
          />
        )}
      </div>
    </div>
  );
}
