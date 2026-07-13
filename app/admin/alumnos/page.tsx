import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { AlumnosClient } from "./alumnos-client";

/**
 * Server Component: hace de guard. Sin `NEXT_PUBLIC_CONVEX_URL` NO monta el
 * cliente (que usa useQuery/useMutation) para no romper el "modo en pausa" sin
 * Convex; muestra un aviso. Con la URL definida, renderiza AlumnosClient.
 */
export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Alumnos" description="Gestión de alumnos" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code> y define{" "}
          <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code> para verla.
        </Alert>
      </>
    );
  }
  return <AlumnosClient />;
}
