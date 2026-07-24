import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CardPendiente as CardPendienteDato, IntentoId } from "@/convex/misExamenes";
import { fechaHoraMx } from "@/convex/fechas";

/** «3 h · 90 preguntas» / «45 min · 24 preguntas» (Diseño 24). */
export function metaExamen(duracionMin: number, numReactivos: number): string {
  const h = Math.floor(duracionMin / 60);
  const m = duracionMin % 60;
  const tiempo = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
  return `${tiempo} · ${numReactivos} ${numReactivos === 1 ? "pregunta" : "preguntas"}`;
}

/**
 * La card del examen PENDIENTE, compartida por «Mis exámenes» (LUI-25) e Inicio (LUI-24):
 * ambas pintan «la ExamCard del próximo pendiente» del diseño, así que vive aquí para que la
 * alumna nunca vea dos versiones. El DOM (`data-pendiente`/`data-cta`/`data-deadline-urgente`
 * y clases) es IDÉNTICO al que `e2e:lui26` asierta.
 *
 * `ctaTexto` y `mostrarBadgePendiente` son aditivos para Inicio (que dice «Comenzar
 * simulacro» y marca «Pendiente»); «Mis exámenes» no cambia (usa los valores por defecto).
 */
export function CardPendiente({
  pendiente: p,
  ocupada,
  onComenzar,
  onContinuar,
  ctaTexto = "Comenzar",
  mostrarBadgePendiente = false,
}: {
  pendiente: CardPendienteDato;
  ocupada: string | null;
  onComenzar: () => void;
  onContinuar: (intentoId: IntentoId) => void;
  ctaTexto?: string;
  mostrarBadgePendiente?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-2" data-pendiente={p.asignacionId}>
      <div className="flex items-center gap-2">
        <Badge tone={p.esModulo ? "purple" : "neutral"}>{p.tipoEtiqueta}</Badge>
        {mostrarBadgePendiente && !p.enCurso && <Badge tone="yellow">Pendiente</Badge>}
        {p.enCurso && <Badge tone="blue">En curso</Badge>}
      </div>
      <h3 className="text-h3 text-ink">{p.titulo}</h3>
      <p className="text-small text-muted">{metaExamen(p.duracionMin, p.numReactivos)}</p>
      <p
        className={
          p.urgente
            ? "text-small font-semibold text-unx-orange-text"
            : "text-small text-muted"
        }
        data-deadline-urgente={p.urgente ? "si" : "no"}
      >
        {p.urgente
          ? `¡Cierra hoy a las ${fechaHoraMx(p.cierraEn).split(", ")[1]}!`
          : `Cierra el ${fechaHoraMx(p.cierraEn)}`}
      </p>
      {p.enCurso ? (
        <Button
          className="w-full"
          onClick={() => onContinuar(p.enCurso as IntentoId)}
          data-cta="continuar"
        >
          Continuar
        </Button>
      ) : (
        <Button
          className="w-full"
          disabled={ocupada === p.asignacionId}
          onClick={onComenzar}
          data-cta="comenzar"
        >
          {ctaTexto}
        </Button>
      )}
    </Card>
  );
}
