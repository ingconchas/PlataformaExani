import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { ConstructorExamenClient } from "@/components/examenes/constructor-examen-client";

export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Constructor de examen" description="Arma un examen seleccionando reactivos" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>{" "}
          para verla.
        </Alert>
      </>
    );
  }
  // Props de ruta explícitas por montaje (cero `if (admin)` en el cliente).
  return (
    <ConstructorExamenClient
      basePath="/instructor/examenes"
      reactivosPath="/instructor"
    />
  );
}
