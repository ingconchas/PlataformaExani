/** Modal de confirmación UNX — overlay + tarjeta radio 12px. */
export interface ModalProps {
  title?: string;
  children?: React.ReactNode;
  /** Botones de acción (nodos) alineados a la derecha */
  actions?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  /** true = position absolute (para previews dentro de un contenedor relative) */
  contained?: boolean;
}
export declare function Modal(props: ModalProps): JSX.Element;
