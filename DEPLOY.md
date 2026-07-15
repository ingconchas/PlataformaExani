# Despliegue — Plataforma Exani II (Railway + Convex)

> Esta guía deja el repo listo para publicar en Railway. **No ejecutes el push
> hasta que auditoría dé luz verde.**

## Estado de la autenticación

La autorización real (**LUI-7, Entrega 2**) ya está implementada:

- **Escrituras y lecturas del panel** pasan por `requireAdmin` / `requireSesion`
  (`convex/authz.ts`), que exigen una **sesión real** de Convex Auth con el rol
  correspondiente. Ya no existe la vieja bandera `PERMITIR_ESCRITURA_DEMO`.
- **El login rechaza cuentas desactivadas o sin perfil** (`beforeSessionCreation`)
  y registra el último acceso; el **middleware** protege cada zona por rol.
- Las credenciales nacen de la **invitación (LUI-103, Entrega 1)**; el
  auto-registro público está bloqueado. En esta entrega el **transporte de correo
  es DEV** (el enlace de invitación/recuperación se **registra en los logs de
  Convex**, no se envía). El **envío real** (Resend/SES + dominio) es **LUI-103
  Entrega 2**.

## Repositorio y rama

- Remoto: `https://github.com/ingconchas/PlataformaExani`
- Rama de despliegue: **`main`** (Railway publica automáticamente al hacer push).
- El contenido previo del remoto es descartable; la primera subida lo sobrescribe.
  **Empuja el COMMIT REVISADO (la rama de entrega actual), NO la rama local `main`**
  (que está vieja y NO contiene el stack). Estando en la rama de entrega:

  ```bash
  # SOLO con el GO de deploy explícito de auditoría:
  git push origin HEAD:main --force-with-lease
  # equivalente explícito (independiente de la rama en la que estés):
  git push origin ingconchas/lui-103-invitacion-y-recuperacion-de-acceso:main --force-with-lease
  ```

## Modo A — Deploy sin Convex (fallback opcional para validar el pipeline)

> `railway.json` ya **no** está en Modo A (está en Modo B, arriba). Este modo es
> solo un fallback: requiere revertir el `buildCommand` a `npm run build`.
> No requiere ningún secreto.

- Railway construye (`next build`) y sirve (`next start`, usa `$PORT`).
- El chrome y las pantallas placeholder funcionan.
- `/admin/alumnos` muestra un aviso *"configura Convex"* (degradación elegante,
  no truena) porque en Railway no está `NEXT_PUBLIC_CONVEX_URL`.
- Variables requeridas en Railway: **ninguna**.

Sirve para validar el pipeline de Railway sin tocar Convex de producción.

## Modo B — Producción (Convex prod + Railway) · SETUP ACTUAL

`railway.json` **ya está en Modo B**: `buildCommand: npx convex deploy --cmd 'npm run build'` — cada deploy de Railway publica las funciones de Convex a producción y compila Next con la URL de Convex prod inyectada al build.

Orden de configuración (la URL de Railway se necesita para `SITE_URL`, por eso va primero):

1. **Railway** — `railway link` al proyecto *Plataforma Exani*; conectar el servicio al repo `PlataformaExani` (GitHub App de Railway) si aún no lo está; `railway domain` para obtener la **URL pública** (`…up.railway.app`).
2. **Convex prod** — `npx convex deploy -y` (crea el deployment de producción; anota su URL `.convex.cloud`). Luego las llaves de Convex Auth, **con la URL de Railway explícita**:

   ```bash
   npx @convex-dev/auth --prod --skip-git-check --web-server-url <URL-de-Railway>
   ```

   (fija `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS` en el entorno de Convex prod). Confirma que **NO** exista `PERMITIR_ESCRITURA_DEMO` en prod.
3. **Variables de Railway** (dos, ambas necesarias):
   - **`NEXT_PUBLIC_CONVEX_URL`** = URL `.convex.cloud` de prod. ⚠️ **Es de RUNTIME**: el `fetchQuery` del middleware (y `providers.tsx` / `app/layout.tsx`) la leen en ejecución; la inyección de build de `convex deploy --cmd` **NO basta**. Sin ella el build pasa pero las rutas protegidas fallan en runtime.
   - **`CONVEX_DEPLOY_KEY`** = *Production* Deploy Key (Convex Dashboard → Project Settings → Deploy Keys). Solo en Railway, nunca en el repo.
4. **Deploy**: `git push origin HEAD:main --force-with-lease` (empuja el commit revisado, NO la `main` local vieja; sobrescribe el `main` remoto descartable) → Railway auto-despliega.

## Primer administrador (bootstrap)

Producción arranca con la BD **vacía** y el auto-registro bloqueado. Para crear el primer admin (una sola vez):

```bash
npx convex run bootstrap:crearAdminInicial '{"nombre":"…","apellidos":"…","correo":"…"}' --prod
```

`crearAdminInicial` (`convex/bootstrap.ts`) crea el usuario+perfil admin y agenda la invitación; **rechaza si ya existe cualquier admin**. El enlace para crear la contraseña aparece en `npx convex logs --prod` (transporte dev): ábrelo en la URL de prod (`/crear-contrasena?token=…`) y define la contraseña. Después ese admin crea al resto desde el panel.

**El seed demo (`convex/seed.ts`, `seedAuth.ts`) NUNCA se corre en producción.**

## Correo (transporte dev)

En esta entrega el envío es un **transporte DEV** (`convex/correo.ts`): registra destinatario/asunto/**enlace** en los logs de Convex, **no envía correo real**. Para un piloto, el admin toma el enlace del log. El envío real (Resend/SES + verificación de dominio `unx.mx`) es **LUI-103 Entrega 2**.

## Verificación local (paridad con Railway)

```bash
npm run build     # verifica Next localmente; Railway (Modo B) además corre `npx convex deploy --cmd`
npm run start     # sirve el build en http://localhost:3000
```

## Notas de configuración

- Node ≥ 20 (`engines` en `package.json` y `.nvmrc`).
- `.env.local` está en `.gitignore` — **no se sube**. En Railway las variables se
  definen en su panel, no en archivos.
- `railway.json`: builder Nixpacks, start `npm run start`, reinicio `ON_FAILURE`.
- Datos de prueba (`convex/seed.ts`) son **ficticios** y su función es
  `internalMutation` (no se puede llamar desde el cliente/HTTP; solo por CLI).
