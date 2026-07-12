/** Área de texto UNX con label, texto de ayuda y error accesible. */
export interface TextareaProps {
  label?: string;
  id?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: any) => void;
  rows?: number;
  helpText?: string;
  error?: string;
  disabled?: boolean;
}
export declare function Textarea(props: TextareaProps): JSX.Element;
