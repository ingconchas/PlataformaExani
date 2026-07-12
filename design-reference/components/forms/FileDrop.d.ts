/** Zona de carga de archivo UNX (arrastrar y soltar), pensada para el CSV de alumnos. */
export interface FileDropProps {
  label?: string;
  /** Tipos aceptados, ej. ".csv" */
  accept?: string;
  hint?: string;
  buttonText?: string;
  /** Nombre del archivo ya elegido (muestra check verde) */
  fileName?: string;
  onFile?: (file: File) => void;
  disabled?: boolean;
}
export declare function FileDrop(props: FileDropProps): JSX.Element;
