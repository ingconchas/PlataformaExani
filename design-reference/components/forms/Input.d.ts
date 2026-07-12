/** Campo de texto UNX con label, texto de ayuda y estado de error accesible (icono + mensaje, nunca solo color). */
export interface InputProps {
  label?: string;
  id?: string;
  /** Tipo nativo del input: text, email, number, date, time, datetime-local… */
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: any) => void;
  /** Texto de ayuda bajo el campo (se oculta cuando hay error) */
  helpText?: string;
  /** Mensaje de error; al definirse muestra borde rojo + icono + texto */
  error?: string;
  disabled?: boolean;
}
export declare function Input(props: InputProps): JSX.Element;
