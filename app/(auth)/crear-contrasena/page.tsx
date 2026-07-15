import { AuthShell } from "../auth-shell";
import { PasswordSetForm } from "../password-set-form";

/** Landing del correo de invitación (`?token=`): el usuario crea su primera
 *  contraseña y entra directo a su panel. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <PasswordSetForm token={token ?? ""} modo="invitacion" />
    </AuthShell>
  );
}
