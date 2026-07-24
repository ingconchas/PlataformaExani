import { ResultadoClient } from "./resultado-client";

/**
 * Resultados del simulacro (LUI-28).
 * `[id]` es el INTENTO: cada repaso tiene su propio resultado.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultadoClient intentoId={id} />;
}
