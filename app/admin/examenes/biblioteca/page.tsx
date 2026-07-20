import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { BibliotecaExamenesClient } from "@/components/examenes/biblioteca-examenes-client";

export default function Page() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <>
        <PageHeader title="Exámenes" description="Biblioteca institucional" />
        <Alert kind="warning">
          Esta pantalla necesita la base de datos. Corre <code>npx convex dev</code>{" "}
          y define <code>NEXT_PUBLIC_CONVEX_URL</code> en <code>.env.local</code>{" "}
          para verla.
        </Alert>
      </>
    );
  }
  // `basePath` = la base de ESTA pantalla, NO la zona (/admin/examenes es el
  // Resumen de LUI-32): ver el docblock del cliente.
  return <BibliotecaExamenesClient basePath="/admin/examenes/biblioteca" />;
}
