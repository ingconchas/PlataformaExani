# Backend Convex — Plataforma Exani II

Esta carpeta es el backend (base de datos + funciones) que corre en Convex Cloud.
El frontend Next.js se conecta a él mediante `NEXT_PUBLIC_CONVEX_URL`.

## Estructura

- `schema.ts` — modelo de datos (tablas, campos e índices). **Ya definido**, listo para refinar.
- `_generated/` — tipos y `api` que genera Convex automáticamente. Aparece al correr `convex dev` (aún no existe).
- `auth.ts`, `http.ts`, `auth.config.ts` — los crea el comando `npx @convex-dev/auth` al activar la autenticación.
- Tus funciones (`queries`, `mutations`, `actions`) van como archivos nuevos aquí, p. ej. `alumnos.ts`, `reactivos.ts`, `examenes.ts`.

## Activación (una sola vez)

Requiere una cuenta en https://convex.dev (gratis). Desde la raíz del proyecto:

```bash
# 1. Inicia Convex: te pedirá iniciar sesión en el navegador y crear el proyecto.
#    Al terminar escribe CONVEX_DEPLOYMENT en .env.local y sube el schema.
npx convex dev

# 2. (En otra terminal) el frontend
npm run dev
```

Copia la URL que imprime `convex dev` (algo como `https://<nombre>.convex.cloud`) a
`NEXT_PUBLIC_CONVEX_URL` en tu archivo `.env.local`.

### Autenticación por correo + contraseña (cuando toque LUI-8 / LUI-103)

```bash
npx @convex-dev/auth        # genera auth.ts, http.ts, auth.config.ts y las llaves
```

Luego, en `components/providers.tsx`, cambia `ConvexProvider` por el proveedor de
Convex Auth para Next.js (`ConvexAuthNextjsProvider`) y añade el `middleware.ts`.
Guía: https://labs.convex.dev/auth/setup

## Escribir una función (ejemplo)

Crea `convex/grupos.ts`:

```ts
import { query } from "./_generated/server";

export const listar = query({
  args: {},
  handler: async (ctx) => ctx.db.query("grupos").collect(),
});
```

Y en un componente cliente:

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const grupos = useQuery(api.grupos.listar);
```

> Nota: `_generated` no existe hasta que corres `npx convex dev`. Por eso el
> scaffold aún no incluye archivos de funciones (romperían el build). En cuanto
> actives Convex, agrégalas.
