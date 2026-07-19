# Plataforma EXANI II — UNX Simuladores

Aplicación web donde instituciones de preparación universitaria aplican simulacros
del **EXANI II** (examen de admisión CENEVAL). Dos audiencias: el **panel
institucional** (administrador / instructor) y la **app de la alumna**.
Lema: *Transformar aspirantes en admitidos.*

## Stack

- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript
- **Estilos:** Tailwind CSS v4 con los tokens del **UNX Design System v1.2**
  (azul `#0228C9`, Barlow / Barlow Condensed)
- **Base de datos + backend:** **Convex** (incl. Convex Auth, acceso por correo/contraseña)
- **Hosting:** **Railway** (frontend Next.js) + Convex Cloud (backend)
- **Iconos:** lucide-react

> **Nota de stack.** El issue LUI-5 del PRD proponía Postgres + Prisma + NextAuth +
> Vercel. Este repositorio usa **Convex + Railway** por decisión posterior: Convex
> integra base de datos, funciones y autenticación en un solo backend, y cubre el
> acceso por correo/contraseña de LUI-8 / LUI-103. Conviene actualizar LUI-5.

## Requisitos

- Node.js ≥ 20 (ver `.nvmrc`)
- Cuenta en [Convex](https://convex.dev) (gratis)
- Cuenta en [Railway](https://railway.app) para el despliegue

## Arranque rápido

Las dependencias ya están instaladas. En desarrollo corren dos procesos:

```bash
# 1. Backend Convex (la primera vez pide iniciar sesión y crea el proyecto)
npx convex dev

# 2. En otra terminal: el frontend
npm run dev
```

- App: <http://localhost:3000>
- Salud: <http://localhost:3000/api/health>

Crea tu archivo local de variables y pega ahí la URL que imprime `convex dev`:

```bash
cp .env.example .env.local     # luego edita NEXT_PUBLIC_CONVEX_URL
```

> Antes de conectar Convex la app corre igual: el proveedor de datos queda
> "en pausa" hasta que exista `NEXT_PUBLIC_CONVEX_URL`.

## Variables de entorno

Ver `.env.example`. Resumen:

| Variable | Dónde vive | Para qué |
|---|---|---|
| `CONVEX_DEPLOYMENT` | `.env.local` (lo escribe `convex dev`) | identifica tu deployment |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | URL pública del backend Convex |
| `CONVEX_DEPLOY_KEY` | Railway | build de producción con `convex deploy` |
| `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` | entorno de Convex | Convex Auth (los crea `npx @convex-dev/auth`) |

## Estructura

```
app/
  (auth)/              login · crear-contraseña · restablecer   (pantallas sin chrome)
  admin/               panel del administrador (layout con sidebar)
  instructor/          panel del instructor (layout con sidebar)
  (alumna)/            app de la alumna (layout con bottom-nav)
  examen/[attemptId]/  modo examen (sin navegación)
  api/health/          endpoint de salud
components/
  ui/                  primitivos del Design System (Button, Card, Badge, Input, Alert)
  layout/              SidebarNav, BottomNav, PageHeader, StudentHeader, ExamHeader
  dev/                 ScreenPlaceholder (marcador de pantalla por construir)
  providers.tsx        proveedor de Convex (resiliente)
convex/
  schema.ts            modelo de datos (ya definido)
  README.md            cómo activar Convex y escribir funciones
lib/                   utils (cn) y navegación por rol
design-reference/      copia del UNX Design System v1.2 (HTML/CSS de cada pantalla)
public/logo/           logotipos oficiales UNX
```

## Mapa de pantallas (MVP)

Cada ruta ya existe como placeholder. Para construir una pantalla, reemplaza su
contenido usando el archivo de diseño en `design-reference/screens/`.

### Acceso
| Ruta | Diseño de referencia |
|---|---|
| `/login` | 05-flujo-de-acceso.html |
| `/crear-contrasena` | 05-flujo-de-acceso.html |
| `/restablecer` | 05-flujo-de-acceso.html |
| *(correos transaccionales)* | 04-correos-transaccionales.html |

### Panel · Administrador
| Ruta | Diseño de referencia |
|---|---|
| `/admin` | 06-panel-admin.html |
| `/admin/alumnos` | 07-gestion-alumnos.html |
| `/admin/alumnos/importar` | 08-importar-alumnos-csv.html |
| `/admin/alumnos/[id]` | 21-ficha-alumno.html |
| `/admin/grupos` | 09-gestion-grupos.html |
| `/admin/usuarios` | 10-usuarios-permisos.html |
| `/admin/temario` | 11-gestion-temario.html |
| `/admin/examenes` | 12-resumen-examenes.html |

### Panel · Instructor
| Ruta | Diseño de referencia |
|---|---|
| `/instructor` | 13-panel-instructor.html |
| `/instructor/reactivos` | 14-banco-reactivos.html |
| `/instructor/reactivos/nuevo` | 15-crear-reactivo.html |
| `/instructor/lecturas` | listado de lecturas (LUI-17, sin mock propio) |
| `/instructor/lecturas/nueva` | 16-crear-lectura.html |
| `/instructor/lecturas/[id]/editar` | 16-crear-lectura.html |
| `/instructor/examenes` | 17-examenes-instructor.html |
| `/instructor/examenes/nuevo` | 18-constructor-examen.html |
| `/instructor/examenes/[id]/asignar` | 19-asignar-examen.html |
| `/instructor/examenes/[id]/resultados` | 20-resultados-examen.html |

### App de la alumna
| Ruta | Diseño de referencia |
|---|---|
| `/onboarding` | 22-onboarding-alumna.html |
| `/inicio` | 23-inicio-alumna.html |
| `/examenes` | 24-mis-examenes.html |
| `/examen/[attemptId]` | 25-simulacro-en-curso.html |
| `/examenes/[id]/resultado` | 26-resultados-simulacro.html |
| `/examenes/[id]/revision` | 27-revision-respuestas.html |
| `/historial` | 28-historial.html |
| `/progreso` | 29-progreso.html |
| `/perfil` | 30-perfil.html |

## Design System

`design-reference/` es una copia del **UNX Design System v1.2**. Para verlo:

```bash
cd design-reference && python3 -m http.server 8080
# abre http://localhost:8080/screens/index.html  (visor navegable por rol)
```

Los tokens ya están en `app/globals.css` (Tailwind v4), disponibles como utilidades:
`bg-unx-blue`, `text-ink`, `rounded-card`, `shadow-card`, `text-h1`, `font-condensed`…
Reglas clave: azul = acción (un solo CTA primario por vista), amarillo = celebración,
Barlow para texto y Barlow Condensed para cifras / temporizadores.

## Desplegar en Railway

1. Sube el repo a GitHub (ver abajo).
2. En Railway: **New Project → Deploy from GitHub repo** → elige este repositorio.
3. Configura variables de entorno en Railway:
   - `NEXT_PUBLIC_CONVEX_URL` = URL del deployment de **producción** de Convex
   - `CONVEX_DEPLOY_KEY` = deploy key de producción (Convex Dashboard → Settings → Deploy Keys)
4. Para que cada build también publique Convex, cambia `buildCommand` en
   `railway.json` a:
   ```
   npx convex deploy --cmd 'npm run build'
   ```
   (déjalo en `npm run build` mientras aún no conectas Convex).
5. Railway detecta Next.js (Nixpacks), arranca con `npm run start` y su `$PORT`.

## Subir a GitHub

```bash
cd ~/Developer/exani-ii-platform
gh repo create exani-ii-platform --private --source=. --push
```

## Próximos pasos

1. `npx convex dev` — activa la base de datos (sube el schema).
2. `npx @convex-dev/auth` — activa el acceso por correo/contraseña (LUI-8, LUI-103),
   y cambia `ConvexProvider` por `ConvexAuthNextjsProvider` en `components/providers.tsx`
   (ver `convex/README.md`).
3. Construye las pantallas del MVP (Fase 1) reemplazando los placeholders,
   guiándote por `design-reference/screens/`.
