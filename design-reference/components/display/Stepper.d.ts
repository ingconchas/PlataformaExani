/** Stepper UNX — completados con check, actual azul sólido, futuros gris. */
export interface StepperProps {
  /** Etiquetas de los pasos en orden */
  steps?: string[];
  /** Índice (0-based) del paso actual */
  current?: number;
}
export declare function Stepper(props: StepperProps): JSX.Element;
