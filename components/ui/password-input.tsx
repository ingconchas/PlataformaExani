"use client";

import { type InputHTMLAttributes, forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/** Input de contraseña con toggle mostrar/ocultar (extraído del login). */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={ver ? "text" : "password"}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        type="button"
        aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        onClick={() => setVer((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
      >
        {ver ? (
          <EyeOff className="size-[18px]" aria-hidden />
        ) : (
          <Eye className="size-[18px]" aria-hidden />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
