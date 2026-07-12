"use client";

import { type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

// El cliente solo se crea si ya existe la URL de Convex. Así la app compila y
// corre igual ANTES de conectar la base de datos (`npx convex dev` genera la
// URL). En cuanto NEXT_PUBLIC_CONVEX_URL está definida, el proveedor se activa.
//
// Cuando se active la autenticación (Convex Auth · LUI-8/LUI-103), este
// proveedor se cambia por <ConvexAuthNextjsProvider> — ver README.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
