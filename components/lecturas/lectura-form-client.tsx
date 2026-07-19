"use client";

import { type FormEvent, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  DifficultyMeter,
  type NivelDificultad,
} from "@/components/ui/difficulty-meter";
import { SelectorClasificacion } from "@/components/temario/selector-clasificacion";
import { SelectorDificultad } from "@/components/reactivos/campos-pregunta";
import { CLASE_RICO } from "@/components/reactivos/clase-rico";
import { aTextoPlano, sanear } from "@/convex/sanitizar";
import { MAX_PREGUNTAS, MIN_PREGUNTAS } from "@/convex/bloque";
import { cn } from "@/lib/utils";
import {
  PreguntaDrawer,
  type PreguntaEnviada,
} from "./pregunta-drawer";

type FilaTemario = FunctionReturnType<typeof api.temario.listarParaStaff>[number];
type Lectura = NonNullable<FunctionReturnType<typeof api.lecturas.obtener>>;

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

/**
 * `/{admin,instructor}/lecturas/{nueva,[id]/editar}` — alta y edición de una lectura con su
 * bloque de preguntas (LUI-17). Mismo guard de hidratación que el formulario de reactivo:
 * espera al temario y —en edición— a `obtener` antes de montar el form, para que el
 * `useState` se inicialice UNA vez y un refetch no pise los cambios locales.
 */
export function LecturaFormClient({
  basePath,
  lecturaId,
}: {
  basePath: string;
  lecturaId?: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const temario = useQuery(
    api.temario.listarParaStaff,
    isAuthenticated ? {} : "skip",
  );
  const existente = useQuery(
    api.lecturas.obtener,
    lecturaId && isAuthenticated ? { lecturaId } : "skip",
  );
  const esEdicion = !!lecturaId;
  const cargando = temario === undefined || (esEdicion && existente === undefined);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Lecturas", href: `${basePath}/lecturas` },
          { label: esEdicion ? "Editar lectura" : "Crear lectura" },
        ]}
      />
      <div className="mt-3">
        <PageHeader title={esEdicion ? "Editar lectura" : "Crear lectura"} />
      </div>

      {cargando ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando…
        </div>
      ) : esEdicion && existente === null ? (
        <Alert kind="error">
          No se encontró la lectura. Vuelve al{" "}
          <a className="underline" href={`${basePath}/lecturas`}>
            listado
          </a>
          .
        </Alert>
      ) : (
        <Formulario
          key={lecturaId ?? "nueva"}
          basePath={basePath}
          temario={temario}
          inicial={existente ?? null}
        />
      )}
    </>
  );
}

/** Una pregunta capturada en el ALTA, todavía sin persistir. */
type PreguntaLocal = { uid: string; datos: PreguntaEnviada };

/** A dónde apunta el drawer. El `nonce` distingue dos aperturas seguidas de «nueva». */
type Destino =
  | { tipo: "cerrado" }
  | { tipo: "nueva"; nonce: number }
  | { tipo: "editar"; id: string; nonce: number };

