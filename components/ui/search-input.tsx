import { type InputHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & { fullWidth?: boolean };

/** Buscador con icono de lupa. Controlado vía `value`/`onChange`. */
export function SearchInput({ className, fullWidth = false, ...props }: SearchInputProps) {
  return (
    <div className={cn("relative inline-flex", fullWidth ? "w-full" : "w-[280px]")}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        type="search"
        className={cn(
          "h-11 w-full rounded-control border-[1.5px] border-border-strong bg-surface pl-11 pr-3.5 text-body text-ink transition-colors",
          "placeholder:text-muted focus:border-unx-blue",
          className,
        )}
        {...props}
      />
    </div>
  );
}
