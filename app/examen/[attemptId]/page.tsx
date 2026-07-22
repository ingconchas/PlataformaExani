import { PlayerClient } from "./player-client";

/**
 * Simulacro en curso (LUI-26 · Diseño 25). Vive FUERA del grupo `(alumna)` a propósito:
 * el modo examen no lleva `BottomNav` ni `StudentHeader` — no debe existir una forma de
 * salir sin querer (regla del sistema de diseño). El middleware ya trata `/examen` como
 * zona de la alumna.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return <PlayerClient intentoId={attemptId} />;
}
