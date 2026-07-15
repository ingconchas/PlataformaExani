"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { cumpleContrasena } from "@/convex/politica";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ChecklistContrasena } from "@/components/ui/checklist-contrasena";

type Modo = "invitacion" | "recuperacion";
type Estado = "cargando" | "valido" | "usado" | "expirado" | "invalido";

function destino(rol: "admin" | "instructor" | "alumno"): string {
  if (rol === "admin") return "/admin";
  if (rol === "instructor") return "/instructor";
  return "/inicio";
}

function mensajeError(err: unknown): string {
  // Las actions de Convex preservan `ConvexError.data` en el cliente.
  if (err instanceof ConvexError) {
    const d = err.data as { message?: unknown } | string | undefined;
    if (d && typeof d === "object" && typeof d.message === "string") return d.message;
    if (typeof d === "string") return d;
  }
  return "No se pudo completar. Intenta de nuevo.";
}

/** Formulario compartido de "crear/restablecer contraseña" desde un enlace con
 *  token. Valida el token al montar, aplica la política en vivo, fija la
 *  contraseña y deja al usuario dentro (signIn → redirección por rol). */
export function PasswordSetForm({ token, modo }: { token: string; modo: Modo }) {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const sesion = useQuery(api.sesion.actual);
  const validarToken = useAction(api.invitaciones.validarToken);
  const establecer = useAction(api.invitaciones.establecerContrasenaInvitacion);
  const restablecer = useAction(api.invitaciones.restablecerContrasena);

  const [estado, setEstado] = useState<Estado>(token ? "cargando" : "invalido");
  const [nombre, setNombre] = useState<string | undefined>();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Validar el token al montar (si no hay token, el estado inicial ya es "invalido").
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    validarToken({ token })
      .then((r) => {
        if (!vivo) return;
        // Un token de otro tipo abierto en esta ruta se trata como inválido
        // (evita la UX confusa de "válido" que falla recién al enviar).
        if (r.estado === "valido" && r.tipo !== modo) {
          setEstado("invalido");
          return;
        }
        setEstado(r.estado);
        setNombre(r.nombre);
      })
      .catch(() => {
        if (vivo) setEstado("invalido");
      });
    return () => {
      vivo = false;
    };
  }, [token, validarToken, modo]);

  // Tras el signIn, redirige por rol (mismo patrón que el login).
  useEffect(() => {
    if (isAuthenticated && sesion) router.replace(destino(sesion.rol));
  }, [isAuthenticated, sesion, router]);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!cumpleContrasena(password)) {
      setError("La contraseña aún no cumple los requisitos.");
      return;
    }
    if (password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const { email } =
        modo === "invitacion"
          ? await establecer({ token, password })
          : await restablecer({ token, password });
      await signIn("password", { email, password, flow: "signIn" });
      // La redirección la hace el useEffect cuando llega `sesion.actual`.
    } catch (err) {
      setError(mensajeError(err));
      setEnviando(false);
    }
  }

  if (estado === "cargando") {
    return <p className="py-4 text-center text-muted">Validando el enlace…</p>;
  }

  if (estado !== "valido") {
    const texto =
      estado === "usado"
        ? "Este enlace ya se usó."
        : estado === "expirado"
          ? "El enlace expiró."
          : "El enlace no es válido.";
    return (
      <div className="grid gap-4">
        <h1 className="text-h2 text-ink">Enlace no disponible</h1>
        <Alert kind="error">{texto}</Alert>
        {modo === "recuperacion" ? (
          <p className="text-small text-muted">
            Solicita uno nuevo desde{" "}
            <Link href="/recuperar" className="font-semibold text-unx-blue hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </p>
        ) : (
          <p className="text-small text-muted">
            Pide a la coordinación de tu institución que te reenvíe la invitación.
          </p>
        )}
      </div>
    );
  }

  const esInv = modo === "invitacion";
  return (
    <form className="grid gap-4" onSubmit={enviar}>
      <div>
        <h1 className="text-h2 text-ink">
          {esInv ? `Hola, ${nombre ?? ""}`.trim() : "Restablece tu contraseña"}
        </h1>
        <p className="mt-1 text-small text-muted">
          {esInv
            ? "Crea tu contraseña para empezar."
            : "Elige una nueva contraseña para tu cuenta."}
        </p>
      </div>
      <div>
        <Label htmlFor="password">Nueva contraseña</Label>
        <PasswordInput
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu nueva contraseña"
          autoComplete="new-password"
          required
        />
        <div className="mt-2">
          <ChecklistContrasena password={password} />
        </div>
      </div>
      <div>
        <Label htmlFor="confirmar">Confirmar contraseña</Label>
        <PasswordInput
          id="confirmar"
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
          placeholder="Repite tu contraseña"
          autoComplete="new-password"
          required
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Button size="lg" type="submit" className="w-full" disabled={enviando}>
        {enviando
          ? "Guardando…"
          : esInv
            ? "Crear contraseña y entrar"
            : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
