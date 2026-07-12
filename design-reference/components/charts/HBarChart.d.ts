/** Barras horizontales UNX por área temática; las áreas a reforzar en naranja con etiqueta. */
export interface HBarChartItem {
  label: string;
  /** 0-100 */
  value: number;
  /** Texto mostrado a la derecha (default "value%"), ej. "22 de 30" */
  display?: string;
  /** true = barra naranja + etiqueta de refuerzo */
  highlight?: boolean;
}
export interface HBarChartProps {
  data?: HBarChartItem[];
  highlightTag?: string;
  width?: number;
}
export declare function HBarChart(props: HBarChartProps): JSX.Element;
