/** Gráfica de línea UNX (SVG) — series múltiples, meta punteada amarilla, leyenda interactiva y tooltip. */
export interface LineChartSeries {
  label: string;
  color: string;
  points: number[];
}
export interface LineChartProps {
  series?: LineChartSeries[];
  xLabels?: string[];
  yMin?: number;
  yMax?: number;
  /** Valor de la meta; dibuja línea punteada amarilla con etiqueta */
  goal?: number;
  goalLabel?: string;
  width?: number;
  height?: number;
  /** Tooltip de ejemplo anclado a un punto: {series, index, text} */
  tooltip?: { series: number; index: number; text: string };
}
export declare function LineChart(props: LineChartProps): JSX.Element;
