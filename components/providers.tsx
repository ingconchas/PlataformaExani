"use client";

import { type ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";

// El cliente solo se crea si existe la URL de Convex. Desde LUI-7 la auth requiere
// la URL en runtime (ver app/layout.tsx); sin ella, la app cae a las páginas-guardia
// sin sesión (resiliencia para clonar el repo sin .env.local).
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
