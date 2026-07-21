/**
 * Mensaje flash ONE-SHOT entre navegaciones (LUI-22: el toast «Examen asignado…»
 * sobrevive al regreso a la biblioteca). `sessionStorage` y no un query param: se consume
 * y borra al montar (un refresh NO lo re-muestra) y no ensucia la URL (un param sobrevive
 * a copiar/compartir el enlace y re-dispararía el toast en otra pestaña).
 *
 * ⚠️ FALLA SEGURO: `sessionStorage` puede LANZAR (modo privado de Safari, cuota, storage
 * deshabilitado). Ambas funciones degradan a no-op/`null` — el contrato del submit es que
 * **una mutation exitosa NAVEGA SIEMPRE, con o sin toast**: si `setFlash` reventara
 * después de que `asignar` confirmó, mostrar error y no navegar invitaría a crear un lote
 * duplicado.
 */

const CLAVE = "unx:flash";

export function setFlash(mensaje: string): void {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CLAVE, mensaje);
    }
  } catch {
    // Sin storage no hay toast; la navegación del caller sigue su curso.
  }
}

export function consumeFlash(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const mensaje = window.sessionStorage.getItem(CLAVE);
    if (mensaje !== null) window.sessionStorage.removeItem(CLAVE);
    return mensaje;
  } catch {
    return null;
  }
}
