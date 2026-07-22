"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useConvexAuth,
  useConvexConnectionState,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ExamHeader } from "@/components/layout/exam-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { MaterialReactivo } from "@/components/reactivos/material-reactivo";
import { CLASE_RICO } from "@/components/reactivos/clase-rico";
import { AnswerOption } from "@/components/examen/answer-option";
import { MapaPreguntas } from "@/components/examen/mapa-preguntas";
import { TerminalIntento } from "@/components/examen/terminal-intento";
import { sanear } from "@/convex/sanitizar";
import {
  ALERTA_TIEMPO_MS,
  CODIGO_TIEMPO_AGOTADO,
  formatearHms,
  limiteDe,
  rachasDeSecciones,
  resumenConfirmacion,
} from "@/convex/simulacro";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";
import { cn } from "@/lib/utils";

type Intento = NonNullable<FunctionReturnType<typeof api.player.intento>>;
type IntentoCargado = Extract<Intento, { problema: null }>;
type Respuestas = NonNullable<FunctionReturnType<typeof api.player.misRespuestas>>;

/** Letras de las opciones: POSICIONALES (A, B, C…), como el diseño. El id real (`a|b|c|d`)
 *  es el que viaja al servidor; la letra es presentación. */
const LETRAS = ["A", "B", "C", "D", "E", "F"];

/** Desconexión sostenida antes de tapar la pantalla: sin este colchón, cualquier
 *  reconexión de un segundo pintaría un modal alarmante a mitad de examen. */
const GRACIA_DESCONEXION_MS = 3_000;

function esTiempoAgotado(e: unknown): boolean {
  return (
    e instanceof ConvexError &&
    typeof e.data === "object" &&
    e.data !== null &&
    (e.data as { code?: string }).code === CODIGO_TIEMPO_AGOTADO
  );
}

/** «Se acabó el tiempo» para un intento que YA cerró el servidor: sin cronómetro que
 *  esperar, solo el aviso y la salida a resultados. */
function TerminalAlVencer({ intentoId }: { intentoId: string }) {
  const router = useRouter();
  return (
    <TerminalIntento
      tipo="tiempo"
      ctaTexto="Ver mis resultados"
      onCta={() => router.push(`/examenes/${intentoId}/resultado`)}
    />
  );
}

/** Navegación imperativa en un efecto (no se puede redirigir durante el render). */
function Redirige({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <p className="p-10 text-center text-small text-muted">Un momento…</p>
  );
}

/**
 * EL PLAYER del simulacro (LUI-26 · Diseño 25).
 *
 * Dos capas por las reglas de Hooks: este wrapper resuelve la carga y `PlayerCargado`
 * posee los hooks del reloj, que deben correr incondicionales.
 *
 * ⚠️ El cargado NO se monta hasta que las TRES queries resolvieron —contenido, respuestas
 * y CURSOR—: `indice` se inicializa una sola vez, así que arrancar con `posicionDe` aún
 * `undefined` fijaría el fallback («primera sin responder») y el eco reactivo posterior ya
 * no movería nada; la reanudación en la última pregunta VISITADA se perdería en silencio.
 */
