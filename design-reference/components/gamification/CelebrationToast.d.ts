/** Toast de celebración UNX — sticker del manual (estrella, corazón o cursor) + mensaje de logro. */
export interface CelebrationToastProps {
  sticker?: 'estrella' | 'corazon' | 'cursor';
  title?: string;
  children?: React.ReactNode;
  onClose?: () => void;
}
export declare function CelebrationToast(props: CelebrationToastProps): JSX.Element;
