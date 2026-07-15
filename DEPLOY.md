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
- Las credenciales nacen del staff/importación; el auto-registro público está
  bloqueado. El **envío de invitaciones/recuperación (LUI-103)** es el siguiente
  paso: hasta tenerlo, las cuentas se crean con contraseña vía el seed demo o se
  habilitarán con LUI-103 en producción.

## Repositorio y rama

- Remoto: `https://github.com/ingconchas/PlataformaExani`
- Rama de despliegue: **`main`** (Railway publica automáticamente al hacer push).
- El contenido previo del remoto es descartable; la primera subida lo sobrescribe:

  ```bash
  # SOLO cuando auditoría dé luz verde:
  git push -u origin main --force
  ```

## Modo A — Deploy seguro sin Convex (recomendado para el primer deploy)

Es la configuración **actual** de `railway.json` (`buildCommand: npm run build`).
No requiere ningún secreto.

- Railway construye (`next build`) y sirve (`next start`, usa `$PORT`).
- El chrome y las pantallas placeholder funcionan.
- `/admin/alumnos` muestra un aviso *"configura Convex"* (degradación elegante,
  no truena) porque en Railway no está `NEXT_PUBLIC_CONVEX_URL`.
- Variables requeridas en Railway: **ninguna**.

Sirve para validar el pipeline de Railway sin tocar Convex de producción.

## Modo B — Deploy con Convex de producción (cuando LUI-7 esté listo)

1. Crea un deployment de **producción** de Convex y su **Deploy Key**:
   Convex Dashboard → Project Settings → Deploy Keys → *Production*.
2. En Railway, define la variable **`CONVEX_DEPLOY_KEY`** con esa llave
   (solo en Railway, nunca en el repo).
3. Cambia el build en `railway.json` a:

   ```json
   "buildCommand": "npx convex deploy --cmd 'npm run build'"
   ```

   Esto despliega las funciones de Convex a producción y compila Next con la URL
   de Convex de producción ya inyectada.
4. Define en el **entorno de Convex** (Dashboard → Settings → Environment
   Variables) las llaves de Convex Auth que genere `npx @convex-dev/auth`
   (`SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`) — parte de LUI-7.

## Verificación local (paridad con Railway)

```bash
npm run build     # lo mismo que corre Railway en Modo A
npm run start     # sirve el build en http://localhost:3000
```

## Notas de configuración

- Node ≥ 20 (`engines` en `package.json` y `.nvmrc`).
- `.env.local` está en `.gitignore` — **no se sube**. En Railway las variables se
  definen en su panel, no en archivos.
- `railway.json`: builder Nixpacks, start `npm run start`, reinicio `ON_FAILURE`.
- Datos de prueba (`convex/seed.ts`) son **ficticios** y su función es
  `internalMutation` (no se puede llamar desde el cliente/HTTP; solo por CLI).
