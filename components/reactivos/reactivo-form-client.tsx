"use client";

import { type FormEvent, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DifficultyMeter,
  type NivelDificultad,
} from "@/components/ui/difficulty-meter";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FilaTemario = FunctionReturnType<typeof api.temario.listarParaStaff>[number];
type Reactivo = NonNullable<FunctionReturnType<typeof api.reactivos.obtener>>;

const LETRAS = ["a", "b", "c", "d"] as const;
const NIVELES: NivelDificultad[] = ["facil", "medio", "dificil"];

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

/**
 * `/{admin,instructor}/reactivos/{nuevo,[id]/editar}` — el formulario de alta/edición
 * de un reactivo de opción múltiple (LUI-15, Entrega 1). Es el PRIMER formulario de
 * página completa del repo. Espera a `listarParaStaff` (cascada) y —en edición— a
 * `obtener` antes de montar el form interno: así el `useState` se inicializa UNA vez
 * y un refetch no pisa los cambios locales (guard de hidratación).
 */
export function ReactivoFormClient({
  basePath,
  reactivoId,
}: {
  basePath: string;
  reactivoId?: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const temario = useQuery(
    api.temario.listarParaStaff,
    isAuthenticated ? {} : "skip",
  );
  const existente = useQuery(
    api.reactivos.obtener,
    reactivoId && isAuthenticated ? { reactivoId } : "skip",
  );
  const esEdicion = !!reactivoId;

  const cargando =
    temario === undefined || (esEdicion && existente === undefined);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Banco de reactivos", href: `${basePath}/reactivos` },
          { label: esEdicion ? "Editar reactivo" : "Crear reactivo" },
        ]}
      />
      <div className="mt-3">
        <PageHeader title={esEdicion ? "Editar reactivo" : "Crear reactivo"} />
      </div>

      {cargando ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando…
        </div>
      ) : esEdicion && existente === null ? (
        <Alert kind="error">
          No se encontró el reactivo. Vuelve al{" "}
          <a className="underline" href={`${basePath}/reactivos`}>
            banco
          </a>
          .
        </Alert>
      ) : (
        <Formulario
          key={reactivoId ?? "nuevo"}
          basePath={basePath}
          temario={temario}
          inicial={existente ?? null}
        />
      )}
    </>
  );
}

