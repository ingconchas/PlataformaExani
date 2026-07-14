import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { LoginForm } from "./login-form";

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
          <h1 className="text-h2 text-ink">
            Te damos la bienvenida a UNX Simuladores
          </h1>
          <p className="mt-1 text-small text-muted">
            Entra con tu correo y contraseña.
          </p>
          <LoginForm />
          <Link
            href="/restablecer"
            className="mt-4 block text-center text-small text-unx-blue hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </Card>
        <p className="mt-6 text-center text-caption text-muted">
          UNX · Preparación para tu examen de admisión · unx.mx
        </p>
      </div>
    </main>
  );
}
