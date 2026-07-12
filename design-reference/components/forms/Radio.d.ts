/** Radio UNX de 20px con label; agrupar por `name`. */
export interface RadioProps {
  label?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  onChange?: (e: any) => void;
  disabled?: boolean;
}
export declare function Radio(props: RadioProps): JSX.Element;
