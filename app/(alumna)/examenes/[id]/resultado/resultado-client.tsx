"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AcordeonAreas, AciertosPorSeccion } from "@/components/alumna/acordeon-areas";
import { TarjetaPuntajeMeta } from "@/components/alumna/tarjeta-puntaje-meta";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { estadoDeVentana } from "@/convex/examenEstado";
import { fechaHoraMx } from "@/convex/fechas";
import { captionDeResultado } from "@/convex/misExamenes";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";

type ResultadoQuery = NonNullable<FunctionReturnType<typeof api.player.resultado>>;
/** El intento YA enviado: la rama `enCurso` la resuelve el wrapper y jamás llega al
 *  componente cargado (que sí lee `cierraEn`, `numeroIntento` y el desglose). */
type Resultado = Exclude<ResultadoQuery, { problema: "enCurso" }>;
type Perfil = FunctionReturnType<typeof api.perfilAlumna.mio>;

const LINK_SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border-[1.5px] border-unx-blue bg-surface px-4 text-body font-medium text-unx-blue transition-colors duration-150 hover:bg-unx-blue-tint";

function mensajeDeError(e: unknown): string {
  return e instanceof Error && "data" in e && typeof e.data === "string"
    ? e.data
    : "No se pudo iniciar el repaso. Intenta de nuevo.";
}

/**
 * RESULTADOS DEL SIMULACRO (LUI-28 · Diseño 26). `[id]` de la ruta es el INTENTO, no la
 * asignación: cada repaso tiene su propio resultado.
 *
 * DOS queries, no una: el intento con su desglose (`player.resultado`) y el perfil académico
 * con la meta (`perfilAlumna.mio`). Separadas a propósito — editar la meta desde el Perfil
 * invalida solo la segunda, sin obligar a releer el intento con sus hasta 240 clasificaciones.
 * El precio es que la COMPLETITUD se evalúa GLOBAL: mientras cualquiera de las dos siga en
 * `undefined` no se pinta nada, porque «todavía no cargó la meta» y «no tiene meta» se ven
 * igual en pantalla y significan cosas opuestas.
 *
 * FUERA de esta entrega, a propósito: «Revisar mis respuestas» (LUI-29) y «Ver mi progreso»
 * (LUI-34). Sus pantallas todavía son placeholders y una CTA visible que lleva a un callejón
 * es peor que la ausencia del botón. La salida contractual a Inicio llega con LUI-24;
 * mientras tanto se vuelve a «Mis exámenes», que sí existe.
 */
export function ResultadoClient({ intentoId }: { intentoId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const r = useQuery(api.player.resultado, isAuthenticated ? { intentoId } : "skip");
  const perfil = useQuery(api.perfilAlumna.mio, isAuthenticated ? {} : "skip");

  // Carga GLOBAL antes que cualquier vacío exitoso.
  if (r === undefined || perfil === undefined) {
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
  return <ResultadoCargado r={r} perfil={perfil} />;
}

function ResultadoCargado({ r, perfil }: { r: Resultado; perfil: Perfil }) {
  const router = useRouter();
  const iniciar = useMutation(api.player.iniciarIntento);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  // El cierre de la ventana es una FRONTERA del reloj: Convex no re-invalida una query por
  // el paso del tiempo, así que sin este timer la CTA de repaso seguiría en pantalla después
  // del cierre y solo moriría al pulsarla, contra el rechazo de la mutation.
  const cierraEn = r.cierraEn;
  const fronterasDe = useCallback(
    (ahora: number) => (cierraEn !== null && cierraEn > ahora ? [cierraEn] : []),
    [cierraEn],
  );
  const ahora = useRelojAnclado(r.ahoraServidor, fronterasDe);

  const esRepaso = r.numeroIntento !== null && r.numeroIntento > 1;
  // Un intento DIRECTO (sin asignación) no tiene ventana: no hay repaso que ofrecer.
  const ventanaAbierta =
    r.asignacionId !== null &&
    r.abreEn !== null &&
    r.cierraEn !== null &&
    estadoDeVentana(r.abreEn, r.cierraEn, ahora) === "abierta";

  const repetir = async () => {
    if (r.asignacionId === null) return;
    setError(null);
    setOcupada(true);
    try {
      const { intentoId } = await iniciar({ asignacionId: r.asignacionId });
      // Mutation exitosa NAVEGA SIEMPRE (regla del repo).
      router.push(`/examen/${intentoId}`);
    } catch (e) {
      setError(mensajeDeError(e));
      setOcupada(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-4 pb-6"
      data-resultado={r.intentoId}
      data-ahora-servidor={r.ahoraServidor}
      data-cierra-en={r.cierraEn ?? ""}
    >
      <h1 className="text-h2 text-ink">Tus resultados</h1>

      {error && <Alert kind="error">{error}</Alert>}

      <TarjetaPuntajeMeta
        caption={captionDeResultado(r.titulo, r.numeroIntento)}
        puntajeCrudo={r.puntaje}
        meta={perfil.meta}
        nombre={perfil.nombre}
        // Un repaso NO se compara con la meta: el resultado oficial es el del diagnóstico, y
        // una barra aquí sugeriría que este número cuenta.
        mostrarMeta={!esRepaso}
      />

      {esRepaso && (
        <Alert kind="info" data-aviso-repaso>
          Repaso — tu resultado oficial es el del primer intento.
        </Alert>
      )}

      {r.enviadoEn !== null && (
        <p className="text-small text-muted">
          Contestado el {fechaHoraMx(r.enviadoEn)}
          {r.formaCierre === "tiempo_agotado" && (
            <span data-cierre-tiempo>
              {" "}
              · se envió automáticamente al agotarse el tiempo
            </span>
          )}
        </p>
      )}

      {/* Desglose. `problema: "clasificaciones"` y el legado sin estampado se DICEN: la
          pantalla nunca pinta ceros que se leerían como un examen reprobado. */}
      {r.problema === "clasificaciones" && (
        <Alert kind="warning" data-problema-clasificaciones>
          No pudimos cargar el detalle por sección de este examen. Tu puntaje sí es correcto.
        </Alert>
      )}
      {r.desglose?.sinDesglose && (
        <Alert kind="info" data-sin-desglose>
          Este simulacro es anterior al detalle por área, así que solo guardamos tu puntaje.
        </Alert>
      )}
      {r.desglose && !r.desglose.sinDesglose && (
        <>
          <AciertosPorSeccion secciones={r.desglose.secciones} />
          <AcordeonAreas acordeon={r.desglose.acordeon} />
        </>
      )}

      {/* Repaso: la CTA existe solo con ventana ABIERTA (derivada del reloj anclado). Con un
          repaso ya vivo se ofrece continuarlo — `iniciarIntento` es idempotente, pero decir
          «Repetir» sobre un intento que ya empezó sería mentir sobre lo que va a pasar. */}
      {ventanaAbierta &&
        (r.repasoEnCurso !== null ? (
          <Button
            variant="secondary"
            onClick={() => router.push(`/examen/${r.repasoEnCurso}`)}
            data-cta="continuar-repaso"
          >
            Continuar repaso
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={repetir}
            disabled={ocupada}
            data-cta="repetir-repaso"
          >
            {ocupada ? "Abriendo…" : "Repetir como repaso"}
          </Button>
        ))}
      {ventanaAbierta && (
        <p className="text-center text-caption text-muted">
          El repaso no cambia tu puntaje: cuenta el primer intento.
        </p>
      )}

      <Link href="/examenes" className={LINK_SECONDARY}>
        Volver a Mis exámenes
      </Link>
    </div>
  );
}
