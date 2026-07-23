import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { ResumenExamenesClient } from "@/components/examenes/resumen-examenes-client";

/** Resumen de exámenes aplicados — vista de la administradora (LUI-32, mock 12). */
export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Resumen de exámenes" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre{" "}
          <code>npx convex dev</code> y define{" "}
          <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code> para
          verla.
        </Alert>
      </>
    );
  }
  return <ResumenExamenesClient />;
}
