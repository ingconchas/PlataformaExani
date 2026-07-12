/** Barra de progreso UNX — lineal con etiqueta o %, y variante con marcador de meta amarillo. */
export interface ProgressBarProps {
  value?: number;
  max?: number;
  /** Etiqueta izquierda, ej. "24 de 32 completaron" */
  label?: string;
  showPercent?: boolean;
  /** Valor de la meta (en la misma escala que max); pinta marcador amarillo */
  goal?: number;
  goalLabel?: string;
  color?: string;
  height?: number;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
