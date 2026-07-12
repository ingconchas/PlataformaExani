import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AlumnaInicio() {
  return (
    <div className="space-y-4 py-2">
      <Card>
        <CardTitle>Continúa tu práctica</CardTitle>
        <CardDescription className="mt-1">
          Simulacro de Pensamiento matemático
        </CardDescription>
        <Button className="mt-4 w-full">Continuar</Button>
      </Card>
      <Card>
        <CardDescription>Tu último puntaje</CardDescription>
        <p className="font-condensed mt-1 text-display text-ink">1082</p>
      </Card>
      <p className="text-caption text-muted">
        Diseño: design-reference/screens/23-inicio-alumna.html
      </p>
    </div>
  );
}
