import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function InstructorInicio() {
  return (
    <>
      <PageHeader
        title="Inicio"
        description="Tu banco de reactivos y exámenes."
        action={<Button>Nuevo reactivo</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardDescription>Reactivos</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">642</p>
        </Card>
        <Card>
          <CardDescription>Lecturas</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">38</p>
        </Card>
        <Card>
          <CardDescription>Exámenes</CardDescription>
          <p className="font-condensed mt-1 text-display text-ink">27</p>
        </Card>
      </div>
      <p className="mt-6 text-caption text-muted">
        Diseño de referencia: design-reference/screens/13-panel-instructor.html
      </p>
    </>
  );
}
