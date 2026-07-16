import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { BancoReactivosClient } from "@/components/reactivos/banco-reactivos-client";

export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader
          title="Banco de reactivos"
          description="Banco institucional de reactivos"
        />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>{" "}
          para verla.
        </Alert>
      </>
    );
  }
  return <BancoReactivosClient basePath="/admin" />;
}
