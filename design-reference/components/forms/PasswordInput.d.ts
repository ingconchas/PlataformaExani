/** Campo de contraseña UNX con botón mostrar/ocultar. */
export interface PasswordInputProps {
  label?: string;
  id?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: any) => void;
  error?: string;
  disabled?: boolean;
}
export declare function PasswordInput(props: PasswordInputProps): JSX.Element;
