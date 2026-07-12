import { ScreenPlaceholder } from "@/components/dev/screen-placeholder";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
      <ScreenPlaceholder
        titulo="Crea tu contraseña"
        diseno="05-flujo-de-acceso.html"
        descripcion="Define tu contraseña desde el enlace de invitación."
      />
    </main>
  );
}
