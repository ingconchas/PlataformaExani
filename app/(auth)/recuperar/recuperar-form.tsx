"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { Mail } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/** Enmascara el correo para el mensaje de confirmación: `f•••@dominio`. */
function enmascarar(correo: string): string {
  const [local, dominio] = correo.split("@");
  if (!dominio) return correo;
  return `${local.slice(0, 1)}•••@${dominio}`;
}

export function RecuperarForm() {
  const router = useRouter();
  const solicitar = useMutation(api.invitaciones.solicitarRecuperacion);
  const [correo, setCorreo] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const email = correo.trim().toLowerCase();
    // Respuesta uniforme: pase lo que pase, mostramos la misma confirmación
    // (no revela si el correo existe).
    try {
      await solicitar({ correo: email });
    } catch {
      // ignorado a propósito
    }
    setEnviado(email);
  }

  if (enviado) {
    return (
      <div className="grid gap-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-unx-green-tint text-unx-green">
          <Mail className="size-6" aria-hidden />
        </div>
        <h1 className="text-h2 text-ink">Revisa tu correo</h1>
        <p className="text-body text-muted">
          Si <strong className="text-ink">{enmascarar(enviado)}</strong> tiene una
          cuenta, te enviamos un enlace para restablecer tu contraseña. Es válido
          durante <strong className="text-ink">60 minutos</strong>.
        </p>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => router.push("/login")}
        >
          Volver a iniciar sesión
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={enviar}>
      <div>
        <h1 className="text-h2 text-ink">Recupera tu contraseña</h1>
        <p className="mt-1 text-small text-muted">
          Escribe tu correo y te enviaremos un enlace para restablecerla.
        </p>
      </div>
      <div>
        <Label htmlFor="correo">Correo electrónico</Label>
        <Input
          id="correo"
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="tucorreo@correo.com"
          autoComplete="email"
          required
        />
      </div>
      <Button size="lg" type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar enlace"}
      </Button>
    </form>
  );
}
