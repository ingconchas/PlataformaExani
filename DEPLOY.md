# Despliegue — Plataforma Exani II (Railway + Convex)

> Esta guía deja el repo listo para publicar en Railway. **No ejecutes el push
> hasta que auditoría dé luz verde.**

## ⚠️ Antes de desplegar: estado de la autenticación

La autenticación real (**LUI-7**) todavía **no** está implementada. Las escrituras
a la base de datos (crear / editar / activar-desactivar alumnos) pasan por el
candado `requireAdmin` (`convex/authz.ts`), que **bloquea toda escritura** salvo
que exista la variable de entorno `PERMITIR_ESCRITURA_DEMO=true`.

- **En producción NUNCA definas `PERMITIR_ESCRITURA_DEMO`.** Sin ella las
  escrituras quedan bloqueadas (seguro por defecto); con ella quedarían abiertas
  **sin autenticación** (agujero de seguridad).
- Hasta terminar LUI-7, un deploy **funcional** de la gestión de alumnos no es
  posible (las escrituras están bloqueadas a propósito). El deploy sirve para
  validar el pipeline y ver las pantallas.

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
5. Recuerda: **no** definas `PERMITIR_ESCRITURA_DEMO` en producción.

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
