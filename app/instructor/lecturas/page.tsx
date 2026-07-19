import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { LecturasClient } from "@/components/lecturas/lecturas-client";

export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Lecturas" description="Pasajes con su bloque de preguntas" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>{" "}
          para verla.
        </Alert>
      </>
    );
  }
  return <LecturasClient basePath="/instructor" />;
}