function Formulario({
  basePath,
  temario,
  inicial,
}: {
  basePath: string;
  temario: FilaTemario[];
  inicial: Reactivo | null;
}) {
  const router = useRouter();
  const esEdicion = inicial !== null;
  const crear = useMutation(api.reactivos.crear);
  const actualizar = useMutation(api.reactivos.actualizar);
  const cambiarEstado = useMutation(api.reactivos.cambiarEstado);

  // Estado inicial derivado de `inicial` UNA sola vez (el wrapper monta este
  // componente ya con los datos cargados).
  const [enunciado, setEnunciado] = useState(inicial?.enunciado ?? "");
  const [opciones, setOpciones] = useState<{ texto: string }[]>(
    inicial
      ? inicial.opciones.map((o) => ({ texto: o.texto }))
      : [{ texto: "" }, { texto: "" }, { texto: "" }],
  );
  const [correctaIdx, setCorrectaIdx] = useState<number>(
    inicial ? inicial.opciones.findIndex((o) => o.id === inicial.opcionCorrecta) : -1,
  );
  const [seccionId, setSeccionId] = useState<string>(inicial?.seccionId ?? "");
  const [areaId, setAreaId] = useState<string>(inicial?.areaId ?? "");
  const [subtemaId, setSubtemaId] = useState<string>(inicial?.subtemaId ?? "");
  const [dificultad, setDificultad] = useState<NivelDificultad | "">(
    inicial?.dificultad ?? "",
  );
  const [retroalimentacion, setRetro] = useState(inicial?.retroalimentacion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const tocar = () => setSucio(true);

  // Estados especiales de edición.
  const soloLectura = esEdicion && !inicial.esEditable; // reactivo ajeno abierto por URL
  const bloqueado = esEdicion && inicial.enUso; // en uso → no editar contenido
  const camposDeshabilitados = soloLectura || bloqueado || enviando;

  // ── Cascada de clasificación (disponible + tolera la cadena actual retirada) ──
  const secciones = temario.filter((f) => f.nivel === 1);
  const areas = temario.filter(
    (f): f is Extract<FilaTemario, { nivel: 2 }> => f.nivel === 2,
  );
  const subtemas = temario.filter(
    (f): f is Extract<FilaTemario, { nivel: 3 }> => f.nivel === 3,
  );
  const opcionesDe = (
    nodos: { id: string; nombre: string; disponible: boolean }[],
    actualId: string,
  ) =>
    nodos
      .filter((n) => n.disponible || n.id === actualId)
      .map((n) => ({
        value: n.id,
        label: n.disponible ? n.nombre : `${n.nombre} (retirado)`,
      }));

  const opcSeccion = [
    { value: "", label: "Elige una sección" },
    ...opcionesDe(secciones, seccionId),
  ];
  const opcArea = seccionId
    ? [
        { value: "", label: "Elige un área" },
        ...opcionesDe(
          areas.filter((a) => a.seccionId === seccionId),
          areaId,
        ),
      ]
    : [{ value: "", label: "Elige una sección primero" }];
  const opcSubtema = areaId
    ? [
        { value: "", label: "Elige un subtema" },
        ...opcionesDe(
          subtemas.filter((s) => s.areaId === areaId),
          subtemaId,
        ),
      ]
    : [{ value: "", label: "Elige un área primero" }];

  // ── Editor de opciones (POSICIONAL: la correcta se rastrea por índice) ────────
  const setOpcionTexto = (i: number, texto: string) => {
    setOpciones((prev) => prev.map((o, j) => (j === i ? { texto } : o)));
    tocar();
  };
  const agregarOpcion = () => {
    if (opciones.length >= 4) return;
    setOpciones((prev) => [...prev, { texto: "" }]);
    tocar();
  };
  const quitarOpcion = (i: number) => {
    if (opciones.length <= 3) return;
    setOpciones((prev) => prev.filter((_, j) => j !== i));
    setCorrectaIdx((c) => (c === i ? -1 : c > i ? c - 1 : c));
    tocar();
  };

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const enun = enunciado.trim();
    if (!enun) return setError("Escribe el enunciado.");
    const textos = opciones.map((o) => o.texto.trim());
    if (textos.length < 3) return setError("Agrega al menos 3 opciones.");
    if (textos.some((t) => !t))
      return setError("Cada opción debe tener texto.");
    if (correctaIdx < 0 || correctaIdx >= textos.length)
      return setError("Marca cuál es la opción correcta.");
    if (!retroalimentacion.trim())
      return setError("Escribe la explicación de la respuesta correcta.");
    if (!subtemaId)
      return setError("Completa la clasificación: sección, área y subtema.");
    if (!dificultad) return setError("Elige el nivel de dificultad.");

    const datos = {
      subtemaId: subtemaId as Id<"subtemas">,
      enunciado: enun,
      opciones: textos.map((texto, i) => ({ id: LETRAS[i], texto })),
      opcionCorrecta: LETRAS[correctaIdx],
      dificultad,
      retroalimentacion: retroalimentacion.trim(),
    };
    setEnviando(true);
    try {
      if (inicial) await actualizar({ id: inicial.id, ...datos });
      else await crear(datos);
      router.push(`${basePath}/reactivos`);
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  async function alternarEstado() {
    if (!inicial) return;
    setError(null);
    setEnviando(true);
    try {
      await cambiarEstado({ id: inicial.id, activo: !inicial.activo });
      router.push(`${basePath}/reactivos`);
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  function cancelar() {
    if (sucio && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    router.push(`${basePath}/reactivos`);
  }

  return (
    <form onSubmit={guardar} className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* ── Columna del formulario ── */}
      <div className="grid content-start gap-5">
        {soloLectura && (
          <Alert kind="info">
            Este reactivo es de otro autor: solo lectura. Puedes revisarlo, pero no
            editarlo.
          </Alert>
        )}
        {bloqueado && (
          <Alert kind="warning">
            Este reactivo está en uso en un examen: no puedes editar su contenido,
            solo desactivarlo.
          </Alert>
        )}

        <div>
          <Label htmlFor="enunciado">Enunciado</Label>
          <Textarea
            id="enunciado"
            rows={3}
            value={enunciado}
            disabled={camposDeshabilitados}
            onChange={(e) => {
              setEnunciado(e.target.value);
              tocar();
            }}
            placeholder="Escribe la pregunta. Para potencias/subíndices usa unicode: x², H₂O…"
          />
          <p className="mt-1 text-caption text-muted">
            El editor con formato (negritas, cursiva, super/subíndice) y la imagen
            llegan en la Entrega 2.
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Presentación
          </span>
          <div className="inline-flex rounded-control border border-border bg-bg p-1 text-small">
            <span className="rounded-[6px] bg-surface px-3 py-1.5 font-semibold text-unx-blue shadow-card">
              Pregunta directa
            </span>
            <span className="px-3 py-1.5 text-disabled-text">
              Relación de columnas
            </span>
            <span className="px-3 py-1.5 text-disabled-text">Ordenamiento</span>
          </div>
          <p className="mt-1 text-caption text-muted">
            Todas las presentaciones se contestan como opción múltiple. Relación de
            columnas y ordenamiento llegan en LUI-16.
          </p>
        </div>

        {/* Opciones */}
        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Opciones de respuesta (marca la correcta)
          </span>
          <div className="grid gap-2">
            {opciones.map((o, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <label className="inline-flex shrink-0 items-center gap-2">
                  <input
                    type="radio"
                    name="correcta"
                    checked={i === correctaIdx}
                    disabled={camposDeshabilitados}
                    onChange={() => {
                      setCorrectaIdx(i);
                      tocar();
                    }}
                    className="size-4 accent-unx-blue"
                    aria-label={`Marcar la opción ${LETRAS[i].toUpperCase()} como correcta`}
                  />
                  <span className="w-4 font-condensed font-semibold text-muted">
                    {LETRAS[i].toUpperCase()}
                  </span>
                </label>
                <Input
                  value={o.texto}
                  disabled={camposDeshabilitados}
                  onChange={(e) => setOpcionTexto(i, e.target.value)}
                  placeholder={`Opción ${LETRAS[i].toUpperCase()}`}
                />
                {opciones.length > 3 && !camposDeshabilitados && (
                  <button
                    type="button"
                    onClick={() => quitarOpcion(i)}
                    aria-label={`Quitar la opción ${LETRAS[i].toUpperCase()}`}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg hover:text-unx-error"
                  >
                    <Trash2 className="size-[17px]" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!camposDeshabilitados && (
            <button
              type="button"
              onClick={agregarOpcion}
              disabled={opciones.length >= 4}
              className="mt-2 inline-flex items-center gap-1 text-small font-semibold text-unx-blue disabled:cursor-not-allowed disabled:text-disabled-text"
            >
              <Plus className="size-4" aria-hidden /> Agregar opción (máx. 4)
            </button>
          )}
        </div>

        <div>
          <Label htmlFor="explicacion">Explicación de la respuesta correcta</Label>
          <Textarea
            id="explicacion"
            rows={2}
            value={retroalimentacion}
            disabled={camposDeshabilitados}
            onChange={(e) => {
              setRetro(e.target.value);
              tocar();
            }}
            placeholder="Por qué es correcta. El alumno la verá al revisar sus respuestas."
          />
        </div>

        {/* Clasificación */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Sección"
            options={opcSeccion}
            value={seccionId}
            disabled={camposDeshabilitados}
            onChange={(e) => {
              setSeccionId(e.target.value);
              setAreaId("");
              setSubtemaId("");
              tocar();
            }}
          />
          <Select
            label="Área temática"
            options={opcArea}
            value={areaId}
            disabled={camposDeshabilitados || !seccionId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setSubtemaId("");
              tocar();
            }}
          />
          <Select
            label="Subtema"
            options={opcSubtema}
            value={subtemaId}
            disabled={camposDeshabilitados || !areaId}
            onChange={(e) => {
              setSubtemaId(e.target.value);
              tocar();
            }}
          />
        </div>

        {/* Dificultad */}
        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Nivel de dificultad
          </span>
          <div className="grid grid-cols-3 gap-2">
            {NIVELES.map((n) => (
              <button
                key={n}
                type="button"
                disabled={camposDeshabilitados}
                onClick={() => {
                  setDificultad(n);
                  tocar();
                }}
                aria-pressed={dificultad === n}
                className={cn(
                  "rounded-card border p-3 text-left transition-colors",
                  dificultad === n
                    ? "border-unx-blue ring-1 ring-unx-blue"
                    : "border-border hover:bg-bg",
                  camposDeshabilitados && "cursor-not-allowed opacity-60",
                )}
              >
                <DifficultyMeter level={n} size="chip" showLabel />
              </button>
            ))}
          </div>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        {/* Acciones */}
        {!soloLectura && (
          <div className="flex items-center gap-2 border-t border-border pt-4">
            {esEdicion && (
              <Button
                variant={inicial.activo ? "danger" : "secondary"}
                onClick={alternarEstado}
                disabled={enviando}
              >
                {inicial.activo ? "Desactivar" : "Reactivar"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={cancelar} disabled={enviando}>
                Cancelar
              </Button>
              {!bloqueado && (
                <Button type="submit" disabled={enviando}>
                  {enviando
                    ? "Guardando…"
                    : esEdicion
                      ? "Guardar cambios"
                      : "Guardar reactivo"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Columna de vista previa viva ── */}
      <div>
        <Card className="sticky top-6">
          <p className="font-condensed text-caption font-semibold uppercase tracking-[0.06em] text-muted">
            Vista previa · así lo verá el alumno
          </p>
          <p className="mt-2 whitespace-pre-wrap text-body font-medium text-ink">
            {enunciado || "Tu pregunta aparecerá aquí…"}
          </p>
          <div className="mt-3 grid gap-2">
            {opciones.map((o, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-control border px-3 py-2 text-body",
                  i === correctaIdx
                    ? "border-unx-green bg-unx-green-tint"
                    : "border-border",
                )}
              >
                <span className="font-semibold uppercase text-muted">
                  {LETRAS[i].toUpperCase()}
                </span>
                <span className="flex-1">{o.texto || "…"}</span>
              </div>
            ))}
          </div>
          {dificultad && (
            <div className="mt-3">
              <DifficultyMeter level={dificultad} size="chip" showLabel />
            </div>
          )}
        </Card>
      </div>
    </form>
  );
}
