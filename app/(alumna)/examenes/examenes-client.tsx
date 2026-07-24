"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardPendiente } from "@/components/alumna/card-pendiente";
import { derivarMisExamenes, type IntentoId } from "@/convex/misExamenes";
import { fechaCortaMx } from "@/convex/fechas";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";
import { useComenzarSimulacro } from "@/lib/use-comenzar-simulacro";

/**
 * «Mis exámenes» (LUI-25 · Diseño 24) en DOS capas, por las reglas de Hooks: el wrapper
 * resuelve la carga y el componente CARGADO posee los hooks del reloj, que deben correr
 * incondicionales (mismo patrón que el panel del instructor).
 *
 * El servidor entrega filas CRUDAS; la clasificación (pendiente / completado / vencido),
 * el orden y la urgencia «¡Cierra hoy!» las deriva `derivarMisExamenes` con el reloj
 * anclado — así una asignación futura APARECE sola al abrirse y una abierta pasa a
 * vencida al cerrarse, sin re-query (al cruzar no cambia ningún documento).
 *
 * La card del pendiente y el flujo «Comenzar/Continuar» se comparten con Inicio (LUI-24) vía
 * `CardPendiente` y `useComenzarSimulacro` — misma card, mismo manejo del rechazo.
 */
export function MisExamenesClient() {
  const { isAuthenticated } = useConvexAuth();
  const datos = useQuery(api.player.misExamenes, isAuthenticated ? {} : "skip");

  if (datos === undefined) {
    return (
      <p className="py-10 text-center text-small text-muted">
        Cargando tus simulacros…
      </p>
    );
  }
  return <MisExamenesCargado datos={datos} />;
}

type Datos = NonNullable<ReturnType<typeof useQuery<typeof api.player.misExamenes>>>;

