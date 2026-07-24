"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardPendiente } from "@/components/alumna/card-pendiente";
import { TarjetaPuntajeMeta } from "@/components/alumna/tarjeta-puntaje-meta";
import {
  derivarInicio,
  lineaUltimoResultado,
  type UltimoDiagnostico,
} from "@/convex/inicioAlumna";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";
import { useComenzarSimulacro } from "@/lib/use-comenzar-simulacro";

/**
 * Inicio — «Mi progreso» de la alumna (LUI-24 · Diseño 23). DOS capas, por las reglas de
 * Hooks: el wrapper resuelve la carga GLOBAL de las tres queries y el componente CARGADO
 * posee el reloj anclado.
 *
 * Las tres queries: `player.misExamenes` (el próximo pendiente y las variantes de vacío,
 * exactas para lo que Inicio pinta), `player.ultimoDiagnostico` (el read-model exacto del
 * diagnóstico más reciente — jamás un repaso) y `perfilAlumna.mio` (meta + carrera +
 * institución). Mientras CUALQUIERA esté `undefined` no se pinta nada: «no cargó la meta» y
 * «no tiene meta» se ven igual y significan lo contrario.
 */
export function InicioClient() {
  const { isAuthenticated } = useConvexAuth();
  const datos = useQuery(api.player.misExamenes, isAuthenticated ? {} : "skip");
  const diag = useQuery(api.player.ultimoDiagnostico, isAuthenticated ? {} : "skip");
  const perfil = useQuery(api.perfilAlumna.mio, isAuthenticated ? {} : "skip");

  if (datos === undefined || diag === undefined || perfil === undefined) {
    return <p className="py-10 text-center text-small text-muted">Cargando…</p>;
  }
  return <InicioCargado datos={datos} ultimo={diag.ultimo} perfil={perfil} />;
}

type Datos = NonNullable<ReturnType<typeof useQuery<typeof api.player.misExamenes>>>;
type Perfil = NonNullable<ReturnType<typeof useQuery<typeof api.perfilAlumna.mio>>>;

function InicioCargado({
  datos,
  ultimo,
  perfil,
}: {
  datos: Datos;
  ultimo: UltimoDiagnostico;
  perfil: Perfil;
}) {
  const { comenzar, continuar, ocupada, error } = useComenzarSimulacro();

  const fronterasDe = useCallback(
    (t: number) => derivarInicio(datos, ultimo, t).fronteras,
    [datos, ultimo],
  );
  const ahora = useRelojAnclado(datos.ahoraServidor, fronterasDe);
  const d = useMemo(
    () => derivarInicio(datos, ultimo, ahora),
    [datos, ultimo, ahora],
  );

  const meta = perfil.meta;
  const nombre = perfil.nombre.split(" ")[0] || perfil.nombre;
  const pie = meta ? `${meta.carrera} — ${meta.institucion}` : undefined;
  const tieneUltimo = d.variante === "completa" || d.variante === "sinPendientes";

  return (
    <div className="flex flex-col gap-5 py-2" data-inicio data-ahora-servidor={datos.ahoraServidor}>
      {error && <Alert kind="error">{error}</Alert>}

      {/* TU AVANCE HACIA LA META — con diagnóstico (U). */}
      {tieneUltimo && d.ultimo && (
        <TarjetaPuntajeMeta
          caption="Puntaje más reciente"
          puntajeCrudo={d.ultimo.puntajeCrudo}
          meta={meta}
          nombre={nombre}
          pie={pie}
          tamanoPuntaje={48}
        />
      )}

      {/* El próximo simulacro pendiente (P), como card de acceso directo. */}
      {d.variante === "completa" && d.proximo && (
        <CardPendiente
          pendiente={d.proximo}
          ocupada={ocupada}
          onComenzar={() => comenzar(d.proximo!.asignacionId)}
          onContinuar={continuar}
          ctaTexto="Comenzar simulacro"
          mostrarBadgePendiente
        />
      )}

      {/* Sin pendientes: banner que invita a repasar (enlace a Mis exámenes, donde vive
          «Repetir como repaso» — `/progreso` sigue siendo placeholder). */}
      {d.variante === "sinPendientes" && (
        <div
          className="flex items-center gap-3 rounded-[10px] bg-unx-blue-tint p-4"
          data-sin-pendientes
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-unx-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 2" />
            </svg>
          </span>
          <div>
            <p className="font-semibold text-ink">No tienes simulacros pendientes</p>
            <p className="text-caption text-muted">
              {d.hayFuturas
                ? "Tu instructor ya programó uno; aparecerá aquí en cuanto abra."
                : "Tu instructor te asignará el siguiente. Mientras tanto, puedes "}
              {!d.hayFuturas && (
                <Link href="/examenes" className="font-semibold text-unx-blue underline">
                  repasar tus áreas
                </Link>
              )}
              {!d.hayFuturas && "."}
            </p>
          </div>
        </div>
      )}

      {/* Banner del último resultado — la única vía de Inicio al detalle (U). */}
      {tieneUltimo && d.ultimo && (
        <div
          className="flex items-center gap-3 rounded-[10px] bg-unx-green-tint px-4 py-3.5"
          data-ultimo-resultado
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-unx-green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex-1">
            <p className="text-caption text-muted">Tu último resultado</p>
            <p className="font-semibold text-ink">
              {lineaUltimoResultado(d.ultimo.titulo, d.ultimo.puntajeCrudo)}
            </p>
          </div>
          <Link
            href={`/examenes/${d.ultimo.intentoId}/resultado`}
            className="text-small font-semibold text-unx-blue"
            data-ver-ultimo
          >
            Ver
          </Link>
        </div>
      )}

      {/* Sin simulacros contestados, con uno pendiente: el diagnóstico inicial. */}
      {d.variante === "sinContestados" && d.proximo && (
        <Card className="text-center" data-sin-contestados>
          <svg
            className="mx-auto mb-3 text-unx-blue"
            width="72" height="72" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden
          >
            <rect x="9" y="6" width="30" height="36" rx="3" />
            <path d="M15 15h18M15 22h18M15 29h12" strokeLinecap="round" />
            <circle cx="35" cy="34" r="8" fill="var(--color-surface)" />
            <path d="M31.5 34l2.5 2.5 4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-h3 text-ink">Tu primer simulacro te espera</h2>
          <p className="mt-1.5 text-small text-muted">
            Es tu diagnóstico inicial: nos dice de dónde partimos.
          </p>
          {d.proximo.enCurso ? (
            <Button
              className="mt-4 w-full"
              onClick={() => continuar(d.proximo!.enCurso!)}
              data-cta="continuar-diagnostico"
            >
              Continuar mi diagnóstico
            </Button>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled={ocupada === d.proximo.asignacionId}
              onClick={() => comenzar(d.proximo!.asignacionId)}
              data-cta="comenzar-diagnostico"
            >
              Comenzar mi diagnóstico
            </Button>
          )}
        </Card>
      )}

      {/* Recién dada de alta: bienvenida. */}
      {d.variante === "bienvenida" && (
        <Card className="text-center" data-bienvenida>
          <h2 className="text-h3 text-ink">¡Te damos la bienvenida{meta ? `, ${nombre}` : ""}!</h2>
          <p className="mt-1.5 text-small text-muted">
            {d.hayFuturas
              ? "Tu instructor ya programó tu primer simulacro; aparecerá aquí en cuanto abra."
              : "Tu instructor te asignará tu primer simulacro. En cuanto lo haga, lo verás aquí."}
          </p>
        </Card>
      )}
    </div>
  );
}