function Formulario({
  basePath,
  temario,
  inicial,
}: {
  basePath: string;
  temario: FilaTemario[];
  inicial: Lectura | null;
}) {
  const router = useRouter();
  const esEdicion = inicial !== null;
  const crear = useMutation(api.lecturas.crear);
  const actualizar = useMutation(api.lecturas.actualizar);
  const cambiarEstado = useMutation(api.lecturas.cambiarEstado);
  const agregarPregunta = useMutation(api.lecturas.agregarPregunta);
  const actualizarPregunta = useMutation(api.lecturas.actualizarPregunta);
  const quitarPregunta = useMutation(api.lecturas.quitarPregunta);
  const moverPregunta = useMutation(api.lecturas.moverPregunta);
  const cambiarEstadoPregunta = useMutation(api.lecturas.cambiarEstadoPregunta);

  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [contenido, setContenido] = useState(inicial?.contenido ?? "");
  const [seccionId, setSeccionId] = useState(inicial?.seccionId ?? "");
  const [areaId, setAreaId] = useState(inicial?.areaId ?? "");
  const [subtemaId, setSubtemaId] = useState(inicial?.subtemaId ?? "");
  const [dificultad, setDificultad] = useState<NivelDificultad | "">(
    inicial?.dificultad ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");

  // En el ALTA el bloque vive aquí hasta guardar: `crear` es atómica, así que cancelar no
  // deja borradores y un fallo parcial no pierde preguntas.
  const proximoUid = useRef(0);
  const [locales, setLocales] = useState<PreguntaLocal[]>([]);
  const [destino, setDestino] = useState<Destino>({ tipo: "cerrado" });
  const nonce = useRef(0);

  const soloLectura = esEdicion && !inicial.esEditable;
  const bloqueado = esEdicion && inicial.enUso;
  const camposDeshabilitados = soloLectura || bloqueado || enviando;

  /** Vista uniforme del bloque, venga del servidor (edición) o del estado (alta). */
  const filas = esEdicion
    ? inicial.preguntas.map((p) => ({
        id: p.id as string,
        enunciado: p.enunciado,
        dificultad: p.dificultad,
        activo: p.activo,
      }))
    : locales.map((l) => ({
        id: l.uid,
        enunciado: l.datos.enunciado,
        dificultad: l.datos.dificultad,
        activo: true,
      }));

  const preguntaDeDestino = (): PreguntaEnviada | null => {
    if (destino.tipo !== "editar") return null;
    if (esEdicion) {
      const p = inicial.preguntas.find((x) => x.id === destino.id);
      return p
        ? {
            enunciado: p.enunciado,
            opciones: p.opciones,
            opcionCorrecta: p.opcionCorrecta,
            dificultad: p.dificultad,
            retroalimentacion: p.retroalimentacion ?? "",
          }
        : null;
    }
    return locales.find((l) => l.uid === destino.id)?.datos ?? null;
  };

  async function conMutation(fn: () => Promise<unknown>, mensaje?: string) {
    setError(null);
    setEnviando(true);
    try {
      await fn();
      if (mensaje) setAviso(mensaje);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function guardarPregunta(datos: PreguntaEnviada) {
    if (destino.tipo === "cerrado") return;
    if (!esEdicion) {
      // Alta: el bloque es local.
      setLocales((prev) =>
        destino.tipo === "editar"
          ? prev.map((l) => (l.uid === destino.id ? { ...l, datos } : l))
          : [...prev, { uid: `p${proximoUid.current++}`, datos }],
      );
      setDestino({ tipo: "cerrado" });
      return;
    }
    await conMutation(async () => {
      if (destino.tipo === "editar")
        await actualizarPregunta({
          reactivoId: destino.id as Id<"reactivos">,
          ...datos,
        });
      else await agregarPregunta({ lecturaId: inicial.id, ...datos });
      setDestino({ tipo: "cerrado" });
    });
  }

  async function quitar(id: string, posicion: number) {
    if (
      !window.confirm(
        "Al quitar una pregunta se renumeran las siguientes.\n\n¿Quitar la pregunta?",
      )
    )
      return;
    if (!esEdicion) {
      setLocales((prev) => prev.filter((l) => l.uid !== id));
      setAviso(`Pregunta ${posicion} quitada.`);
      return;
    }
    await conMutation(
      () => quitarPregunta({ reactivoId: id as Id<"reactivos"> }),
      `Pregunta ${posicion} quitada.`,
    );
  }

  async function mover(id: string, direccion: "arriba" | "abajo", posicion: number) {
    const destinoPos = direccion === "arriba" ? posicion - 1 : posicion + 1;
    const anuncio = `La pregunta se movió a la posición ${destinoPos} de ${filas.length}.`;
    if (!esEdicion) {
      setLocales((prev) => {
        const i = prev.findIndex((l) => l.uid === id);
        const j = direccion === "arriba" ? i - 1 : i + 1;
        if (i === -1 || j < 0 || j >= prev.length) return prev;
        const copia = [...prev];
        [copia[i], copia[j]] = [copia[j], copia[i]];
        return copia;
      });
      setAviso(anuncio);
      return;
    }
    await conMutation(
      () => moverPregunta({ reactivoId: id as Id<"reactivos">, direccion }),
      anuncio,
    );
  }

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Espejo de las reglas del servidor, que es la AUTORIDAD (`convex/bloque.ts`).
    if (!titulo.trim()) return setError("Escribe el título de la lectura.");
    if (!aTextoPlano(contenido).trim())
      return setError("Escribe el texto base de la lectura.");
    if (!subtemaId)
      return setError("Completa la clasificación: sección, área y subtema.");
    if (!dificultad) return setError("Elige el nivel de dificultad.");

    setEnviando(true);
    try {
      if (esEdicion) {
        await actualizar({
          id: inicial.id,
          titulo,
          contenido,
          subtemaId: subtemaId as Id<"subtemas">,
          dificultad,
        });
      } else {
        // Alta ATÓMICA: la lectura y su bloque, en una sola transacción.
        await crear({
          titulo,
          contenido,
          subtemaId: subtemaId as Id<"subtemas">,
          dificultad,
          preguntas: locales.map((l) => l.datos),
        });
      }
      router.push(`${basePath}/lecturas`);
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  const incompleta = filas.length < MIN_PREGUNTAS;

  return (
    <form onSubmit={guardar} className="mt-4 grid max-w-[820px] content-start gap-5">
      {soloLectura && (
        <Alert kind="info">
          Esta lectura es de otro instructor: puedes verla, no editarla.
        </Alert>
      )}
      {bloqueado && (
        <Alert kind="warning">
          Alguna pregunta de esta lectura está en uso en un examen publicado, así que el
          bloque completo está congelado. Solo puedes desactivarla.
        </Alert>
      )}

      <div>
        <Label htmlFor="titulo">Título de la lectura</Label>
        <Input
          id="titulo"
          value={titulo}
          disabled={camposDeshabilitados}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="El calentamiento global"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-small font-medium text-ink">Texto base</span>
        <RichTextEditor
          ariaLabel="Texto base de la lectura"
          value={contenido}
          minHeight={150}
          disabled={camposDeshabilitados}
          onChange={setContenido}
        />
      </div>

      <div>
        <span className="mb-1.5 block text-small font-medium text-ink">
          Clasificación en el temario
        </span>
        <SelectorClasificacion
          temario={temario}
          seccionId={seccionId}
          areaId={areaId}
          subtemaId={subtemaId}
          disabled={camposDeshabilitados}
          onChange={(v) => {
            setSeccionId(v.seccionId);
            setAreaId(v.areaId);
            setSubtemaId(v.subtemaId);
          }}
        />
        <p className="mt-1 text-caption text-muted">
          Las preguntas de esta lectura heredan su clasificación; moverla las mueve a todas.
        </p>
      </div>

      <SelectorDificultad
        valor={dificultad}
        disabled={camposDeshabilitados}
        onChange={setDificultad}
      />

      {/* ── Bloque de preguntas ── */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-h3 text-ink">Preguntas de esta lectura</span>
          {!camposDeshabilitados && (
            <Button
              type="button"
              variant="secondary"
              disabled={filas.length >= MAX_PREGUNTAS}
              onClick={() => {
                nonce.current += 1;
                setDestino({ tipo: "nueva", nonce: nonce.current });
              }}
            >
              <Plus className="size-[18px]" aria-hidden /> Agregar pregunta
            </Button>
          )}
        </div>

        {filas.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-border p-8 text-center text-muted">
            Esta lectura todavía no tiene preguntas. Agrega entre {MIN_PREGUNTAS} y{" "}
            {MAX_PREGUNTAS} para poder usarla en un examen.
          </div>
        ) : (
          <ol className="mt-3 grid list-none gap-2">
            {filas.map((f, i) => (
              <li
                key={f.id}
                className="flex items-start gap-3 rounded-card border border-border bg-surface p-3"
              >
                <span className="mt-0.5 inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-unx-blue-tint font-condensed font-semibold text-unx-blue">
                  {i + 1}
                </span>
                <div
                  className={cn(
                    "min-w-0 flex-1 text-body text-ink",
                    CLASE_RICO,
                    !f.activo && "opacity-55",
                  )}
                  dangerouslySetInnerHTML={{ __html: sanear(f.enunciado) }}
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  {!f.activo && <Badge tone="neutral">Desactivada</Badge>}
                  <DifficultyMeter level={f.dificultad} size="chip" showLabel />
                  {!camposDeshabilitados && (
                    <>
                      <IconBtn
                        label={`Subir la pregunta ${i + 1}`}
                        disabled={i === 0}
                        onClick={() => mover(f.id, "arriba", i + 1)}
                      >
                        <ChevronUp className="size-[17px]" aria-hidden />
                      </IconBtn>
                      <IconBtn
                        label={`Bajar la pregunta ${i + 1}`}
                        disabled={i === filas.length - 1}
                        onClick={() => mover(f.id, "abajo", i + 1)}
                      >
                        <ChevronDown className="size-[17px]" aria-hidden />
                      </IconBtn>
                      <IconBtn
                        label={`Editar la pregunta ${i + 1}`}
                        onClick={() => {
                          nonce.current += 1;
                          setDestino({
                            tipo: "editar",
                            id: f.id,
                            nonce: nonce.current,
                          });
                        }}
                      >
                        <Pencil className="size-[17px]" aria-hidden />
                      </IconBtn>
                      <IconBtn
                        label={`Quitar la pregunta ${i + 1}`}
                        onClick={() => quitar(f.id, i + 1)}
                      >
                        <Trash2 className="size-[17px]" aria-hidden />
                      </IconBtn>
                    </>
                  )}
                  {/* Bajo candado de bloque, cambiar el estado es la ÚNICA operación
                      permitida: sin este control el permiso sería letra muerta. */}
                  {esEdicion && !soloLectura && (
                    <Button
                      type="button"
                      variant={f.activo ? "danger" : "secondary"}
                      disabled={enviando}
                      onClick={() =>
                        conMutation(() =>
                          cambiarEstadoPregunta({
                            reactivoId: f.id as Id<"reactivos">,
                            activo: !f.activo,
                          }),
                        )
                      }
                    >
                      {f.activo ? "Desactivar" : "Reactivar"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {incompleta && filas.length > 0 && (
          <p className="mt-2 text-caption text-unx-orange">
            Bloque incompleto: hacen falta al menos {MIN_PREGUNTAS} preguntas para usar esta
            lectura en un examen.
          </p>
        )}
        <p className="mt-2 text-caption text-muted">
          La lectura se agrega completa a los exámenes; sus preguntas aparecen contiguas y en
          este orden.
        </p>
      </div>

      {/* Cambios de tamaño y orden del bloque, para lector de pantalla. */}
      <p aria-live="polite" className="sr-only">
        {aviso}
      </p>

      {error && <Alert kind="error">{error}</Alert>}

      {!soloLectura && (
        <div className="flex items-center gap-2 border-t border-border pt-4">
          {esEdicion && (
            <Button
              type="button"
              variant={inicial.activo ? "danger" : "secondary"}
              disabled={enviando}
              onClick={() =>
                conMutation(async () => {
                  await cambiarEstado({ id: inicial.id, activo: !inicial.activo });
                  router.push(`${basePath}/lecturas`);
                })
              }
            >
              {inicial.activo ? "Desactivar" : "Reactivar"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={enviando}
              onClick={() => router.push(`${basePath}/lecturas`)}
            >
              Cancelar
            </Button>
            {!bloqueado && (
              <Button type="submit" disabled={enviando}>
                {enviando
                  ? "Guardando…"
                  : esEdicion
                    ? "Guardar cambios"
                    : "Guardar lectura"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ⚠️ Render CONDICIONAL + `key` por identidad. El drawer se DESMONTA al cerrar; si se
          reutilizara la instancia, `RichTextEditor` (que lee `value` solo al montar) mostraría
          el enunciado de la pregunta anterior. El `nonce` distingue además dos aperturas
          seguidas de «nueva», y se incrementa en el MANEJADOR, nunca durante el render. */}
      {destino.tipo !== "cerrado" && (
        <PreguntaDrawer
          key={
            destino.tipo === "editar"
              ? `e-${destino.id}-${destino.nonce}`
              : `n-${destino.nonce}`
          }
          ordinal={
            destino.tipo === "editar"
              ? filas.findIndex((f) => f.id === destino.id) + 1
              : filas.length + 1
          }
          tituloLectura={titulo || "Lectura sin título"}
          inicial={preguntaDeDestino()}
          guardando={enviando}
          onGuardar={guardarPregunta}
          onCerrar={() => setDestino({ tipo: "cerrado" })}
        />
      )}
    </form>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-[34px] items-center justify-center rounded-control border border-border bg-surface text-muted transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
