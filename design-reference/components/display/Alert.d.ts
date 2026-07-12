/** Banner de aviso con icono obligatorio. */
export interface AlertProps {
  variant?: 'error' | 'info' | 'success' | 'warning';
  children?: React.ReactNode;
}
export declare function Alert(props: AlertProps): JSX.Element;
