/** Pestaña de la navegación inferior de la alumna. */
export interface BottomNavItem {
  id: string;
  label: string;
  /** Nombre de icono del set interno: inicio | examenes | historial | progreso */
  icon?: string;
}

/** Navegación inferior fija de la app de la alumna (4 pestañas; activa en azul UNX). */
export interface BottomNavProps {
  items?: BottomNavItem[];
  activeId?: string;
  onNavigate?: (id: string) => void;
}
export declare function BottomNav(props: BottomNavProps): JSX.Element;
