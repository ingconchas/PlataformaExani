import { AuthShell } from "../auth-shell";
import { RecuperarForm } from "./recuperar-form";

/** "¿Olvidaste tu contraseña?": pide el correo y dispara el enlace de recuperación. */
export default function Page() {
  return (
    <AuthShell>
      <RecuperarForm />
    </AuthShell>
  );
}
