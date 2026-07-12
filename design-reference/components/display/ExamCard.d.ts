/** Tarjeta de examen UNX — nombre, meta, fecha límite, badge de estado y CTA. */
export interface ExamCardProps {
  name?: string;
  /** Línea de contexto, ej. "90 preguntas · 3 h" */
  meta?: string;
  /** Fecha límite, ej. "Cierra el 12 de julio, 23:59" (naranja; urgente = rojo) */
  deadline?: string;
  deadlineUrgent?: boolean;
  status?: 'pendiente' | 'completado' | 'repaso' | 'cerrado';
  ctaText?: string;
  onCta?: () => void;
  /** Puntaje del primer intento (para completados) */
  score?: number | string;
}
export declare function ExamCard(props: ExamCardProps): JSX.Element;
