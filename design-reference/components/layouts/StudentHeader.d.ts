/** Encabezado de la app de la alumna: saludo + chip de racha + avatar. */
export interface StudentHeaderProps {
  /** Nombre de pila para el saludo "¡Hola, {name}!" */
  name?: string;
  /** Línea secundaria opcional bajo el saludo */
  message?: string;
  /** Días de racha; 0 oculta el chip */
  streakDays?: number;
  onProfile?: () => void;
}
export declare function StudentHeader(props: StudentHeaderProps): JSX.Element;
