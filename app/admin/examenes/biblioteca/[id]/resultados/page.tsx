import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { ResultadosExamenClient } from "@/components/examenes/resultados-examen-client";

/** Gemela ADMIN de Resultados del examen (LUI-30 · drill-down de LUI-32): el MISMO
 *  cliente compartido en modo solo lectura — banner candado + breadcrumb del Resumen. El
 *  Resumen enlaza con `?asignacion=` para preseleccionar la aplicación clicada (solo UI: la
 *  vista valida el id contra sus opciones y cae al default si no aplica). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asignacion?: string }>;
}) {
  const { id } = await params;
  const { asignacion } = await searchParams;

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Resultados del examen" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre{" "}
          <code>npx convex dev</code> y define{" "}
          <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code> para
          verla.
        </Alert>
      </>
    );
  }
  return (
    <ResultadosExamenClient
      examenId={id}
      variante="admin"
      asignacionInicial={asignacion}
    />
  );
}
