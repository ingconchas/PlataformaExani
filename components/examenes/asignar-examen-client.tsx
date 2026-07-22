"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { FileText, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  MAX_GRUPOS_DESTINO,
  validarDestinoCrudo,
  type Destino,
} from "@/convex/asignacionDestino";
import {
  MIN_VIGENCIA_RESTANTE_MS,
  estadoDeVentana,
  etiquetaVentana,
  validarVentana,
} from "@/convex/examenEstado";
import { epochDeRelojMx } from "@/convex/fechas";
import { setFlash } from "@/lib/flash";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { RadioCard } from "@/components/ui/radio-card";
import { SearchInput } from "@/components/ui/search-input";
import { ConfirmarCancelacionModal } from "./confirmar-cancelacion-modal";

type Datos = NonNullable<FunctionReturnType<typeof api.asignaciones.paraAsignar>>;
type DatosCompletos = Extract<Datos, { problema: null }>;
type FilaExistente = FunctionReturnType<
  typeof api.asignaciones.existentesDe
>["page"][number];

const PAGINA_EXISTENTES = 20;

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

/** «3 h 00 min» — mismo formato que la biblioteca (Diseño 17/19). */
function formatoDuracion(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** Búsqueda insensible a acentos (mismo criterio que el banco). */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Asignación de examen (LUI-22 · Diseño 19). Doble montaje:
 * `/{instructor/examenes,admin/examenes/biblioteca}/[id]/asignar` con `basePath`
 * explícito (cero `if (admin)` interno — «Todos los grupos» no depende de la ruta sino
 * del estampado `puedeTodosLosGrupos` del servidor).
 *
 * Wrapper de hidratación (patrón `constructor-examen-client`): cascada cargando → no
 * encontrado → `noAsignable` → form montado UNA vez. Las asignaciones existentes van en
 * su PROPIA query paginada (`existentesDe`), que arranca solo cuando `paraAsignar`
 * entregó el id normalizado (el form no se monta antes).
 */
export function AsignarExamenClient({
  basePath,
  examenId,
}: {
  basePath: string;
  examenId: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const datos = useQuery(
    api.asignaciones.paraAsignar,
    isAuthenticated ? { examenId } : "skip",
  );

  if (datos === undefined) {
    return <PageHeader title="Asignar examen" description="Cargando…" />;
  }
  if (datos === null) {
    return (
      <>
        <PageHeader title="Asignar examen" />
        <Alert kind="error">
          No se encontró el examen.{" "}
          <a href={basePath} className="font-semibold underline">
            Volver a exámenes
          </a>
        </Alert>
      </>
    );
  }
  if (datos.problema === "noAsignable") {
    return (
      <>
        <Breadcrumb
          items={[
            { label: "Exámenes", href: basePath },
            { label: datos.titulo },
            { label: "Asignar" },
          ]}
        />
        <PageHeader title="Asignar examen" />
        <Alert kind="warning">
          Solo un examen publicado puede asignarse. «{datos.titulo}» está en
          estado {datos.estado}.{" "}
          <a href={basePath} className="font-semibold underline">
            Volver a exámenes
          </a>
        </Alert>
      </>
    );
  }
  return <AsignarForm key={datos.examen.id} datos={datos} basePath={basePath} />;
}

function AsignarForm({
  datos,
  basePath,
}: {
  datos: DatosCompletos;
  basePath: string;
}) {
  const router = useRouter();
  const asignar = useMutation(api.asignaciones.asignar);
  const existentes = usePaginatedQuery(
    api.asignaciones.existentesDe,
    { examenId: datos.examen.id },
    { initialNumItems: PAGINA_EXISTENTES },
  );

  // ── Estado del formulario ─────────────────────────────────────────────────
  const [destinoTipo, setDestinoTipo] = useState<"todos" | "grupos" | "alumnos">(
    "grupos",
  );
  const [gruposSel, setGruposSel] = useState<string[]>([]);
  const [alumnosSel, setAlumnosSel] = useState<ReadonlySet<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [apertura, setApertura] = useState("");
  const [cierre, setCierre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [modalCancelar, setModalCancelar] = useState<FilaExistente | null>(null);

  const aperturaEpoch = apertura === "" ? null : epochDeRelojMx(apertura);
  const cierreEpoch = cierre === "" ? null : epochDeRelojMx(cierre);

  // ── Reloj ANCLADO al servidor ──────────────────────────────────────────────
  // `useRelojAnclado` (hook compartido, `lib/use-reloj-anclado.ts`) — extraído de AQUÍ al
  // tercer consumidor: `ahoraServidor` es ancla de INICIO, el avance lo pone
  // `performance.now()` y el timer despierta en la próxima frontera con auto-corrección
  // de deriva. Las fronteras son las de las filas cargadas Y la del FORMULARIO
  // (`cierre − MIN_VIGENCIA`): sin esta última, un cierre tecleado que se vence dejaría
  // el botón habilitado hasta otra interacción.
  const fronterasDe = useCallback(() => {
    const fs: number[] = [];
    for (const r of existentes.results) {
      fs.push(r.abreEn, r.cierraEn);
    }
    if (cierreEpoch !== null) fs.push(cierreEpoch - MIN_VIGENCIA_RESTANTE_MS);
    return fs;
  }, [existentes.results, cierreEpoch]);
  const ahora = useRelojAnclado(datos.ahoraServidor, fronterasDe);

  // Validación EN VIVO con el MISMO helper que la mutation — mismo umbral, mismo copy.
  const errorVentana = useMemo(() => {
    if (aperturaEpoch === null || cierreEpoch === null) return null;
    try {
      validarVentana(aperturaEpoch, cierreEpoch, ahora);
      return null;
    } catch (e) {
      return mensajeDeError(e);
    }
  }, [aperturaEpoch, cierreEpoch, ahora]);

  // ── Destino derivado (de datos ESTAMPADOS; cero re-derivación de permisos) ─
  const filasDestino =
    destinoTipo === "todos"
      ? datos.grupos.length
      : destinoTipo === "grupos"
        ? gruposSel.length
        : alumnosSel.size;
  const alumnosQueRecibiran =
    destinoTipo === "todos"
      ? datos.totalAlumnos
      : destinoTipo === "grupos"
        ? datos.grupos
            .filter((g) => gruposSel.includes(g.id))
            .reduce((s, g) => s + g.alumnosCount, 0)
        : alumnosSel.size;

  // El MISMO destino que enviará el submit, validado con el MISMO helper puro de la
  // mutation (revisión de B, medio): sin esto, 31 alumnas o 21 grupos dejaban el botón
  // habilitado y el rechazo llegaba hasta el servidor. La rama «todos» no trae arreglo
  // que `validarDestinoCrudo` acote — su tope se proyecta aquí igual que la mutation lo
  // aplica post-collect.
  const destinoActual: Destino = useMemo(
    () =>
      destinoTipo === "todos"
        ? { tipo: "todosLosGrupos" }
        : destinoTipo === "grupos"
          ? { tipo: "grupos", grupoIds: gruposSel as Id<"grupos">[] }
          : { tipo: "alumnos", alumnoIds: [...alumnosSel] as Id<"users">[] },
    [destinoTipo, gruposSel, alumnosSel],
  );
  const errorDestino = useMemo(() => {
    if (filasDestino === 0) return null;
    if (destinoActual.tipo === "todosLosGrupos") {
      return datos.grupos.length > MAX_GRUPOS_DESTINO
        ? `Hay más de ${MAX_GRUPOS_DESTINO} grupos activos; asigna por grupos específicos.`
        : null;
    }
    try {
      validarDestinoCrudo(destinoActual);
      return null;
    } catch (e) {
      return mensajeDeError(e);
    }
  }, [filasDestino, destinoActual, datos.grupos.length]);

  // ── Capacidad: el cliente PROYECTA filasDestino, no solo `=== 0` ──────────
  const agotada = datos.capacidadRestante === 0;
  const excedeCapacidad = filasDestino > datos.capacidadRestante;
  const hayProgramadaCancelable = existentes.results.some(
    (r) =>
      r.puedeSolicitarCancelar &&
      estadoDeVentana(r.abreEn, r.cierraEn, ahora) === "programada",
  );
  const mensajeCapacidad = agotada
    ? hayProgramadaCancelable
      ? "Este examen alcanzó el máximo de asignaciones; cancela alguna programada para liberar espacio."
      : "Este examen alcanzó el máximo de asignaciones y ya no admite nuevas."
    : excedeCapacidad && filasDestino > 0
      ? `Este destino crearía ${filasDestino} asignaciones y solo quedan ${datos.capacidadRestante} disponibles.`
      : null;

  const puedeConfirmar =
    !enviando &&
    filasDestino > 0 &&
    errorDestino === null &&
    aperturaEpoch !== null &&
    cierreEpoch !== null &&
    errorVentana === null &&
    !excedeCapacidad;

  async function confirmar() {
    if (!puedeConfirmar || aperturaEpoch === null || cierreEpoch === null) return;
    setErrorServidor(null);
    setEnviando(true);
    try {
      const res = await asignar({
        examenId: datos.examen.id,
        destino: destinoActual,
        abreEn: aperturaEpoch,
        cierraEn: cierreEpoch,
      });
      // Mutation exitosa → se NAVEGA SIEMPRE (setFlash falla seguro por dentro: sin
      // storage no hay toast, pero no se invita a un lote duplicado).
      setFlash(
        `Examen asignado. Estará disponible para ${
          res.alumnos === 1 ? "1 alumno" : `${res.alumnos} alumnos`
        } del ${res.rango}.`,
      );
      router.push(basePath);
    } catch (e) {
      setErrorServidor(mensajeDeError(e));
      setEnviando(false);
    }
  }

  function toggleAlumno(userId: string) {
    setAlumnosSel((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const alumnosFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (q === "") return datos.alumnos;
    return datos.alumnos.filter(
      (a) =>
        normalizar(a.nombre).includes(q) ||
        (a.grupoNombre !== null && normalizar(a.grupoNombre).includes(q)),
    );
  }, [busqueda, datos.alumnos]);
  const alumnosSeleccionados = useMemo(
    () => datos.alumnos.filter((a) => alumnosSel.has(a.userId)),
    [datos.alumnos, alumnosSel],
  );

  const seccionTitulo = "text-caption font-semibold uppercase tracking-wide text-muted";

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <Breadcrumb
        items={[
          { label: "Exámenes", href: basePath },
          { label: datos.examen.titulo },
          { label: "Asignar" },
        ]}
      />
      <PageHeader title="Asignar examen" />

      <Card className="flex items-start justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-1 size-5 shrink-0 text-unx-blue" aria-hidden />
          <div>
            <p className="text-body font-semibold text-ink">
              {datos.examen.titulo} — {datos.examen.reactivosCount}{" "}
              {datos.examen.reactivosCount === 1 ? "reactivo" : "reactivos"} ·{" "}
              {formatoDuracion(datos.examen.duracionMin)}
            </p>
            <p className="text-small text-muted">
              Autor: {datos.examen.autorNombre} · {datos.examen.tipoEtiqueta}
            </p>
          </div>
        </div>
        <Badge tone="green">Publicado</Badge>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className={seccionTitulo}>¿A quién va dirigido?</h2>
        <div
          role="radiogroup"
          aria-label="¿A quién va dirigido?"
          className="flex flex-col gap-3"
        >
          {datos.puedeTodosLosGrupos && (
            <RadioCard
              name="destino"
              value="todos"
              checked={destinoTipo === "todos"}
              onSelect={() => setDestinoTipo("todos")}
              title="Todos los grupos"
              sub={`${datos.totalAlumnos} alumnos`}
            />
          )}
          <RadioCard
            name="destino"
            value="grupos"
            checked={destinoTipo === "grupos"}
            onSelect={() => setDestinoTipo("grupos")}
            title="Grupos específicos"
            sub="Elige uno o varios"
          >
            <MultiSelect
              options={datos.grupos.map((g) => ({
                value: g.id,
                label: `${g.nombre} · ${g.alumnosCount} ${g.alumnosCount === 1 ? "alumno" : "alumnos"}`,
              }))}
              value={gruposSel}
              onChange={setGruposSel}
              placeholder="+ Agregar grupo…"
              emptyMessage="No hay grupos disponibles."
            />
          </RadioCard>
          <RadioCard
            name="destino"
            value="alumnos"
            checked={destinoTipo === "alumnos"}
            onSelect={() => setDestinoTipo("alumnos")}
            title="Alumnos individuales"
            sub="Búsqueda por nombre"
          >
            <div className="flex flex-col gap-3">
              {alumnosSeleccionados.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {alumnosSeleccionados.map((a) => (
                    <span
                      key={a.userId}
                      className="inline-flex items-center gap-1.5 rounded-full bg-unx-blue-tint py-1 pl-3 pr-1.5 text-small font-semibold text-unx-blue"
                    >
                      {a.nombre}
                      <button
                        type="button"
                        aria-label={`Quitar a ${a.nombre}`}
                        onClick={() => toggleAlumno(a.userId)}
                        className="inline-flex size-[18px] items-center justify-center rounded-full text-unx-blue transition-colors hover:text-unx-blue-hover"
                      >
                        <X className="size-3" strokeWidth={2.5} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <SearchInput
                fullWidth
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar alumno por nombre…"
                aria-label="Buscar alumno por nombre"
              />
              <div className="max-h-56 overflow-auto rounded-control border border-border">
                {alumnosFiltrados.length === 0 && (
                  <p className="px-3.5 py-2.5 text-small text-muted">
                    Sin resultados.
                  </p>
                )}
                {alumnosFiltrados.map((a) => (
                  <label
                    key={a.userId}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-b-0 hover:bg-bg"
                  >
                    <input
                      type="checkbox"
                      checked={alumnosSel.has(a.userId)}
                      onChange={() => toggleAlumno(a.userId)}
                      className="size-4 accent-unx-blue"
                    />
                    <span className="text-body text-text">{a.nombre}</span>
                    <span className="ml-auto text-small text-muted">
                      {a.grupoNombre ?? "Sin grupo"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </RadioCard>
        </div>
        {filasDestino > 0 && (
          <p
            aria-live="polite"
            className="text-small font-semibold text-unx-blue"
          >
            {alumnosQueRecibiran === 1
              ? "1 alumno recibirá este examen"
              : `${alumnosQueRecibiran} alumnos recibirán este examen`}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={seccionTitulo}>Ventana de aplicación</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asignar-apertura">Apertura</Label>
            <Input
              id="asignar-apertura"
              type="datetime-local"
              value={apertura}
              onChange={(e) => setApertura(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asignar-cierre">Cierre</Label>
            <Input
              id="asignar-cierre"
              type="datetime-local"
              value={cierre}
              onChange={(e) => setCierre(e.target.value)}
              className={errorVentana ? "border-unx-error" : undefined}
              aria-invalid={errorVentana !== null}
            />
            {errorVentana && (
              <p className="text-caption text-unx-error">{errorVentana}</p>
            )}
          </div>
        </div>
        <p className="text-small text-muted">
          Los alumnos podrán contestar solo dentro de esta ventana; dentro de
          ella pueden repetirlo como repaso (solo el primer intento cuenta para
          resultados).
        </p>
      </section>

      {errorVentana && <Alert kind="error">{errorVentana}</Alert>}
      {errorDestino && <Alert kind="warning">{errorDestino}</Alert>}
      {mensajeCapacidad && <Alert kind="warning">{mensajeCapacidad}</Alert>}
      {errorServidor && <Alert kind="error">{errorServidor}</Alert>}

      <section className="flex flex-col gap-3">
        <h2 className={seccionTitulo}>Asignaciones existentes de este examen</h2>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {existentes.results.length === 0 &&
            existentes.status !== "LoadingFirstPage" && (
              <p className="px-4 py-3 text-small text-muted">
                Este examen aún no tiene asignaciones.
              </p>
            )}
          {existentes.results.map((r) => {
            const estado = estadoDeVentana(r.abreEn, r.cierraEn, ahora);
            const cancelable =
              r.puedeSolicitarCancelar && estado === "programada";
            return (
              // `data-asignacion`: gancho de OBSERVABILIDAD para el E2E (precedente
              // `data-item` del constructor, LUI-21): sin él, el orden de la lista no es
              // aseverable — un locator por texto casa también el contenedor, que
              // contiene el texto de TODAS las filas y pasa con cualquier orden.
              <div
                key={r.id}
                data-asignacion
                className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="text-body font-medium text-ink">
                  {r.destinoNombre}
                </span>
                <span className="text-small text-muted">{r.rango}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Badge
                    tone={
                      estado === "programada"
                        ? "blue"
                        : estado === "abierta"
                          ? "green"
                          : "neutral"
                    }
                  >
                    {etiquetaVentana(estado)}
                  </Badge>
                  {cancelable && (
                    <Button
                      variant="ghost"
                      onClick={() => setModalCancelar(r)}
                      aria-label={`Cancelar la asignación de ${r.destinoNombre}`}
                    >
                      Cancelar
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
          {existentes.status === "CanLoadMore" && (
            <button
              type="button"
              onClick={() => existentes.loadMore(PAGINA_EXISTENTES)}
              className="w-full border-t border-border px-4 py-2.5 text-small font-semibold text-unx-blue transition-colors hover:bg-bg"
            >
              Cargar más
            </button>
          )}
        </div>
        <p className="text-small text-muted">
          Un mismo examen puede tener varias asignaciones con ventanas
          distintas.
        </p>
      </section>

      <div className="flex justify-end gap-3">
        <Button
          variant="secondary"
          onClick={() => router.push(basePath)}
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={!puedeConfirmar}>
          {enviando ? "Asignando…" : "Confirmar asignación"}
        </Button>
      </div>

      {modalCancelar && (
        <ConfirmarCancelacionModal
          asignacionId={modalCancelar.id}
          destinoNombre={modalCancelar.destinoNombre}
          rango={modalCancelar.rango}
          onClose={() => setModalCancelar(null)}
        />
      )}
    </div>
  );
}
