import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Rutas que exigen sesión (gate de AUTH; el gate por ROL es la Entrega 2 de authz).
// `/examen` va explícito porque vive fuera del grupo (alumna).
const isProtegido = createRouteMatcher([
  "/admin(.*)",
  "/instructor(.*)",
  "/inicio(.*)",
  "/onboarding(.*)",
  "/examenes(.*)",
  "/examen(.*)",
  "/historial(.*)",
  "/perfil(.*)",
  "/progreso(.*)",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isProtegido(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

// El matcher DEBE incluir /api/auth/:path* para que el proxy de signIn/signOut
// corra (si no, el login termina en 404). Las páginas públicas (/login,
// /crear-contrasena, /restablecer, /) quedan fuera de `isProtegido` → pasan.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)", "/api/auth/:path*"],
};
