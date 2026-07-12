/** Tarjeta de métrica UNX — número grande en Barlow Condensed + etiqueta + icono. */
export interface MetricCardProps {
  value?: React.ReactNode;
  label?: string;
  icon?: React.ReactNode;
  /** Color del icono (default azul UNX) */
  accent?: string;
  /** Fondo del recuadro del icono (default tinte azul); usa el tinte que combine con `accent` */
  tint?: string;
}
export declare function MetricCard(props: MetricCardProps): JSX.Element;
