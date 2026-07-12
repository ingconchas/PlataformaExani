import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image
            src="/logo/unx-logo-completo.png"
            alt="UNX Simuladores"
            width={180}
            height={150}
            priority
          />
        </div>
        <Card>
          <h1 className="text-h2 text-ink">Inicia sesión</h1>
          <p className="mt-1 text-small text-muted">
            Entra con tu correo y contraseña.
          </p>
          <form className="mt-5 space-y-4">
            <div>
              <Label htmlFor="correo">Correo</Label>
              <Input
                id="correo"
                type="email"
                placeholder="tu@correo.com"
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" autoComplete="current-password" />
            </div>
            <Button size="lg" className="w-full">
              Entrar
            </Button>
          </form>
          <Link
            href="#"
            className="mt-4 block text-center text-small text-unx-blue hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </Card>
        <p className="mt-6 text-center text-caption text-muted">
          Pantalla base (LUI-8). Conectar con Convex Auth al activar la
          autenticación.
        </p>
      </div>
    </main>
  );
}
