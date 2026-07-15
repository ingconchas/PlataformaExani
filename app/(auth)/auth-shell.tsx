import { type ReactNode } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";

/** Marco común de las pantallas de acceso: logo UNX + tarjeta + pie. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image
            src="/logo/unx-logo-completo.png"
            alt="UNX Simuladores"
            width={180}
            height={150}
            priority
          />
        </div>
        <Card>{children}</Card>
        <p className="mt-6 text-center text-caption text-muted">
          UNX · Preparación para tu examen de admisión · unx.mx
        </p>
      </div>
    </main>
  );
}
