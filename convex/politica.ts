import { ConvexError } from "convex/values";

/**
 * Política de contraseña (LUI-103). Fuente ÚNICA de verdad, compartida por el
 * provider `Password` (`validatePasswordRequirements`), las actions que fijan la
 * contraseña, y el checklist en vivo de las pantallas (que reusa estas etiquetas).
 */
export const REQUISITOS_CONTRASENA = [
  { id: "largo", etiqueta: "Mínimo 8 caracteres", prueba: (p: string) => p.length >= 8 },
  { id: "mayuscula", etiqueta: "Una letra mayúscula", prueba: (p: string) => /[A-Z]/.test(p) },
  { id: "numero", etiqueta: "Un número", prueba: (p: string) => /[0-9]/.test(p) },
] as const;

/** ¿La contraseña cumple TODOS los requisitos? (booleano, para el checklist en
 *  vivo del cliente). */
export function cumpleContrasena(password: string): boolean {
  return REQUISITOS_CONTRASENA.every((r) => r.prueba(password));
}

/** Lanza `ConvexError` si la contraseña no cumple la política. Se valida en el
 *  SERVIDOR (fuente de verdad), no solo en el cliente. */
export function validarContrasena(password: string): void {
  if (!cumpleContrasena(password)) {
    throw new ConvexError(
      "La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.",
    );
  }
}
