/** Encabezado de la app de la alumna: saludo + avatar. */
export function StudentHeader({ nombre }: { nombre: string }) {
  return (
    <header className="flex items-center justify-between px-5 py-4">
      <div>
        <p className="text-caption text-muted">Hola,</p>
        <p className="text-h3 text-ink">{nombre}</p>
      </div>
      <div className="flex size-10 items-center justify-center rounded-full bg-unx-blue-tint text-small font-semibold text-unx-blue">
        {nombre.charAt(0).toUpperCase()}
      </div>
    </header>
  );
}
