/** Breadcrumb UNX — el último elemento es la página actual. */
export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}
export interface BreadcrumbProps {
  items?: BreadcrumbItem[];
}
export declare function Breadcrumb(props: BreadcrumbProps): JSX.Element;
