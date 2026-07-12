/** Encabezado de página del panel institucional: título + acción primaria azul. */
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Etiqueta del botón primario; si se omite no se muestra botón */
  actionLabel?: string;
  onAction?: () => void;
  /** Controles extra (filtros, buscador) a la izquierda del botón */
  children?: React.ReactNode;
}
export declare function PageHeader(props: PageHeaderProps): JSX.Element;
