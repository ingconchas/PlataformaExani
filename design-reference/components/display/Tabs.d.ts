/** Tabs con subrayado azul en la pestaña activa. */
export interface TabsProps {
  tabs?: { id: string; label: string }[];
  activeId?: string;
  onChange?: (id: string) => void;
}
export declare function Tabs(props: TabsProps): JSX.Element;
