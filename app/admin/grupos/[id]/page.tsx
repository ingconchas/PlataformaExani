import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { GrupoDetalleClient } from "./grupo-detalle-client";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Grupo" description="Detalle del grupo" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>{" "}
          para verla.
        </Alert>
      </>
    );
  }
  return <GrupoDetalleClient grupoId={id} />;
}
