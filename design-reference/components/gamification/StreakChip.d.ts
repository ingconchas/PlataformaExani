/** Chip de racha de práctica con flama. */
export interface StreakChipProps {
  /** Días consecutivos; genera "N DÍAS SEGUIDOS" */
  days?: number;
  /** Texto alternativo que reemplaza al generado */
  label?: string;
}
export declare function StreakChip(props: StreakChipProps): JSX.Element;
