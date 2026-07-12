import { ExamHeader } from "@/components/layout/exam-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Modo examen (móvil): sin navegación.
// Diseño: design-reference/screens/25-simulacro-en-curso.html
export default function ModoExamen() {
  const opciones = ["x = 2", "x = 4", "x = 6", "x = 8"];
  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col">
      <ExamHeader
        seccion="Pensamiento matemático"
        actual={12}
        total={90}
        tiempo="45:00"
      />
      <main className="flex-1 space-y-4 p-5">
        <p className="text-body text-ink">
          ¿Cuál es el valor de x en la ecuación 2x + 6 = 14?
        </p>
        {opciones.map((op) => (
          <Card key={op} className="cursor-pointer p-4 transition-colors hover:border-unx-blue">
            <span className="text-body text-ink">{op}</span>
          </Card>
        ))}
      </main>
      <footer className="flex gap-3 border-t border-border bg-surface p-4">
        <Button variant="secondary" className="flex-1">
          Anterior
        </Button>
        <Button className="flex-1">Siguiente</Button>
      </footer>
    </div>
  );
}
