/** Encabezado mínimo del modo examen: sección + contador + temporizador. */
export interface ExamHeaderProps {
  /** Nombre de la sección en curso, p. ej. "Pensamiento matemático" */
  section?: string;
  /** Número de pregunta actual (contador "current de total") */
  current?: number;
  total?: number;
  /** Tiempo restante "HH:MM:SS" */
  time?: string;
  /** Últimos 5 minutos: temporizador naranja con texto blanco */
  alert?: boolean;
}
export declare function ExamHeader(props: ExamHeaderProps): JSX.Element;
