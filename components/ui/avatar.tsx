import { cn } from "@/lib/utils";

// Paleta de tintes de marca; el color se asigna de forma determinista por nombre
// para que instructores distintos se distingan (y el mismo siempre igual).
const TONES = [
  "bg-unx-blue-tint text-unx-blue",
  "bg-unx-green-tint text-unx-green",
  "bg-unx-purple-tint text-unx-purple",
  "bg-unx-orange-tint text-unx-orange-text",
] as const;

function iniciales(nombre: string): string {
  const partes = nombre.split(/\s+/).filter(Boolean);
  return (
    partes
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function tonePorNombre(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

/** Avatar de iniciales con color de marca determinista por nombre. */
export function Avatar({
  nombre,
  size = 28,
  ring = false,
  className,
}: {
  nombre: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      title={nombre}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        tonePorNombre(nombre),
        ring && "ring-2 ring-surface",
        className,
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}

/** Avatares apilados (−6px, anillo blanco). Colapsa el excedente en «+N». */
export function AvatarGroup({
  nombres,
  max = 4,
}: {
  nombres: string[];
  max?: number;
}) {
  const visibles = nombres.slice(0, max);
  const resto = nombres.length - visibles.length;
  return (
    <span className="inline-flex items-center">
      {visibles.map((n, i) => (
        <span key={i} className={i === 0 ? "" : "-ml-1.5"}>
          <Avatar nombre={n} ring />
        </span>
      ))}
      {resto > 0 && (
        <span
          style={{ width: 28, height: 28 }}
          className="-ml-1.5 inline-flex shrink-0 items-center justify-center rounded-full bg-disabled-bg text-[11px] font-semibold text-muted ring-2 ring-surface"
        >
          +{resto}
        </span>
      )}
    </span>
  );
}
