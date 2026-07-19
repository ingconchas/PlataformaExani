import {
  Home,
  Users,
  Layers,
  Shield,
  BookOpen,
  BookText,
  ClipboardList,
  FileQuestion,
  FileCheck,
  History,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { type Tone } from "@/components/ui/tones";

export type NavItem = { label: string; href: string; icon: LucideIcon };

/** Panel institucional — menú de la Administradora (UNX Design System §Layouts). */
export const adminNav: NavItem[] = [
  { label: "Inicio", href: "/admin", icon: Home },
  { label: "Alumnos", href: "/admin/alumnos", icon: Users },
  { label: "Grupos", href: "/admin/grupos", icon: Layers },
  { label: "Usuarios y permisos", href: "/admin/usuarios", icon: Shield },
  { label: "Temario", href: "/admin/temario", icon: BookOpen },
  { label: "Banco de reactivos", href: "/admin/reactivos", icon: FileQuestion },
  { label: "Lecturas", href: "/admin/lecturas", icon: BookText },
  { label: "Resumen de exámenes", href: "/admin/examenes", icon: ClipboardList },
];
// ⚠️ «Banco de reactivos» y «Lecturas» van en el menú pero NO en `EXTRAS_SHORTCUT`: los
// accesos directos del panel (LUI-9) se derivan por `flatMap` y `e2e-lui9` aserta que son
// EXACTAMENTE 5. Una entrada de shortcut aquí los volvería 6 y rompería esa prueba.

export type ShortcutItem = NavItem & { description: string; tone: Tone };

/**
 * Copy y tonos de los accesos directos del panel de la administradora (LUI-9),
 * verbatim de `design-reference/screens/06-panel-admin.html`. Solo vive aquí lo
 * que es PROPIO del panel; el label, el href y el icono se derivan de `adminNav`.
 *
 * Por qué no meter `description` en `NavItem`: lo consumen `SidebarNav`,
 * `BottomNav`, `instructorNav` y `alumnaTabs` — ninguno la quiere, y su sola
 * presencia invitaría a pintarla en la barra lateral.
 */
const EXTRAS_SHORTCUT: Record<string, { description: string; tone: Tone }> = {
  "/admin/alumnos": { description: "Alta, baja y edición", tone: "blue" },
  "/admin/grupos": { description: "Ciclos, turnos e instructores", tone: "green" },
  "/admin/usuarios": { description: "Cuentas del staff", tone: "purple" },
  "/admin/temario": { description: "Catálogo de contenidos", tone: "yellow" },
  "/admin/examenes": { description: "Resultados por grupo", tone: "blue" },
};

/**
 * Accesos directos del panel de la administradora (LUI-9). Se DERIVAN de
 * `adminNav`: label, href e icono tienen UNA sola fuente — el issue exige labels
 * idénticos a los del menú lateral, y así renombrar una sección los mantiene en
 * sincronía sin que nadie se acuerde de hacerlo.
 *
 * El `flatMap` es intencional y va en vez de un `slice(1)`: es a prueba de índices,
 * y una entrada nueva de `adminNav` sin copy aquí simplemente NO se vuelve acceso
 * directo, en lugar de aparecer con la descripción vacía.
 */
export const adminShortcuts: ShortcutItem[] = adminNav.flatMap((item) => {
  const extra = EXTRAS_SHORTCUT[item.href];
  return extra ? [{ ...item, ...extra }] : [];
});

/** Panel institucional — menú del Instructor. */
export const instructorNav: NavItem[] = [
  { label: "Inicio", href: "/instructor", icon: Home },
  { label: "Banco de reactivos", href: "/instructor/reactivos", icon: FileQuestion },
  { label: "Lecturas", href: "/instructor/lecturas", icon: BookText },
  { label: "Exámenes", href: "/instructor/examenes", icon: FileCheck },
];

/** App de la alumna — navegación inferior de 4 pestañas. */
export const alumnaTabs: NavItem[] = [
  { label: "Inicio", href: "/inicio", icon: Home },
  { label: "Mis exámenes", href: "/examenes", icon: FileCheck },
  { label: "Historial", href: "/historial", icon: History },
  { label: "Progreso", href: "/progreso", icon: TrendingUp },
];
