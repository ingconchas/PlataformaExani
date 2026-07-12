/** Toast UNX — notificación breve con icono; éxito, error o información. */
export interface ToastProps {
  variant?: 'success' | 'error' | 'info';
  children?: React.ReactNode;
  onClose?: () => void;
}
export declare function Toast(props: ToastProps): JSX.Element;