function MisExamenesCargado({ datos }: { datos: Datos }) {
  const { comenzar, continuar, ocupada, error } = useComenzarSimulacro();

  const fronterasDe = useCallback(
    (t: number) => derivarMisExamenes(datos, t).fronteras,
    [datos],
  );
  const ahora = useRelojAnclado(datos.ahoraServidor, fronterasDe);
  const d = useMemo(() => derivarMisExamenes(datos, ahora), [datos, ahora]);

  const sinNada =
    d.pendientes.length === 0 &&
    d.completados.length === 0 &&
    d.vencidos.length === 0;

  return (
    <div
      className="flex flex-col gap-6 pb-6"
      data-mis-examenes
      data-ahora-servidor={datos.ahoraServidor}
    >
      <h1 className="text-h2 text-ink">Mis exámenes</h1>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Estado INCOMPLETO: alguna cota del servidor recortó la lectura. Se dice, no se
          disfraza de lista completa (y apaga el vacío exitoso). */}
      {d.incompleto && (
        <Alert kind="warning">
          Se muestran tus exámenes más recientes; puede faltar historial.
        </Alert>
      )}

      {d.pendientes.length > 0 && (
        <section aria-labelledby="cap-pendientes" className="flex flex-col gap-3">
          <h2
            id="cap-pendientes"
            className="font-condensed text-caption uppercase tracking-[0.06em] text-muted"
          >
            Pendientes
          </h2>
          {d.pendientes.map((p) => (
            <CardPendiente
              key={p.asignacionId}
              pendiente={p}
              ocupada={ocupada}
              onComenzar={() => comenzar(p.asignacionId)}
              onContinuar={continuar}
            />
          ))}
        </section>
      )}

      {d.completados.length > 0 && (
        <section aria-labelledby="cap-completados" className="flex flex-col gap-3">
          <h2
            id="cap-completados"
            className="font-condensed text-caption uppercase tracking-[0.06em] text-muted"
          >
            Completados
          </h2>
          {d.completados.map((c) => (
            <Card
              key={c.asignacionId}
              className="flex flex-col gap-2"
              data-completado={c.asignacionId}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-h3 text-ink">{c.titulo}</h3>
                  <p className="text-small text-muted">
                    {c.contestadoEn === null
                      ? "Contestado"
                      : `Contestado el ${fechaCortaMx(c.contestadoEn)}`}
                    {!c.ventanaAbierta && " · ventana cerrada"}
                  </p>
                </div>
                {c.puntaje !== null && (
                  <span className="font-condensed text-[28px] font-semibold tabular-nums text-unx-blue">
                    {c.puntaje}
                  </span>
                )}
              </div>
              {c.tieneRepaso && !c.repasoEnCurso && (
                <Badge tone="purple" data-badge-repaso>
                  Repaso realizado
                </Badge>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href={`/examenes/${c.intentoId}/resultado`}
                  className="text-small font-semibold text-unx-blue underline"
                  data-ver-resultados={c.asignacionId}
                >
                  Ver resultados
                </Link>
                {/* Un repaso VIVO manda: se ofrece continuarlo, no empezar otro (la
                    mutation reanudaría el mismo y el reloj de ese intento ya corre). */}
                {c.repasoEnCurso ? (
                  <>
                    <Badge tone="blue">Repaso en curso</Badge>
                    <button
                      type="button"
                      onClick={() => continuar(c.repasoEnCurso as IntentoId)}
                      className="text-small font-semibold text-ink underline"
                      data-cta="continuar-repaso"
                    >
                      Continuar
                    </button>
                  </>
                ) : (
                  c.ventanaAbierta && (
                    <button
                      type="button"
                      disabled={ocupada === c.asignacionId}
                      onClick={() => comenzar(c.asignacionId)}
                      className="text-small font-semibold text-ink underline disabled:opacity-50"
                      data-cta="repasar"
                    >
                      Repetir como repaso
                    </button>
                  )
                )}
              </div>
            </Card>
          ))}
          <p className="text-caption text-muted">
            El repaso no cambia tu puntaje: cuenta el primer intento.
          </p>
        </section>
      )}

      {d.vencidos.length > 0 && (
        <section aria-labelledby="cap-vencidos" className="flex flex-col gap-3">
          <h2
            id="cap-vencidos"
            className="font-condensed text-caption uppercase tracking-[0.06em] text-muted"
          >
            Vencidos
          </h2>
          {/* No está en el mock: patrón nuevo (card gris, sin acción) para el compromiso
              «los vencidos tienen estilo distinto y no son accionables» de LUI-25. */}
          {d.vencidos.map((v) => (
            <Card
              key={v.asignacionId}
              className="flex flex-col gap-1 bg-bg shadow-none"
              data-vencido={v.asignacionId}
            >
              <h3 className="text-body font-semibold text-muted">{v.titulo}</h3>
              <p className="text-small text-muted">
                Venció el {fechaCortaMx(v.cierraEn)} · no lo contestaste
              </p>
            </Card>
          ))}
        </section>
      )}

      {/* Vacío del mock SOLO cuando de verdad no hay nada: con futuras (o con datos
          recortados) decir «no tienes simulacros asignados» sería falso. */}
      {sinNada && d.hayFuturas && (
        <Card className="flex flex-col gap-2 text-center" data-solo-futuras>
          <h2 className="text-h3 text-ink">
            No tienes simulacros disponibles por el momento
          </h2>
          <p className="text-small text-muted">
            Tu instructor ya programó uno; aparecerá aquí en cuanto abra.
          </p>
        </Card>
      )}
      {sinNada && !d.hayFuturas && !d.incompleto && (
        <Card className="flex flex-col gap-2 text-center" data-vacio>
          <h2 className="text-h3 text-ink">Aún no tienes simulacros asignados</h2>
          <p className="text-small text-muted">
            Tu instructor te avisará cuando haya uno listo para ti.
          </p>
        </Card>
      )}
    </div>
  );
}
