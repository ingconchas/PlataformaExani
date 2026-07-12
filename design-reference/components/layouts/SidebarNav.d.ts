/** Elemento del menú lateral de staff. */
export interface SidebarNavItem {
  id: string;
  label: string;
  /** Nombre de icono del set interno: inicio | alumnos | grupos | permisos | temario | resumen | reactivos | examenes */
  icon?: string;
}

/** Barra lateral de navegación del panel institucional (256 px; colapsada 72 px solo iconos). */
export interface SidebarNavProps {
  /** Ruta del logotipo UNX; por defecto la copia del design system */
  logoSrc?: string;
  /** Nombre y rol mostrados bajo el logo, p. ej. { name: 'Mayra Torres', role: 'Administradora' } */
  user?: { name: string; role?: string };
  items?: SidebarNavItem[];
  /** id del elemento activo (fondo azul suave + barra indicadora) */
  activeId?: string;
  /** Variante tablet: solo iconos con menú hamburguesa */
  collapsed?: boolean;
  onNavigate?: (id: string) => void;
  onLogout?: () => void;
}
export declare function SidebarNav(props: SidebarNavProps): JSX.Element;
