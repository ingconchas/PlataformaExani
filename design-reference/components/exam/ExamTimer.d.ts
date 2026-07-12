/** Temporizador de examen UNX — Barlow Condensed tabular-nums; alerta naranja en los últimos 5 min. */
export interface ExamTimerProps {
  /** Tiempo restante formateado, ej. "01:47:32" */
  time?: string;
  /** true = fondo naranja #D64801 con texto blanco */
  alert?: boolean;
}
export declare function ExamTimer(props: ExamTimerProps): JSX.Element;
