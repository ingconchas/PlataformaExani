import { ResultadoMinimoClient } from "./resultado-client";

/**
 * Resultado de un intento (interino del paquete player; LUI-28 lo reemplaza).
 * `[id]` es el INTENTO: cada repaso tiene su propio resultado.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultadoMinimoClient intentoId={id} />;
}
