/** Medidor de dificultad de 3 niveles (verde/amarillo/naranja) con etiqueta. */
export interface DifficultyMeterProps {
  level?: 'facil' | 'medio' | 'dificil';
  /** La etiqueta de texto acompaña siempre al color por accesibilidad */
  showLabel?: boolean;
  /** chip (tablas y tarjetas compactas) o card (tarjetas de examen, más grande) */
  size?: 'chip' | 'card';
}
export declare function DifficultyMeter(props: DifficultyMeterProps): JSX.Element;
