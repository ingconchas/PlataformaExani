/** Tarjeta UNX: borde #E5E7EB + sombra sm, radio 10px. */
export interface CardProps {
  /** Título H3 opcional */
  title?: string;
  padding?: number | string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): JSX.Element;
