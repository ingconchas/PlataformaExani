/** Select UNX con label y error accesible. */
export interface SelectProps {
  label?: string;
  id?: string;
  options?: { value: string; label: string }[];
  value?: string;
  onChange?: (e: any) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}
export declare function Select(props: SelectProps): JSX.Element;