export function PlayerClient({ intentoId }: { intentoId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const args = isAuthenticated ? { intentoId } : "skip";
  const datos = useQuery(api.player.intento, args);
  const respuestas = useQuery(api.player.misRespuestas, args);
  const posicion = useQuery(api.player.posicionDe, args);

  if (datos === undefined || respuestas === undefined || posicion === undefined) {
    return (
      <p className="p-10 text-center text-small text-muted">
        Cargando tu simulacro…
      </p>
    );
  }
  // Las tres comparten dueño y existencia: si una dice `null`, el intento no es de esta
  // alumna (o no existe) y las otras dirán lo mismo. Se ramifica en conjunto para no
  // afirmar en el tipo una correlación que el servidor garantiza pero TS no ve.
  if (datos === null || respuestas === null || posicion === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-body text-ink">Este simulacro no está disponible.</p>
        <a href="/examenes" className="text-small font-semibold text-unx-blue underline">
          Volver a Mis exámenes
        </a>
      </div>
    );
  }
  if (datos.problema === "enviado") {
    // Cerrado por TIEMPO mientras la alumna lo tenía abierto (o al volver): la pantalla
    // terminal del diseño, no un salto seco al resultado. Entregado a mano: ya vio su
    // confirmación, así que va directo.
    return datos.formaCierre === "tiempo_agotado" ? (
      <TerminalAlVencer intentoId={datos.intentoId} />
    ) : (
      <Redirige href={`/examenes/${datos.intentoId}/resultado`} />
    );
  }
  if (datos.problema !== null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-body text-ink">
          {datos.problema === "fueraDeCota"
            ? "Este examen es demasiado grande para presentarse. Avisa a tu instructor."
            : "El examen de este intento ya no existe."}
        </p>
        <a href="/examenes" className="text-small font-semibold text-unx-blue underline">
          Volver a Mis exámenes
        </a>
      </div>
    );
  }
  return (
    <PlayerCargado
      datos={datos}
      respuestas={respuestas}
      posicionInicial={posicion.posicion}
    />
  );
}

