/**
 * Encabezado del modo examen (móvil): sección + contador + temporizador.
 * Sin navegación ni forma de salir accidentalmente (regla del sistema).
 */
export function ExamHeader({
  seccion,
  actual,
  total,
  tiempo,
}: {
  seccion: string;
  actual: number;
  total: number;
  tiempo: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
      <div>
        <p className="font-condensed text-caption uppercase tracking-[0.06em] text-muted">
          {seccion}
        </p>
        <p className="text-small text-ink">
          <span className="font-condensed font-semibold">{actual}</span> de{" "}
          <span className="font-condensed">{total}</span>
        </p>
      </div>
      <div className="font-condensed text-h2 font-semibold text-ink">{tiempo}</div>
    </header>
  );
}
