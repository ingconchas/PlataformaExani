import Link from "next/link";
import Image from "next/image";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const destinos = [
  { href: "/login", titulo: "Acceso", desc: "Login y recuperación de contraseña" },
  { href: "/admin", titulo: "Panel · Administrador", desc: "Alumnos, grupos, usuarios, temario" },
  { href: "/instructor", titulo: "Panel · Instructor", desc: "Banco de reactivos y exámenes" },
  { href: "/inicio", titulo: "App de la alumna", desc: "Práctica, simulacros y progreso" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/logo/unx-logo-completo.png"
          alt="UNX Simuladores"
          width={200}
          height={167}
          priority
        />
        <div>
          <h1 className="text-display text-ink">Plataforma EXANI II</h1>
          <p className="mt-1 text-body text-muted">
            Transformar aspirantes en admitidos.
          </p>
        </div>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        {destinos.map((d) => (
          <Card key={d.href}>
            <CardTitle>{d.titulo}</CardTitle>
            <CardDescription className="mt-1">{d.desc}</CardDescription>
            <Link href={d.href} className="mt-4 inline-block">
              <Button>Abrir</Button>
            </Link>
          </Card>
        ))}
      </div>

      <p className="text-caption text-muted">
        Andamiaje de desarrollo · las pantallas se construyen sobre el UNX Design
        System v1.2
      </p>
    </main>
  );
}
