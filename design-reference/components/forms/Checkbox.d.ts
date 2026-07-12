/** Checkbox UNX de 20px con label. */
export interface CheckboxProps {
  label?: string;
  checked?: boolean;
  onChange?: (e: any) => void;
  disabled?: boolean;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
