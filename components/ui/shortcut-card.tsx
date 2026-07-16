import { type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Tone, tones } from "./tones";

/**
 * Tarjeta de acceso directo: chip de icono con color, título, descripción y
 * chevron; toda la tarjeta es clicable.
 *
 * Porta `design-reference/components/display/ShortcutCard.jsx` con **dos
 * desviaciones deliberadas** respecto al componente de referencia:
 *
 * 1. **Es un `<a>` (next/link), no un `<button onClick>`.** Los accesos directos
 *    NAVEGAN. El `.jsx` del design system usa `onClick` solo porque la pantalla de
 *    referencia es una demo sin router (`onNavigate={setActive}`); lo que se porta
 *    es el contrato *visual*, no el elemento. Un `<button>` que navega se anuncia
 *    como «botón» al lector de pantalla —promesa equivocada: los botones actúan,
 *    los enlaces van— y saca las tarjetas de la lista de enlaces, justo donde
 *    alguien busca «accesos directos». Además rompe ⌘/Ctrl-clic, clic central,
 *    «copiar dirección del enlace» y la previsualización del destino al hacer
 *    hover. Con `<Link>`, Next además prefetchea los destinos.
 * 2. **El hover va en CSS (`group-hover`), no en `useState`** → el componente se
 *    queda como Server Component y no hidrata estado.
 */
export function ShortcutCard({
  title,
  description,
  href,
  icon,
  tone = "blue",
}: {
  title: string;
  description?: string;
  href: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      className="group flex w-full items-center gap-3.5 rounded-card border border-border bg-surface p-5 text-left shadow-card transition-[border-color,box-shadow] hover:border-unx-blue hover:shadow-modal"
    >
      {icon && (
        <span
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-[10px]",
            tones[tone],
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-body font-semibold text-ink">{title}</span>
        {description && (
          <span className="text-small text-muted">{description}</span>
        )}
      </span>
      <ChevronRight
        className="size-5 shrink-0 text-muted transition-colors group-hover:text-unx-blue"
        aria-hidden
      />
    </Link>
  );
}
