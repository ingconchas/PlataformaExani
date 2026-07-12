/**
 * Botón UNX. Un solo botón primario por vista; hover #021E9E; focus con anillo azul suave.
 * La variante danger es para acciones destructivas (hover #B91C1C, anillo rojo).
 * @startingPoint section="Formularios" subtitle="Primario, secundario, ghost y danger con estados" viewport="700x300"
 */
export interface ButtonProps {
  /** Variante visual */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** sm = 36px, md = 44px, lg = 48px */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
  /** Icono opcional (nodo SVG) a la izquierda del texto */
  icon?: React.ReactNode;
  onClick?: () => void;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
