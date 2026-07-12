/** Insignia circular de logro (obtenida a color / bloqueada en gris). */
export interface AchievementBadgeProps {
  locked?: boolean;
  /** Diámetro en px */
  size?: number;
  /** Etiqueta bajo la insignia */
  label?: string;
}
export declare function AchievementBadge(props: AchievementBadgeProps): JSX.Element;
