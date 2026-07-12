/** Opción de respuesta UNX (radio card A-D) para el examen y la revisión. */
export interface AnswerOptionProps {
  letter?: string;
  children?: React.ReactNode;
  /** normal | selected (borde azul) | correct (verde + check) | incorrect (rojo + X) */
  state?: 'normal' | 'selected' | 'correct' | 'incorrect';
  /** Etiqueta derecha; default "Respuesta correcta" / "Tu respuesta" según estado */
  tagText?: string;
  onSelect?: () => void;
}
export declare function AnswerOption(props: AnswerOptionProps): JSX.Element;
