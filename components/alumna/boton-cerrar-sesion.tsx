"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Cota del cierre remoto: si el POST no responde en este plazo, se ABORTA y se avisa. En
 *  una conexión sana el proxy responde en <1 s; esto solo acota el caso atascado. */
const PLAZO_CIERRE_MS = 8000;

/**
 * Borra el token de acceso local de Convex Auth de forma DETERMINISTA y lo PROPAGA a las
 * pestañas hermanas.
 *
 * Convex Auth no guarda la credencial solo en cookies HttpOnly: también deja el JWT de acceso
 * (y el refresh) en `localStorage`, con clave `__convexAuthJWT_<url>` (ver
 * `useNamespacedStorage`). El JWT dura ~1 h y las guardas de la app usan `getAuthUserId` +
 * perfil activo sin consultar `authSessions` por operación, así que una pestaña hermana que
 * conserve ese JWT y su WebSocket puede seguir consultando y mutando aunque las cookies ya no
 * existan — una sesión viva en un dispositivo compartido.
 *
 * Por eso NO basta con `void signOut()` (mejor esfuerzo que se cancela si la página se
 * descarga antes de que su `setToken(null)` corra). Aquí se remueven las claves a mano: es
 * síncrono, sin red, y cada `removeItem` dispara el evento `storage` en las OTRAS pestañas,
 * cuyo listener de Convex Auth reacciona a la clave del JWT llamando `setToken(null)` — deja
 * su WebSocket sin autenticar. Se barre por PREFIJO `__convexAuth` para no depender del
 * cómputo exacto del namespace.
 */
function limpiarTokenLocal(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("__convexAuth")) localStorage.removeItem(k);
    }
  } catch {
    // `localStorage` puede lanzar en modos de privacidad; si no es accesible, no hay token
    // local que borrar por esta vía.
  }
}

/**
 * Cerrar sesión, en un componente propio por dos razones que se refuerzan.
 *
 * (1) Desde LUI-36 el Perfil es la ÚNICA puerta de salida de la app de la alumna (el header
 * pasó a llevar al Perfil, Diseño 23), y `perfilAlumna.mio` LANZA a propósito ante una fila
 * inconsistente. Por eso el botón vive en el SHELL del Perfil, con posición estable en los
 * tres estados (carga, error vía `perfil/error.tsx`, datos): así un fallo de la query no se
 * lleva por delante la salida, y el botón no se remonta —perdiendo su estado— al caerse la
 * sesión.
 *
 * (2) ══ LA CONFIRMACIÓN VIENE DEL 200 DEL PROXY, NADA MÁS ══
 *
 * La credencial de esta app vive en cookies **HttpOnly** (`__convexAuthJWT` /
 * `__convexAuthRefreshToken`), que **ningún código de cliente puede borrar**: solo las limpia
 * el proxy `/api/auth` en su rama `auth:signOut`, que llama `setAuthCookies(null)` ANTES de
 * responder 200 (verificado en `node_modules/@convex-dev/auth/.../proxy.ts`). Por tanto un
 * **200 del proxy ⟺ cookies borradas**. Es la única evidencia server-side inequívoca del
 * cierre, y por eso es la que se usa.
 *
 * Lo que NO sirve, y costó tres rondas de auditoría descartar:
 *   · `signOut()` de la librería TRAGA los errores del transporte y resuelve igual, así que
 *     su resolución no prueba que la cookie se haya borrado.
 *   · Sondear una ruta protegida (p. ej. `fetch("/inicio")`) tampoco: el middleware redirige
 *     a `/login` por TRES motivos distintos —sin cookie, sesión inválida, o la validación
 *     server-side CAÍDA (fail-close, `middleware.ts`)—. Un `/api/auth` que falla dejando la
 *     cookie viva puede coincidir con esa validación caída, y la sonda leería `/login`
 *     fingiendo un cierre que no ocurrió. En un dispositivo compartido eso es una fuga.
 *
 * Así que se hace el POST de `signOut` a mano para poder LEER su status: 200 ⇒ la sesión
 * quedó de verdad cerrada. Entonces —y solo entonces— se borra el token local de forma
 * DETERMINISTA (`limpiarTokenLocal`, que además propaga a las pestañas hermanas) y se navega
 * DURO a `/login` (`router.replace` quedaría superado por la convulsión del estado de auth
 * tras el cierre). Cualquier otro desenlace —2xx que no sea 200, 4xx/5xx, abort, red caída,
 * timeout— NO confirma nada: se avisa, el botón queda para reintentar y JAMÁS se navega
 * fingiendo el cierre.
 *
 * El POST a mano se acopla al MISMO contrato HTTP que la propia librería usa
 * (`{action:"auth:signOut"}` a `/api/auth`, respuesta 200); si ese contrato cambiara, el
 * logout degradaría a «avisa siempre» —molesto pero SEGURO—, nunca a un falso cierre.
 */
export function BotonCerrarSesion() {
  const [estado, setEstado] = useState<"listo" | "cerrando" | "atascado">("listo");
  const vivo = useRef(true);
  // REARMA al montar (no solo baja al desmontar): en StrictMode el ciclo es montar → limpiar
  // → montar, y un efecto que solo bajara la bandera la dejaría en `false` para siempre.
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const cerrar = async () => {
    setEstado("cerrando");
    let confirmado = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), PLAZO_CIERRE_MS);
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "auth:signOut", args: {} }),
          cache: "no-store",
          signal: ctrl.signal,
        });
        // EXACTAMENTE 200: es lo único que el proxy devuelve tras `setAuthCookies(null)`. Un
        // 2xx distinto, 4xx o 5xx no pasó por esa línea (o no llegó al proxy), así que la
        // cookie puede seguir viva. Se exige 200, no `res.ok`, para que el contrato y el
        // código digan lo mismo.
        confirmado = res.status === 200;
      } finally {
        clearTimeout(t);
      }
    } catch {
      // abort (timeout), red caída o rechazo inmediato: sin confirmación de cierre.
      confirmado = false;
    }

    if (confirmado) {
      // Cookies ya borradas server-side. Se borra el token local de forma DETERMINISTA (y se
      // propaga a las pestañas hermanas) ANTES de navegar, y se navega DURO a /login.
      limpiarTokenLocal();
      window.location.assign("/login");
      return;
    }
    if (vivo.current) setEstado("atascado");
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        data-cerrar-sesion
        disabled={estado === "cerrando"}
        onClick={cerrar}
      >
        {estado === "cerrando" ? "Cerrando sesión…" : "Cerrar sesión"}
      </Button>
      {estado === "atascado" && (
        <Alert kind="error" role="alert" data-cierre-atascado>
          No pudimos cerrar tu sesión: sigue abierta. Revisa tu conexión e inténtalo de nuevo.
        </Alert>
      )}
    </div>
  );
}
