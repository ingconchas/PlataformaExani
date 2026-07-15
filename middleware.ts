import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Zonas por rol: cada prefijo pertenece a un único rol. `/examen` va explícito
// porque vive fuera del grupo (alumna). Todo lo demás (/, /login, /api/auth, …)
// queda fuera → sin gate.
const isAdmin = createRouteMatcher(["/admin(.*)"]);
const isInstructor = createRouteMatcher(["/instructor(.*)"]);
const isAlumna = createRouteMatcher([
  "/inicio(.*)",
  "/onboarding(.*)",
  "/examenes(.*)",
  "/examen(.*)",
  "/historial(.*)",
  "/perfil(.*)",
  "/progreso(.*)",
]);

const HOME: Record<"admin" | "instructor" | "alumno", string> = {
  admin: "/admin",
  instructor: "/instructor",
  alumno: "/inicio",
};

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  // Rol que exige la ruta. Si no pertenece a ninguna zona (páginas públicas y el
  // proxy /api/auth), no se aplica ningún gate → pasa.
  const zona = isAdmin(request)
    ? "admin"
    : isInstructor(request)
      ? "instructor"
      : isAlumna(request)
        ? "alumno"
        : null;
  if (!zona) return;

  // Gate de AUTH: sin sesión → login.
  if (!(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/login");
  }

  // Gate por ROL: el rol NO viaja en el JWT (0.0.94), se lee en vivo de la BD.
  // Fail-closed: cualquier fallo de red → tratar como sin sesión.
  const sesion = await fetchQuery(
    api.sesion.actual,
    {},
    { token: await convexAuth.getToken() },
  ).catch(() => null);
  if (!sesion || !sesion.activo) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
  if (sesion.rol !== zona) {
    return nextjsMiddlewareRedirect(request, HOME[sesion.rol]);
  }
});

// El matcher DEBE incluir /api/auth/:path* para que el proxy de signIn/signOut
// corra (si no, el login termina en 404). El enforcement por rol NO lo intercepta
// porque /api/auth no pertenece a ninguna zona (arriba `zona` es null → pasa).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)", "/api/auth/:path*"],
};
