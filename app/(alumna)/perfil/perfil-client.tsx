"use client";

import { useEffect, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { BotonCerrarSesion } from "@/components/alumna/boton-cerrar-sesion";
import { SliderMeta } from "@/components/alumna/slider-meta";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import { MAX_TEXTO_META } from "@/convex/metaAlumna";
import { PUNTAJE_BASE, PUNTAJE_MAX } from "@/convex/simulacro";
import { cn } from "@/lib/utils";

type Perfil = NonNullable<FunctionReturnType<typeof api.perfilAlumna.mio>>;
type ModuloId = Perfil["modulos"][number]["id"];

/** Meta con la que se abre la hoja cuando la alumna todavía no tiene ninguna. Es el centro
 *  del rango: no sugiere una ambición ajena, solo da un punto de partida al slider. */
const META_INICIAL = Math.round((PUNTAJE_BASE + PUNTAJE_MAX) / 2);

/** Plazo tras el cual «Cambiar contraseña» deja de esperar la confirmación del servidor y
 *  ofrece reintentar. Convex reintenta la mutation por debajo, así que sin este plazo la UI
 *  se quedaría en «Enviando…» sin fin ante una red caída. */
const PLAZO_RECUPERACION_MS = 8000;

function mensajeDeError(e: unknown): string {
  return e instanceof Error && "data" in e && typeof e.data === "string"
    ? e.data
    : "No se pudo guardar. Intenta de nuevo.";
}

/**
 * MI PERFIL (LUI-36 · Diseño 30): identidad, meta editable, módulos y cuenta.
 *
 * El botón de cerrar sesión se renderiza en LOS TRES estados (cargando, error y datos) —
 * ver `components/alumna/boton-cerrar-sesion.tsx` y `perfil/error.tsx`.
 *
 * Sin chip de racha ni card de insignias: la gamificación está oculta en el MVP (decisión
 * 2026-07-12), aunque el mock las dibuje.
 */
export function PerfilClient() {
  const { isAuthenticated } = useConvexAuth();
  const perfil = useQuery(api.perfilAlumna.mio, isAuthenticated ? {} : "skip");

  // ══ EL SHELL ══ El encabezado y «Cerrar sesión» viven AQUÍ, fuera del condicional, y esa
  // posición estable es funcional, no estética: al cerrar sesión la sesión se cae y la
  // pantalla pasa de «cargada» a «cargando». Si el botón viviera dentro de cada rama, React
  // lo DESMONTARÍA y volvería a montar justo en ese momento, perdiendo su estado — y el
  // aviso de «no se pudo cerrar» nunca llegaría a verse. Lo cazó el E2E del transporte
  // atascado, no la revisión.
  return (
    <div className="flex flex-col gap-4 pb-6" data-perfil>
      <h1 className="text-h2 text-ink">Mi perfil</h1>
      {perfil === undefined ? (
        <p className="text-small text-muted">Cargando…</p>
      ) : (
        <PerfilCargado perfil={perfil} />
      )}
      <BotonCerrarSesion />
    </div>
  );
}

function PerfilCargado({ perfil }: { perfil: Perfil }) {
  const [hoja, setHoja] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* Identidad — solo lectura: el grupo lo gestiona administración (LUI-12). */}
      <div className="flex items-center gap-3.5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-unx-blue-tint text-h3 font-semibold text-unx-blue">
          {iniciales(perfil.nombreCompleto)}
        </span>
        <div className="min-w-0">
          <p className="text-h3 text-ink">{perfil.nombreCompleto}</p>
          <p className="truncate text-caption text-muted" data-identidad>
            {[perfil.grupo && `Grupo ${perfil.grupo}`, perfil.correo]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <CardMeta perfil={perfil} onEditar={() => setHoja(true)} />

      <CardModulos perfil={perfil} onGuardado={() => setToast("Módulos actualizados")} />

      <CardCuenta correo={perfil.correo} />

      {hoja && (
        <HojaEditarMeta
          perfil={perfil}
          onCerrar={() => setHoja(false)}
          onGuardado={() => {
            // El toast se muestra DESPUÉS de cerrar la hoja: el mock lo pinta dentro, donde
            // quedaría tapado por el propio panel y por el backdrop.
            setHoja(false);
            setToast("Meta actualizada");
          }}
        />
      )}
      {toast && <Toast onClose={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return (partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "");
}

function CardMeta({ perfil, onEditar }: { perfil: Perfil; onEditar: () => void }) {
  const meta = perfil.meta;
  return (
    <Card data-card-meta>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Mi meta</CardTitle>
        <button
          type="button"
          onClick={onEditar}
          data-editar-meta
          className="text-small font-semibold text-unx-blue underline"
        >
          {/* El estado SIN FILA no se disfraza de «editar»: no hay nada que editar todavía. */}
          {meta ? "Editar meta" : "Define tu meta"}
        </button>
      </div>
      {meta === null ? (
        <p className="mt-1 text-small text-muted">
          Cuando definas tu meta, la verás como línea de referencia en tus resultados.
        </p>
      ) : (
        <>
          <p className="mt-1 font-semibold text-ink" data-meta-texto>
            {meta.carrera} · {meta.institucion}
          </p>
          <p className="mt-0.5 text-caption text-muted">
            Tu meta marca la línea de referencia en tus gráficas de progreso.
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            <span
              className="font-condensed text-[40px] font-semibold leading-none tabular-nums text-ink"
              data-meta-puntaje
            >
              {meta.puntaje}
            </span>
            <Badge tone="purple">Puntaje objetivo</Badge>
          </div>
        </>
      )}
    </Card>
  );
}

function CardModulos({
  perfil,
  onGuardado,
}: {
  perfil: Perfil;
  onGuardado: () => void;
}) {
  const catalogo = useQuery(api.temario.modulosParaAlumna, {});
  const guardar = useMutation(api.perfilAlumna.guardarModulos);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const elegidos = new Set<string>(perfil.modulos.map((m) => m.id));

  const alternar = async (id: ModuloId) => {
    setError(null);
    setOcupada(true);
    const siguiente = elegidos.has(id)
      ? [...elegidos].filter((x) => x !== id)
      : [...elegidos, id];
    try {
      await guardar({ modulosIds: siguiente as ModuloId[] });
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupada(false);
    }
  };

  return (
    <Card data-card-modulos>
      <div className="flex items-baseline gap-2">
        <CardTitle>Módulos de mi admisión</CardTitle>
        <span className="text-caption text-muted">Opcional</span>
      </div>

      {error && (
        <div className="mt-2">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {/* Módulos que la alumna eligió y el temario ya retiró o borró. Se DICE antes de que
          vuelva a guardar: al hacerlo, la selección nueva solo admite activos y esos se
          pierden. Que ocurra a la vista, y no a sus espaldas, es toda la diferencia. */}
      {perfil.modulosNoDisponibles > 0 && (
        <div className="mt-2">
          <Alert kind="warning" data-modulos-no-disponibles>
            {perfil.modulosNoDisponibles === 1
              ? "1 módulo que elegiste ya no está disponible."
              : `${perfil.modulosNoDisponibles} módulos que elegiste ya no están disponibles.`}
          </Alert>
        </div>
      )}

      {catalogo === undefined ? (
        <p className="mt-3 text-small text-muted">Cargando módulos…</p>
      ) : catalogo.catalogoIncompleto ? (
        <div className="mt-3">
          <Alert kind="warning" data-catalogo-incompleto>
            No pudimos cargar el catálogo de módulos. Inténtalo más tarde.
          </Alert>
        </div>
      ) : catalogo.modulos.length === 0 ? (
        <p className="mt-3 text-small text-muted">
          Tu institución todavía no tiene módulos configurados.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {catalogo.modulos.map((m) => {
            const sel = elegidos.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={sel}
                disabled={ocupada}
                onClick={() => alternar(m.id)}
                data-modulo={m.nombre}
                className={cn(
                  "rounded-full border-[1.5px] px-3.5 py-2 text-small font-semibold transition-colors disabled:opacity-60",
                  sel
                    ? "border-unx-blue bg-unx-blue-tint text-unx-blue"
                    : "border-border bg-surface text-text hover:border-border-strong",
                )}
              >
                {sel ? "✓ " : ""}
                {m.nombre}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CardCuenta({ correo }: { correo: string | null }) {
  const solicitar = useMutation(api.invitaciones.solicitarRecuperacion);
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviado" | "error">(
    "idle",
  );

  // La mutation es SILENCIOSA por diseño (no revela si el correo existe; anti-oráculo de
  // LUI-103): si RESUELVE, la solicitud llegó al servidor y el aviso genérico es correcto.
  // Solo se afirma «enviado» DESPUÉS de que resuelva — el estado optimista anterior mentía
  // ante una caída de red (afirmaba el envío y dejaba un rechazo sin capturar).
  //
  // Un fallo de TRANSPORTE es distinto del silencio del servidor. Las mutations de Convex NO
  // rechazan al perder la red: se encolan y REINTENTAN, así que un `await` a secas se quedaría
  // en «Enviando…» sin fin. Por eso se acota con un plazo: si no CONFIRMA a tiempo, el copy es
  // «no pudimos confirmar el envío» (recuperable) y el botón vuelve.
  //
  // ⚠️ El plazo acota la ESPERA de la UI, NO la mutation: si la red vuelve, Convex puede
  // ejecutarla igual y agendar el correo. Por eso el copy dice «no pudimos confirmar» y NO
  // «no se envió» ni «se canceló» — sería falso. La cuota de LUI-103 acota los duplicados de
  // un reintento; el anti-oráculo se mantiene (el copy de éxito jamás afirma que el correo
  // exista).
  const cambiar = async () => {
    if (correo === null) return;
    setEstado("enviando");
    const confirmado = await Promise.race([
      solicitar({ correo }).then(
        () => true,
        () => false,
      ),
      new Promise<false>((r) => setTimeout(() => r(false), PLAZO_RECUPERACION_MS)),
    ]);
    setEstado(confirmado ? "enviado" : "error");
  };

  return (
    <Card data-card-cuenta>
      <CardTitle>Mi cuenta</CardTitle>
      <p className="mt-1 text-small text-text">{correo ?? "—"}</p>
      {/* Reusa TAL CUAL el flujo de recuperación de LUI-103: público, silencioso por diseño y
          con su cuota por usuario. Aquí no se toca nada del envío. */}
      <button
        type="button"
        disabled={correo === null || estado === "enviando" || estado === "enviado"}
        data-cambiar-contrasena
        onClick={cambiar}
        className="mt-2 block text-small font-semibold text-unx-blue underline disabled:text-muted disabled:no-underline"
      >
        {estado === "enviando" ? "Enviando…" : "Cambiar contraseña"}
      </button>
      <p
        className={cn(
          "mt-1 text-caption",
          estado === "error" ? "text-unx-error" : "text-muted",
        )}
        role={estado === "error" ? "alert" : undefined}
        data-aviso-contrasena
      >
        {estado === "enviado"
          ? "Si tu correo está registrado, te enviamos un enlace."
          : estado === "error"
            ? "No pudimos confirmar el envío. Revisa tu conexión e inténtalo de nuevo."
            : "Te enviaremos un enlace a tu correo."}
      </p>
    </Card>
  );
}

/**
 * Hoja inferior de edición (Diseño 30). `<dialog>` + `showModal()` como el drawer del panel
 * (`sidebar-nav.tsx`): la plataforma da gratis top layer, fondo inerte, Escape nativo y
 * restauración del foco al disparador — todo lo que un panel modal accesible debe tener y
 * que un `div` con `translate` tendría que reimplementar mal.
 */
function HojaEditarMeta({
  perfil,
  onCerrar,
  onGuardado,
}: {
  perfil: Perfil;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const guardar = useMutation(api.perfilAlumna.guardarMeta);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [institucion, setInstitucion] = useState(perfil.meta?.institucion ?? "");
  const [carrera, setCarrera] = useState(perfil.meta?.carrera ?? "");
  // `null` = el borrador del campo numérico todavía no es un puntaje válido. Bloquea el
  // guardado; jamás se sustituye por un valor inventado.
  const [puntaje, setPuntaje] = useState<number | null>(
    perfil.meta?.puntaje ?? META_INICIAL,
  );
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    d.showModal();
    // La verdad del panel es el propio <dialog>: `close` dispara igual con Escape, con el
    // backdrop y con Cancelar, así que el padre se entera por una sola vía.
    const onClose = () => onCerrar();
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onCerrar]);

  const listo =
    puntaje !== null && institucion.trim() !== "" && carrera.trim() !== "";

  const enviar = async () => {
    if (puntaje === null) return;
    setError(null);
    setOcupada(true);
    try {
      await guardar({ institucion, carrera, puntaje });
      dialogRef.current?.close();
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
      setOcupada(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Editar meta"
      data-hoja-meta
      className="m-0 mt-auto w-full max-w-[430px] rounded-t-2xl bg-surface p-5 shadow-modal backdrop:bg-ink/35 open:mx-auto"
    >
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" aria-hidden />
      <h2 className="text-h3 text-ink">Editar meta</h2>

      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <div className="mt-4">
        <Label htmlFor="meta-institucion">Institución</Label>
        <Input
          id="meta-institucion"
          value={institucion}
          maxLength={MAX_TEXTO_META}
          disabled={ocupada}
          onChange={(e) => setInstitucion(e.target.value)}
        />
        <p className="mt-1 text-caption text-muted">
          Escríbela con tus palabras; no necesitas elegirla de una lista.
        </p>
      </div>

      <div className="mt-3">
        <Label htmlFor="meta-carrera">Carrera</Label>
        <Input
          id="meta-carrera"
          value={carrera}
          maxLength={MAX_TEXTO_META}
          disabled={ocupada}
          onChange={(e) => setCarrera(e.target.value)}
        />
        <p className="mt-1 text-caption text-muted">
          Escribe la carrera a la que vas a aplicar.
        </p>
      </div>

      <div className="mt-4">
        <SliderMeta valor={puntaje} onChange={setPuntaje} disabled={ocupada} />
      </div>

      <p className="mt-3 text-caption text-muted">
        Tú decides tu meta; como referencia, el puntaje de corte que publica tu institución.
        El cambio actualiza la línea de meta en todas tus gráficas.
      </p>

      <div className="mt-4 flex gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={ocupada}
          onClick={() => dialogRef.current?.close()}
        >
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={ocupada || !listo}
          data-guardar-meta
          onClick={enviar}
        >
          {ocupada ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </dialog>
  );
}
