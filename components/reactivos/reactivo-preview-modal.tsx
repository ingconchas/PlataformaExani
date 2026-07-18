"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { BookText, Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty-meter";
import { Modal } from "@/components/ui/modal";
import { sanear } from "@/convex/sanitizar";
import { cn } from "@/lib/utils";
// El enunciado/explicación son HTML SANEADO (LUI-15 E2). `obtener` ya los entrega
// saneados; re-sanear en lectura es idempotente = defensa en profundidad.
import { CLASE_RICO } from "./clase-rico";
import { MaterialReactivo } from "./material-reactivo";

/**
 * Vista de SOLO LECTURA de un reactivo (LUI-14: «revisar antes de usarlo en un
 * examen»). Carga el detalle completo con `reactivos.obtener` (opciones, respuesta
 * correcta, retroalimentación, imagen) — que la lista LEAN deja fuera a propósito.
 * Ofrece «Editar» solo si el usuario puede y el reactivo no está bloqueado.
 */
export function ReactivoPreviewModal({
  reactivoId,
  basePath,
  onClose,
}: {
  reactivoId: string;
  basePath: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const r = useQuery(
    api.reactivos.obtener,
    isAuthenticated ? { reactivoId } : "skip",
  );

  return (
    <Modal
      title="Reactivo"
      width={640}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {r && r.esEditable && !r.enUso && (
            <Button
              onClick={() => router.push(`${basePath}/reactivos/${r.id}/editar`)}
            >
              Editar
            </Button>
          )}
        </>
      }
    >
      {r === undefined ? (
        <p className="py-6 text-center text-muted">Cargando reactivo…</p>
      ) : r === null ? (
        <p className="py-6 text-center text-muted">No se encontró el reactivo.</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <DifficultyMeter level={r.dificultad} showLabel />
            {!r.activo && <Badge tone="neutral">Desactivado</Badge>}
            {r.enUso && <Badge tone="blue">En uso en un examen</Badge>}
          </div>

          <p className="text-small text-muted">
            {r.seccionNombre} · {r.areaNombre} · {r.subtemaNombre} · por{" "}
            {r.autorNombre}
          </p>

          {r.lecturaTitulo && (
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-unx-blue-tint px-3 py-1 text-small font-semibold text-unx-blue">
              <BookText className="size-3.5" aria-hidden />
              Lectura: {r.lecturaTitulo}
            </p>
          )}

          {r.imagenUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- URL de Convex storage; next/image exige configurar dominios
            <img
              src={r.imagenUrl}
              alt="Imagen del reactivo"
              className="max-h-64 w-fit rounded-card border border-border"
            />
          )}

          <div
            className={cn("text-body font-medium text-ink", CLASE_RICO)}
            dangerouslySetInnerHTML={{ __html: sanear(r.enunciado) }}
          />

          {/* Material de columnas/ordenamiento (LUI-16): SIEMPRE entre el enunciado y las
              opciones. Se monta incondicionalmente — devuelve null si no hay material. */}
          <MaterialReactivo material={r.material} />

          <ul className="grid gap-2">
            {r.opciones.map((o) => {
              const correcta = o.id === r.opcionCorrecta;
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-control border px-3 py-2",
                    correcta
                      ? "border-unx-green bg-unx-green-tint"
                      : "border-border",
                  )}
                >
                  <span className="font-condensed font-semibold uppercase text-muted">
                    {o.id})
                  </span>
                  <span className="flex-1">{o.texto}</span>
                  {correcta && (
                    <Check
                      className="mt-0.5 size-[18px] shrink-0 text-unx-green"
                      aria-label="Respuesta correcta"
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {r.retroalimentacion && (
            <div className="rounded-card bg-bg px-3 py-2 text-small text-text">
              <span className="font-semibold">Retroalimentación: </span>
              <span
                className={CLASE_RICO}
                dangerouslySetInnerHTML={{ __html: sanear(r.retroalimentacion) }}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
