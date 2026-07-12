/** Avatar UNX de iniciales, con variante de menú de usuario (nombre + rol + chevron). */
export interface AvatarProps {
  name?: string;
  role?: string;
  /** Diámetro en px */
  size?: number;
  showMenu?: boolean;
  onClick?: () => void;
}
export declare function Avatar(props: AvatarProps): JSX.Element;
