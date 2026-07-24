"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { AsignacionId, IntentoId } from "@/convex/misExamenes";

/** Copy del error de una mutation, extrayendo el `ConvexError.data.message` cuando existe. */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) {
    const d = e.data as { message?: string } | string;
    return typeof d === "string" ? d : (d?.message ?? "Ocurrió un error.");
  }
  return "Ocurrió un error. Intenta de nuevo.";
}

/**
 * El flujo «Comenzar / Continuar simulacro», compartido por «Mis exámenes» (LUI-25) y por
 * Inicio (LUI-24) — las dos pintan la misma `CardPendiente` y necesitan el MISMO manejo del
 * rechazo (la ventana puede cerrarse entre render y clic: `iniciarIntento` rechaza y la
 * pantalla lo DICE en un `Alert`, no navega). «Mutation exitosa navega SIEMPRE» (regla del
 * repo): un envío que resolvió pero cuya navegación se perdió dejaría a la alumna sin saber
 * si empezó.
 *
 * Expone `error` y `ocupada` para que CADA consumidor los muestre igual (contrato completo
 * del dictamen de LUI-24).
 */
export function useComenzarSimulacro() {
  const router = useRouter();
  const iniciar = useMutation(api.player.iniciarIntento);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);

  const comenzar = useCallback(
    async (asignacionId: AsignacionId) => {
      setError(null);
      setOcupada(asignacionId);
      try {
        const { intentoId } = await iniciar({ asignacionId });
        router.push(`/examen/${intentoId}`);
      } catch (e) {
        setError(mensajeDeError(e));
        setOcupada(null);
      }
    },
    [iniciar, router],
  );

  const continuar = useCallback(
    (intentoId: IntentoId) => router.push(`/examen/${intentoId}`),
    [router],
  );

  return { comenzar, continuar, ocupada, error, limpiarError: () => setError(null) };
}
