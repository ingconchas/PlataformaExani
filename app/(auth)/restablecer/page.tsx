import { AuthShell } from "../auth-shell";
import { PasswordSetForm } from "../password-set-form";

/** Landing del correo de recuperación (`?token=`): el usuario define una nueva
 *  contraseña. Si el enlace expiró, ofrece volver a solicitarlo en /recuperar. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <PasswordSetForm token={token ?? ""} modo="recuperacion" />
    </AuthShell>
  );
}
