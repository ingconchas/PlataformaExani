import {
  Home,
  Users,
  Layers,
  Shield,
  BookOpen,
  ClipboardList,
  FileQuestion,
  FileCheck,
  History,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };

/** Panel institucional — menú de la Administradora (UNX Design System §Layouts). */
export const adminNav: NavItem[] = [
  { label: "Inicio", href: "/admin", icon: Home },
  { label: "Alumnos", href: "/admin/alumnos", icon: Users },
  { label: "Grupos", href: "/admin/grupos", icon: Layers },
  { label: "Usuarios y permisos", href: "/admin/usuarios", icon: Shield },
  { label: "Temario", href: "/admin/temario", icon: BookOpen },
  { label: "Resumen de exámenes", href: "/admin/examenes", icon: ClipboardList },
];

/** Panel institucional — menú del Instructor. */
export const instructorNav: NavItem[] = [
  { label: "Inicio", href: "/instructor", icon: Home },
  { label: "Banco de reactivos", href: "/instructor/reactivos", icon: FileQuestion },
  { label: "Exámenes", href: "/instructor/examenes", icon: FileCheck },
];

/** App de la alumna — navegación inferior de 4 pestañas. */
export const alumnaTabs: NavItem[] = [
  { label: "Inicio", href: "/inicio", icon: Home },
  { label: "Mis exámenes", href: "/examenes", icon: FileCheck },
  { label: "Historial", href: "/historial", icon: History },
  { label: "Progreso", href: "/progreso", icon: TrendingUp },
];
