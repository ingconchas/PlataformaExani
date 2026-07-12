/** Badge pill UNX en MAYÚSCULAS (Condensed 600). */
export interface BadgeProps {
  /** info (azul sólido), info-soft, success, warning, review (morado), achievement (amarillo), neutral */
  variant?: 'info' | 'info-soft' | 'success' | 'warning' | 'review' | 'achievement' | 'neutral';
  children?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
