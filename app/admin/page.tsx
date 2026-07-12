import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminInicio() {
  return (
    <>
      <PageHeader
        title="Inicio"
        description="Resumen de tu institución."
        action={<Button>Nuevo grupo</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardDescription>Alumnos activos</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">248</p>
        </Card>
        <Card>
          <CardDescription>Grupos</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">12</p>
        </Card>
        <Card>
          <CardDescription>Exámenes aplicados</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">1,894</p>
        </Card>
      </div>
      <p className="mt-6 text-caption text-muted">
        Diseño de referencia: design-reference/screens/06-panel-admin.html
      </p>
    </>
  );
}