function PlayerCargado({
  datos,
  respuestas,
  posicionInicial,
}: {
  datos: IntentoCargado;
  respuestas: Respuestas;
  posicionInicial: number | null;
}) {
  const router = useRouter();
  const responder = useMutation(api.player.responder);
  const enviar = useMutation(api.player.enviar);
  const marcarPosicion = useMutation(api.player.marcarPosicion);
  const conexion = useConvexConnectionState();

  const total = datos.items.length;

  // Respuestas del servidor, por reactivo.
  const guardadas = useMemo(
    () => new Map(respuestas.respuestas.map((r) => [r.reactivoId, r.opcionElegida])),
    [respuestas.respuestas],
  );

  const primeraSinResponder = useMemo(() => {
    const i = datos.items.findIndex((it) => !guardadas.has(it.id));
    return i === -1 ? Math.max(0, total - 1) : i;
    // Solo al montar: después manda el estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [indice, setIndice] = useState(() =>
    posicionInicial !== null && posicionInicial < total
      ? posicionInicial
      : primeraSinResponder,
  );
  const [mapaAbierto, setMapaAbierto] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState<{
    reactivoId: string;
    opcionId: string;
  } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [posicionConfirmada, setPosicionConfirmada] = useState<number | null>(null);
  const [desconectado, setDesconectado] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(false);
  const preguntaRef = useRef<HTMLDivElement>(null);
  const grupoRef = useRef<HTMLDivElement>(null);
  const autoEnvio = useRef(false);
  const cursorSembrado = useRef(false);

  // ── Reloj: el límite es del SERVIDOR y se DERIVA de los crudos ───────────────
  const limite = useMemo(
    () => limiteDe(datos.iniciadoEn, datos.duracionMin, datos.cierraEn),
    [datos.iniciadoEn, datos.duracionMin, datos.cierraEn],
  );
  const fronterasDe = useCallback(
    () => [limite - ALERTA_TIEMPO_MS, limite],
    [limite],
  );
  // `tickMs: 1000` = la cuenta regresiva; las fronteras son los DOS instantes en que
  // cambia algo más que la cifra (la alerta y el vencimiento).
  const ahora = useRelojAnclado(datos.ahoraServidor, fronterasDe, 1_000);
  const restante = limite - ahora;
  const vencido = restante <= 0;

  // Intentos LEGADOS (los del seed, o cualquiera anterior al cursor inicial que hoy
  // siembra `iniciarIntento`): se persiste UNA vez la posición con la que se abrió, para
  // que cerrar el navegador sin navegar tampoco los mande a otra pregunta.
  useEffect(() => {
    if (posicionInicial !== null || cursorSembrado.current) return;
    cursorSembrado.current = true;
    void marcarPosicion({
      intentoId: datos.intentoId as Id<"intentos">,
      indice,
    }).catch(() => {});
    // Solo al montar: después manda `irA`.
  }, [posicionInicial, marcarPosicion, datos.intentoId, indice]);

  // ── Desconexión SOSTENIDA (el overlay del Diseño 25) ───────────────────────
  // DOS señales, porque miden cosas distintas y ninguna basta sola: el WebSocket de Convex
  // (autoridad real de si las respuestas están llegando, pero tarda en caer — un socket
  // abierto no se entera de que el dispositivo perdió la red hasta su propio timeout) y el
  // evento `offline` del navegador (instantáneo, aunque puede mentir con una red conectada
  // pero sin salida). Se avisa cuando CUALQUIERA falla y de forma sostenida: un parpadeo no
  // tapa el examen. Ambas ramas actualizan ASÍNCRONAMENTE (regla `set-state-in-effect`).
  const [enLinea, setEnLinea] = useState(true);
  useEffect(() => {
    const sincronizar = () => setEnLinea(navigator.onLine);
    const t = setTimeout(sincronizar, 0);
    window.addEventListener("online", sincronizar);
    window.addEventListener("offline", sincronizar);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", sincronizar);
      window.removeEventListener("offline", sincronizar);
    };
  }, []);

  const conectado = conexion.isWebSocketConnected && enLinea;
  // El aviso NO se retira solo al reconectar: lo retira la alumna con «Continuar» (copy
  // del Diseño 25). Que desapareciera bajo sus dedos dejaría el botón sin sentido y le
  // escondería que hubo un corte; el botón se habilita en cuanto hay conexión.
  useEffect(() => {
    if (conectado) return;
    const t = setTimeout(() => setDesconectado(true), GRACIA_DESCONEXION_MS);
    return () => clearTimeout(t);
  }, [conectado]);

  // La entrega del vencimiento, en una función REUTILIZABLE: la disparan el efecto de
  // abajo (una vez al cruzar cero) Y el botón «Reintentar la entrega». Que el botón vuelva
  // a LLAMAR esto —no solo a tocar un ref— es lo que lo hace un reintento de verdad.
  const entregarVencido = useCallback(async () => {
    setErrorEnvio(false);
    try {
      await enviar({ intentoId: datos.intentoId as Id<"intentos"> });
    } catch {
      // Un fallo aquí no atrapa a la alumna: el cierre durable sigue en pie. El botón
      // ofrece reintentar por si el job también se retrasa.
      setErrorEnvio(true);
    }
  }, [enviar, datos.intentoId]);

  // Auto-envío al agotarse el tiempo. Es un ACELERADOR: la autoridad es el cierre durable
  // que el servidor agendó al iniciar el intento (`player.cerrarVencido`).
  //
  // ⚠️ Su resultado NO decide lo que la pantalla afirma: quien lo hace es el read-model
  // (cuando `player.intento` pasa a `{problema:"enviado"}`, el wrapper monta la terminal
  // con su CTA). Mientras tanto se muestra «Enviando…» y el botón de resultados queda
  // deshabilitado — «se envió automáticamente» no puede decirse antes de que sea verdad, y
  // ni la ejecución durable es instantánea (el scheduler tiene retraso propio).
  useEffect(() => {
    if (!vencido || autoEnvio.current) return;
    autoEnvio.current = true;
    void entregarVencido();
  }, [vencido, entregarVencido]);

  // ⚠️ Los `onClose` de los modales van MEMOIZADOS: `ui/Modal` re-ejecuta su efecto de
  // foco cuando cambia esa prop, y el player se re-renderiza CADA SEGUNDO por el
  // cronómetro — con callbacks inline, el foco volvería al primer control una vez por
  // segundo mientras la alumna navega el mapa o lee la confirmación.
  const cerrarMapa = useCallback(() => setMapaAbierto(false), []);
  const cerrarConfirmacion = useCallback(() => {
    setConfirmando(false);
    setErrorEnvio(false); // no arrastrar el error a la próxima apertura del modal
  }, []);
  const cerrarZoom = useCallback(() => setZoom(null), []);

  const irA = (i: number) => {
    const destino = Math.min(Math.max(i, 0), total - 1);
    setIndice(destino);
    // Cursor: se despacha INMEDIATAMENTE (sin debounce) y su confirmación es
    // OBSERVABLE — el examen no considera persistida la navegación hasta que vuelve.
    void marcarPosicion({
      intentoId: datos.intentoId as Id<"intentos">,
      indice: destino,
    })
      .then(() => setPosicionConfirmada(destino))
      .catch(() => {});
    preguntaRef.current?.focus();
  };

  const elegir = async (reactivoId: string, opcionId: string) => {
    setPendiente({ reactivoId, opcionId });
    setGuardando(true);
    setErrorGuardado(null);
    try {
      await responder({
        intentoId: datos.intentoId as Id<"intentos">,
        reactivoId: reactivoId as Id<"reactivos">,
        opcionElegida: opcionId,
      });
    } catch (e) {
      setPendiente(null);
      setErrorGuardado(
        esTiempoAgotado(e)
          ? "Se acabó el tiempo: ya no se guardan respuestas."
          : "No se pudo guardar. Toca de nuevo.",
      );
    } finally {
      setGuardando(false);
    }
  };

  // Envío MANUAL: se navega SOLO si el servidor confirmó. Navegar «pase lo que pase»
  // llevaría a una pantalla de resultados que contestaría «todavía está en curso» — un
  // falso éxito en el flujo central. El error se queda aquí, es recuperable y reintentable.
  const enviarAhora = async () => {
    setEnviando(true);
    setErrorEnvio(false);
    try {
      await enviar({ intentoId: datos.intentoId as Id<"intentos"> });
      router.push(`/examenes/${datos.intentoId}/resultado`);
    } catch {
      setErrorEnvio(true);
      setEnviando(false);
    }
  };

  // ── Estructura: rachas de sección y de lectura ──────────────────────────────
  const rachas = useMemo(
    () => rachasDeSecciones(datos.items.map((i) => ({ seccionId: i.seccionId }))),
    [datos.items],
  );
  const rachaActual = rachas.find(
    (r) => indice + 1 >= r.desde && indice + 1 <= r.hasta,
  );
  const nombreDeSeccion = useCallback(
    (seccionId: string | null) =>
      datos.secciones.find((s) => s.id === seccionId)?.nombre ?? "Sin sección",
    [datos.secciones],
  );

  const item = datos.items[indice];
  const seleccion =
    pendiente && pendiente.reactivoId === item.id
      ? pendiente.opcionId
      : (guardadas.get(item.id) ?? null);

  const contestadas = useMemo(() => {
    const s = new Set<number>();
    datos.items.forEach((it, i) => {
      if (guardadas.has(it.id)) s.add(i);
    });
    if (pendiente) {
      const i = datos.items.findIndex((it) => it.id === pendiente.reactivoId);
      if (i >= 0) s.add(i);
    }
    return s;
  }, [datos.items, guardadas, pendiente]);

  // Posición dentro del BLOQUE de lectura (racha contigua de la misma lectura).
  const bloque = useMemo(() => {
    if (!item.lecturaId) return null;
    let desde = indice;
    while (desde > 0 && datos.items[desde - 1].lecturaId === item.lecturaId) desde--;
    let hasta = indice;
    while (
      hasta < total - 1 &&
      datos.items[hasta + 1].lecturaId === item.lecturaId
    )
      hasta++;
    return { pos: indice - desde + 1, de: hasta - desde + 1 };
  }, [datos.items, indice, item.lecturaId, total]);
  const lectura = item.lecturaId
    ? datos.lecturas.find((l) => l.id === item.lecturaId)
    : null;

  // ── Ramas TERMINALES: antes de pintar una sola pregunta ────────────────────
  //
  // Al cruzar el cero la pantalla deja de aceptar respuestas, pero NO afirma que el examen
  // ya se entregó: eso lo dice el read-model. Mientras `player.intento` siga devolviendo el
  // intento vivo, esta pantalla está «Enviando…» con el CTA deshabilitado; cuando la query
  // re-entregue `{problema:"enviado"}`, el wrapper monta la terminal definitiva.
  if (vencido) {
    return (
      <TerminalIntento
        tipo="tiempo"
        pendiente
        conError={errorEnvio}
        ctaTexto="Ver mis resultados"
        ctaHabilitado={false}
        onCta={() => router.push(`/examenes/${datos.intentoId}/resultado`)}
        onReintentar={() => void entregarVencido()}
      />
    );
  }
  if (desconectado) {
    return (
      <TerminalIntento
        tipo="conexion"
        pregunta={indice + 1}
        ctaTexto="Continuar"
        ctaHabilitado={conectado}
        onCta={() => setDesconectado(false)}
      />
    );
  }

  const alerta = restante <= ALERTA_TIEMPO_MS;

  return (
    <div
      className="mx-auto flex min-h-screen max-w-[430px] flex-col"
      data-player
      data-ahora-servidor={datos.ahoraServidor}
      data-limite={limite}
      data-pregunta={indice + 1}
      data-posicion-confirmada={posicionConfirmada ?? ""}
    >
      <ExamHeader
        seccion={
          rachaActual ? nombreDeSeccion(rachaActual.seccionId) : datos.titulo
        }
        actual={indice + 1}
        total={total}
        tiempo={formatearHms(restante)}
        alerta={alerta}
        onAbrirMapa={() => {
          setSoloPendientes(false);
          setMapaAbierto(true);
        }}
      />

      {alerta && (
        <p
          role="status"
          data-banner-5min
          className="flex items-center gap-2 bg-unx-orange-tint px-5 py-2 text-small font-semibold text-unx-orange-text"
        >
          <AlertTriangle className="size-4" aria-hidden />
          Quedan 5 minutos
        </p>
      )}

      <main
        ref={preguntaRef}
        tabIndex={-1}
        className="flex-1 space-y-4 p-5 focus:outline-none"
      >
        {lectura && (
          <div className="rounded-card border border-border bg-bg p-4">
            <p className="mb-2 text-small font-semibold text-ink">{lectura.titulo}</p>
            <div
              className={cn("text-small text-text", CLASE_RICO)}
              dangerouslySetInnerHTML={{ __html: sanear(lectura.contenidoHtml) }}
            />
            {bloque && (
              <p
                className="mt-3 font-condensed text-caption uppercase tracking-[0.06em] text-unx-blue"
                data-rotulo-lectura
              >
                Pregunta {bloque.pos} de {bloque.de} de esta lectura
              </p>
            )}
          </div>
        )}

        <div
          className={cn("text-body font-medium text-ink", CLASE_RICO)}
          id={`enunciado-${item.id}`}
          dangerouslySetInnerHTML={{ __html: sanear(item.enunciadoHtml) }}
        />

        {item.imagenUrl && (
          <figure className="grid gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imagenUrl}
              alt="Imagen de la pregunta"
              className="max-h-64 w-fit rounded-card border border-border"
            />
            {/* «Ampliar» es un BOTÓN de verdad: operable con teclado y con el foco
                gestionado por el modal. Un texto que parece acción y no hace nada es
                peor que no ofrecerla. */}
            <figcaption>
              <button
                type="button"
                onClick={() => setZoom(item.imagenUrl)}
                aria-haspopup="dialog"
                data-ampliar
                className="text-caption font-semibold text-unx-blue underline"
              >
                Ampliar
              </button>
            </figcaption>
          </figure>
        )}

        {/* SIEMPRE entre enunciado y opciones (contrato de LUI-16); él sanea lo suyo. */}
        <MaterialReactivo material={item.material} />

        {/* Patrón ARIA de radiogroup: Tab entra a UNA opción (roving tabindex) y las
            flechas mueven selección Y FOCO — moverlo solo a medias dejaría el foco en un
            elemento que acaba de volverse `tabIndex=-1`. */}
        <div
          role="radiogroup"
          aria-labelledby={`enunciado-${item.id}`}
          className="grid gap-2"
          ref={grupoRef}
        >
          {item.opciones.map((o, i) => (
            <AnswerOption
              key={o.id}
              letra={LETRAS[i] ?? String(i + 1)}
              seleccionada={seleccion === o.id}
              tabulable={seleccion === null ? i === 0 : seleccion === o.id}
              onSelect={() => void elegir(item.id, o.id)}
              onNavegar={(delta) => {
                const destino =
                  (i + delta + item.opciones.length) % item.opciones.length;
                const siguiente = item.opciones[destino];
                if (!siguiente) return;
                void elegir(item.id, siguiente.id);
                grupoRef.current
                  ?.querySelectorAll<HTMLElement>('[role="radio"]')
                  ?.[destino]?.focus();
              }}
            >
              {o.texto}
            </AnswerOption>
          ))}
        </div>

        <p className="min-h-5 text-small" role="status" data-guardado>
          {errorGuardado ? (
            <span className="text-unx-error">{errorGuardado}</span>
          ) : guardando ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Guardando…
            </span>
          ) : seleccion !== null ? (
            <span className="inline-flex items-center gap-1.5 text-unx-green">
              <Check className="size-4" aria-hidden /> Respuesta guardada
            </span>
          ) : null}
        </p>
      </main>

      <footer className="sticky bottom-0 flex gap-3 border-t border-border bg-surface p-4">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={indice === 0}
          onClick={() => irA(indice - 1)}
          data-nav="anterior"
        >
          Anterior
        </Button>
        <Button
          className="flex-1"
          onClick={() =>
            indice === total - 1 ? setConfirmando(true) : irA(indice + 1)
          }
          data-nav="siguiente"
        >
          Siguiente
        </Button>
      </footer>

      {zoom && (
        <Modal title="Imagen de la pregunta" onClose={cerrarZoom} width={640}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom}
            alt="Imagen de la pregunta, ampliada"
            className="max-h-[70vh] w-full rounded-card object-contain"
            data-imagen-ampliada
          />
        </Modal>
      )}

      {mapaAbierto && (
        <Modal title="Mapa de preguntas" onClose={cerrarMapa}>
          <MapaPreguntas
            total={total}
            contestadas={contestadas}
            indiceActual={indice}
            rachas={rachas}
            nombreDeSeccion={nombreDeSeccion}
            soloSinContestar={soloPendientes}
            onIr={(i) => {
              setMapaAbierto(false);
              irA(i);
            }}
          />
        </Modal>
      )}

      {confirmando && (
        <Modal
          title="Vas a enviar tu simulacro"
          onClose={cerrarConfirmacion}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmando(false);
                  setSoloPendientes(true);
                  setMapaAbierto(true);
                }}
                data-revisar-pendientes
              >
                Revisar pendientes
              </Button>
              <Button
                onClick={() => void enviarAhora()}
                disabled={enviando}
                data-enviar-ahora
              >
                Enviar ahora
              </Button>
            </>
          }
        >
          <p className="text-small text-text" data-resumen-envio>
            {resumenConfirmacion(contestadas.size, total)}
          </p>
          {/* El fallo del envío manual es VISIBLE aquí (el modal sigue abierto), no un
              silencio: «Enviar ahora» reintenta. */}
          {errorEnvio && (
            <p
              className="mt-3 text-small text-unx-error"
              role="alert"
              data-error-envio
            >
              No se pudo enviar. Tu examen sigue guardado en el servidor; intenta de nuevo.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
