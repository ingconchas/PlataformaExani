/** Tarjeta de acceso directo UNX — icono, título, descripción y flecha; clicable completa. */
export interface ShortcutCardProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  /** Color del icono (default azul UNX) */
  accent?: string;
  /** Fondo del recuadro del icono (default tinte azul); usa el tinte que combine con `accent` */
  tint?: string;
}
export declare function ShortcutCard(props: ShortcutCardProps): JSX.Element;
