/** Buscador UNX con icono de lupa. */
export interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (e: any) => void;
  disabled?: boolean;
  fullWidth?: boolean;
}
export declare function SearchInput(props: SearchInputProps): JSX.Element;
