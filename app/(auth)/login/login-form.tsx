"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

function destino(rol: "admin" | "instructor" | "alumno"): string {
  if (rol === "admin") return "/admin";
  if (rol === "instructor") return "/instructor";
  return "/inicio";
}

export function LoginForm() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const sesion = useQuery(api.sesion.actual);

  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Con sesión activa (y perfil resuelto), redirige a su panel por rol. Cubre el
  // caso "ya autenticado al abrir /login" y el "recién autenticado".
  useEffect(() => {
    if (isAuthenticated && sesion) router.replace(destino(sesion.rol));
  }, [isAuthenticated, sesion, router]);

  async function ingresar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await signIn("password", {
        email: correo.trim().toLowerCase(), // correo canónico
        password,
        flow: "signIn",
      });
      // La redirección la hace el useEffect cuando llega `sesion.actual`.
    } catch {
      // Mensaje genérico: no revela si el correo existe.
      setError("Correo o contraseña incorrectos");
      setEnviando(false);
    }
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={ingresar}>
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
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            type={verPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="pr-11"
            required
          />
          <button
            type="button"
            aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => setVerPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-ink"
          >
            {verPassword ? (
              <EyeOff className="size-[18px]" aria-hidden />
            ) : (
              <Eye className="size-[18px]" aria-hidden />
            )}
          </button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Button size="lg" type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Entrando…" : "Ingresar"}
      </Button>
    </form>
  );
}
