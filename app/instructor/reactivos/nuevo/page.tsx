import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { ReactivoFormClient } from "@/components/reactivos/reactivo-form-client";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ examen?: string; seccion?: string }>;
}) {
  // Crear-directo (LUI-21): los params solo traen IDS; el título y el permiso los lee el
  // cliente de `paraConstructor`. El REGRESO sale de `examenesPath` (constante de zona),
  // jamás de la URL.
  const { examen, seccion } = await searchParams;

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Crear reactivo" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>.
        </Alert>
      </>
    );
  }
  return (
    <ReactivoFormClient
      basePath="/instructor"
      examenesPath="/instructor/examenes"
      destino={examen && seccion ? { examenId: examen, seccionId: seccion } : undefined}
    />
  );
}
