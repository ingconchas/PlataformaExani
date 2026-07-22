"use client";

import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { etiquetaResultado } from "@/convex/misExamenes";
import { PUNTAJE_BASE, PUNTAJE_MAX, redondearPuntaje } from "@/convex/simulacro";
import { fechaHoraMx } from "@/convex/fechas";

/**
 * Resultado del intento — versión MÍNIMA e INTERINA (LUI-28 la reemplaza con el desglose
 * por sección y área, la comparación con la meta y las insignias).
 *
 * Entrega lo que el player necesita para cerrar el ciclo hoy: el puntaje en su escala, la
 * fecha de entrega, la etiqueta del repaso y la salida a «Mis exámenes». El desglose YA se
 * persiste en el intento (`aciertosPorSeccion`/`aciertosPorArea`, estampado al cerrar) —
 * simplemente no viaja todavía: una query no devuelve datos sin consumidor.
 *
 * `[id]` de la ruta es el INTENTO (no la asignación): un examen puede tener varios y cada
 * uno tiene su resultado.
 */
export function ResultadoMinimoClient({ intentoId }: { intentoId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const r = useQuery(
    api.player.resultado,
    isAuthenticated ? { intentoId } : "skip",
  );

  if (r === undefined) {
    return <p className="py-10 text-center text-small text-muted">Cargando…</p>;
  }
  if (r === null) {
    return (
      <div className="py-10 text-center">
        <p className="text-body text-ink">Este resultado no está disponible.</p>
        <Link href="/examenes" className="text-small font-semibold text-unx-blue underline">
          Volver a Mis exámenes
        </Link>
      </div>
    );
  }
  if (r.problema === "enCurso") {
    return (
      <div className="py-10 text-center">
        <p className="text-body text-ink">Este simulacro todavía está en curso.</p>
        <Link
          href={`/examen/${r.intentoId}`}
          className="text-small font-semibold text-unx-blue underline"
        >
          Continuar
        </Link>
      </div>
    );
  }

  const esRepaso = r.numeroIntento !== null && r.numeroIntento > 1;

  return (
    <div className="flex flex-col gap-4 pb-6" data-resultado={r.intentoId}>
      <h1 className="text-h2 text-ink">
        {etiquetaResultado(r.titulo, r.numeroIntento)}
      </h1>

      <Card className="flex flex-col items-center gap-1 text-center">
        {r.puntaje === null ? (
          <p className="text-body text-muted">
            Tu examen se registró, pero no pudo calificarse.
          </p>
        ) : (
          <>
            <span
              className="font-condensed text-[48px] font-semibold leading-none tabular-nums text-unx-blue"
              data-resultado-puntaje
            >
              {redondearPuntaje(r.puntaje)}
            </span>
            <span className="text-caption text-muted">
              escala {PUNTAJE_BASE}–{PUNTAJE_MAX}
            </span>
          </>
        )}
        {r.enviadoEn !== null && (
          <p className="mt-2 text-small text-muted">
            Contestado el {fechaHoraMx(r.enviadoEn)}
          </p>
        )}
        {r.formaCierre === "tiempo_agotado" && (
          <p className="text-small text-muted" data-cierre-tiempo>
            Se envió automáticamente al agotarse el tiempo.
          </p>
        )}
      </Card>

      {esRepaso && (
        <Alert kind="info" data-aviso-repaso>
          Repaso — tu resultado oficial es el del primer intento.
        </Alert>
      )}

      <Link
        href="/examenes"
        className="inline-flex h-11 items-center justify-center rounded-control bg-unx-blue px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-unx-blue-hover"
      >
        Volver a Mis exámenes
      </Link>
    </div>
  );
}
