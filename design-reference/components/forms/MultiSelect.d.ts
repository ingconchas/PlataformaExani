/** Multiselect UNX con chips removibles y lista desplegable. */
export interface MultiSelectProps {
  label?: string;
  options?: { value: string; label: string }[];
  /** Valores seleccionados */
  value?: string[];
  onChange?: (next: string[]) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  /** Solo para previews: abre la lista al montar */
  defaultOpen?: boolean;
}
export declare function MultiSelect(props: MultiSelectProps): JSX.Element;
