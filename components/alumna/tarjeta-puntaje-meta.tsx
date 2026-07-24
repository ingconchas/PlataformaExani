import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  badgeDeMeta,
  compararConMeta,
  etiquetaDelta,
  type MetaAlumna,
} from "@/convex/metaAlumna";
import { PUNTAJE_BASE, PUNTAJE_MAX, redondearPuntaje } from "@/convex/simulacro";
import { cn } from "@/lib/utils";

/**
 * La tarjeta «puntaje vs meta» (Diseño 26). Vive en `components/alumna/` y no dentro de la
 * pantalla de Resultados porque es COMPARTIDA: LUI-28 la usa con el puntaje del intento
 * recién enviado y LUI-24 la usará con el del diagnóstico más reciente. Dos copias
 * divergirían el día que alguien ajuste el copy del delta en una sola.
 *
 * TODO lo que se ve sale de `compararConMeta`, que recibe el puntaje CRUDO y redondea
 * dentro: el número grande, la barra, el badge y el delta son el mismo valor visto de cuatro
 * formas, así que no pueden contradecirse (un «1147» junto a «A 1 punto de tu meta» es
 * exactamente el bug que ese embudo previene).
 *
 * Tres estados, los tres diseñados:
 *  · **sin calificar** (`puntajeCrudo === null`) — el intento se registró pero no pudo
 *    calificarse (examen sin reactivos vivos); se dice, no se inventa un 700.
 *  · **sin meta** — la alumna aún no la fijó (estado 1 del perfil). Sin barra ni delta, con
 *    la invitación a ponerla. Es ALCANZABLE hoy: mientras no exista el onboarding (LUI-23)
 *    es el estado inicial de toda alumna nueva.
 *  · **con meta** — barra con marcador, o variante verde si ya la alcanzó.
 */
export function TarjetaPuntajeMeta({
  caption,
  puntajeCrudo,
  meta,
  nombre,
  mostrarMeta = true,
  pie,
  tamanoPuntaje = 56,
}: {
  /** «{examen} — primer intento» / «— repaso 2». */
  caption: string;
  /** EXACTO como lo guardó el servidor; el redondeo ocurre aquí dentro. */
  puntajeCrudo: number | null;
  meta: MetaAlumna | null;
  /** Nombre corto para el copy del delta. */
  nombre: string;
  /** `false` en un repaso: su resultado no se compara con la meta (el oficial es el del
   *  diagnóstico), así que la barra sobra y confundiría. */
  mostrarMeta?: boolean;
  /** Caption al pie de la card («{carrera} — {institución}» del Diseño 23). Aditivo. */
  pie?: string;
  /** Tamaño del número grande: 48 px en Inicio (Diseño 23), 56 px en Resultados (Diseño 26,
   *  el default para no tocar su call site). */
  tamanoPuntaje?: 48 | 56;
}) {
  const claseNumero =
    tamanoPuntaje === 48
      ? "text-[48px] leading-[52px]"
      : "text-[56px] leading-[58px]";
  if (puntajeCrudo === null) {
    return (
      <Card>
        <p className="text-caption text-muted">{caption}</p>
        <p className="mt-2 text-body text-ink">
          Tu examen se registró, pero no pudo calificarse.
        </p>
        {pie && <p className="mt-2 text-caption text-muted" data-pie-meta>{pie}</p>}
      </Card>
    );
  }

  const comparacion = meta ? compararConMeta(puntajeCrudo, meta.puntaje) : null;
  const conMeta = mostrarMeta && comparacion !== null && meta !== null;
  const celebra = conMeta && comparacion.alcanzada;
  const badge = conMeta ? badgeDeMeta(comparacion) : null;
  const delta = conMeta ? etiquetaDelta(comparacion, nombre) : null;

  return (
    <Card className={cn(celebra && "text-center")} data-tarjeta-puntaje>
      <p className="text-caption text-muted">{caption}</p>
      <p
        className={cn(
          "font-condensed mt-1 font-semibold tabular-nums",
          claseNumero,
          celebra ? "text-unx-green" : "text-ink",
        )}
        data-resultado-puntaje
      >
        {redondearPuntaje(puntajeCrudo)}
      </p>
      <p className="text-caption text-muted">
        escala {PUNTAJE_BASE}–{PUNTAJE_MAX}
      </p>

      {conMeta && !celebra && (
        <>
          <ProgressBar
            className="mt-3"
            label="Tu avance hacia la meta"
            value={comparacion.valorBarra}
            max={comparacion.maxBarra}
            goal={comparacion.metaBarra}
            goalLabel={`Meta ${meta.puntaje}`}
          />
          {delta && (
            <p className="mt-2.5 text-small font-semibold text-unx-green" data-delta-meta>
              {delta}
            </p>
          )}
        </>
      )}

      {celebra && badge && (
        <>
          <div className="mt-2">
            <Badge tone="green" data-badge-meta>
              {badge}
            </Badge>
          </div>
          <p className="mt-3 text-small text-text" data-copy-meta>
            Tu meta era {meta.puntaje} y lograste{" "}
            {redondearPuntaje(puntajeCrudo)}. Así se ve el camino a {meta.carrera},{" "}
            {nombre}.
          </p>
        </>
      )}

      {mostrarMeta && meta === null && (
        <p className="mt-3 text-small text-muted" data-sin-meta>
          Aún no defines tu meta.{" "}
          <Link href="/perfil" className="font-semibold text-unx-blue underline">
            Pon tu meta
          </Link>{" "}
          para ver qué tan cerca estás.
        </p>
      )}

      {pie && <p className="mt-3 text-caption text-muted" data-pie-meta>{pie}</p>}
    </Card>
  );
}
