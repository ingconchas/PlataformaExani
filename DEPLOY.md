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
- Las credenciales nacen de la **invitación (LUI-103)**; el auto-registro público
  está bloqueado. El **envío real por Resend** existe desde la **Entrega 2** y se
  activa con `CORREO_TRANSPORTE=resend` — ver *Correo transaccional* abajo.

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

## Temario del núcleo (LUI-18)

Las 3 secciones del núcleo (Pensamiento matemático, Comprensión lectora, Redacción indirecta) son **dato institucional real**, no demo, así que producción las necesita. A diferencia de `crearAdminInicial`, es **convergente** (upsert), no rechazante: se puede re-correr para añadir una sección nueva.

```bash
npx convex run bootstrap:sembrarTemarioNucleo --prod
```

Las áreas temáticas y los subtemas **no se siembran**: Mayra los captura desde `/admin/temario`.

## El seed demo NUNCA se corre en producción — y ahora hay un guard, no solo esta advertencia

`convex/seed.ts` y `convex/seedAuth.ts` son **solo-dev**. La advertencia en prosa no bastaba: son `internalMutation`/`internalAction`, quedan fuera del gate de admin, se invocan por CLI, y esta misma guía enseña comandos con `--prod`. Un `--prod` accidental crearía cuentas con la contraseña conocida `Demo1234` y un perfil `rol:"admin"` — **un bypass de autenticación en un sistema vivo**, peor que cualquier borrado.

Por eso cada función solo-dev con escritura lleva **dos guards** (`convex/entorno.ts`):

1. Un literal obligatorio, `{"confirmar":"SOLO_DEV"}` — corta la invocación desnuda por memoria muscular.
2. `exigirDeploymentDeDesarrollo()` — **lista blanca, fail-closed** sobre `CONVEX_CLOUD_URL`. Es el que corta el accidente realista: copiar el comando de abajo (que ya trae el literal) y añadirle `--prod`.

```bash
# SOLO DEV. Nunca con --prod: el guard lo rechaza, pero no lo pongas a prueba.
npx convex run seed:cargarDatosDePrueba  '{"confirmar":"SOLO_DEV"}'
npx convex run seedAuth:credencialesDemo '{"confirmar":"SOLO_DEV"}'
npx convex run seed:limpiarAlumnosE2E    '{"confirmar":"SOLO_DEV"}'
npx convex run seed:limpiarContenidoDemo '{"confirmar":"SOLO_DEV"}'   # reset del fixture del temario
```

`bootstrap:crearAdminInicial` y `bootstrap:sembrarTemarioNucleo` **no** llevan guard: sí están diseñadas para prod.

> ⚠️ **El schema de Convex se pushea DENTRO del build** (`convex deploy --cmd 'npm run build'`), o sea **antes** de que `next build` termine y de que Railway mueva el tráfico. Si el build falla después del push, **Convex prod se queda con el schema nuevo y el frontend viejo**, y revertir el merge **NO revierte el schema de Convex**. Todo cambio de schema debe ser compatible hacia atrás con el frontend que está desplegado durante esa ventana.

## Correo transaccional (LUI-103, Entrega 2 — Resend)

### El interruptor

`convex/correo.ts` elige el transporte con **`CORREO_TRANSPORTE`**, una variable
explícita — **nunca por la presencia de la API key**:

| Valor | Efecto |
|---|---|
| ausente / vacía | `dev` (default seguro) |
| `dev` | registra destinatario, asunto y **enlace** en los logs; **no envía** |
| `resend` | **envío real** |
| cualquier otro | **lanza** (un typo no puede degradar en silencio a logs con enlaces vivos) |

> ⚠️ **NUNCA pongas `CORREO_TRANSPORTE=resend` en el deployment de DEV.** El seed de
> dev usa correos `@demo.unx.mx`, un dominio que **no existe**: enviar de verdad
> produciría rebotes duros y dañaría la reputación de envío, que es caro y lento de
> revertir. Para probar envío real desde dev, hazlo **temporalmente** y solo contra
> direcciones reales tuyas; luego regresa la variable a `dev`.

Esto da un **rollout en dos pasos**: desplegar el código no cambia nada (sin la
variable, el comportamiento es idéntico al de antes), y el envío se activa después.

### Las 4 variables (viven en el entorno de CONVEX, no en Railway)

```bash
npx convex env set CORREO_TRANSPORTE resend --prod
npx convex env set RESEND_API_KEY re_xxxxxxxx --prod          # permiso: solo envío
npx convex env set CORREO_REMITENTE 'UNX — Supera tu examen de admisión <no-reply@unx.mx>' --prod
npx convex env set CORREO_LOGO_URL https://plataforma-exani.up.railway.app/logo/unx-logotipo-blanco.png --prod
```

`CORREO_LOGO_URL` está **desacoplada de `SITE_URL`** a propósito: derivarla del
origen de la app la volvería `localhost` en dev, y ningún cliente de correo puede
cargar eso. Si falta o es inválida, los correos caen al **wordmark de texto** — no
lanza, porque un logo mal configurado es cosmético y no debe impedir que alguien
reciba su acceso.

### Verificación del dominio en Resend (antes de activar)

El dominio **`unx.mx`** debe estar verde en Resend → Domains. Los 3 registros van en
el DNS (SiteGround → Site Tools → Domain → DNS Zone Editor):

| Tipo | Nombre | Valor |
|---|---|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` · prioridad 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | la llave pública DKIM que da Resend |

> ⛔ **No toques el SPF de la raíz de `unx.mx`.** Ya trae `a`, `mx` y 3 `include:`
> (Microsoft 365 + MailerLite + MailerSend), muy cerca del **límite duro de 10
> consultas DNS** del estándar SPF. Rebasarlo produce PermError y **degrada todo el
> correo de unx.mx, incluido Microsoft 365**. Resend no lo necesita: pone su SPF en
> `send.unx.mx`, que usa como Return-Path. Tampoco toques el DMARC ni el MX raíz.

```bash
dig +short TXT resend._domainkey.unx.mx
dig +short TXT send.unx.mx
dig +short MX  send.unx.mx
dig +short TXT unx.mx | grep spf1   # DEBE seguir idéntico
```

### Rollback (sin redeploy, por cualquiera de las dos rutas)

```bash
npx convex env set CORREO_TRANSPORTE dev --prod     # explícito, deja rastro en el dashboard
npx convex env remove CORREO_TRANSPORTE --prod      # equivalente: el default es dev
```

Se prefiere la primera: deja constancia de la decisión en vez de un hueco.

### Bitácora y cuotas

- **`enviosCorreo`**: registra el desenlace de **todos** los envíos (éxito, config
  faltante, timeout, 4xx/5xx, transporte desconocido). Nunca guarda el enlace, el
  cuerpo ni la llave. Consulta: `npx convex data enviosCorreo [--prod]`.
- **Rate limiting** (`convex/cuotas.ts`): `solicitarRecuperacion` y `reenviar` están
  limitados con token buckets. Guardia:
  `npx convex run cuotas:inspeccionar '{}' [--prod]`. Escotilla para desbloquear a
  alguien durante un incidente:
  `npx convex run cuotas:restablecer '{"clave":"recuperacion:usuario:<userId>"}' [--prod]`.

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
