"use client";

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { ImageUpload } from "@/components/ui/image-upload";
import { Tabs } from "@/components/ui/tabs";
import { aTextoPlano, sanear } from "@/convex/sanitizar";
import { MAX_BYTES, TIPOS_PERMITIDOS } from "@/convex/imagenes";
import {
  MAX_RENGLONES,
  MIN_COLUMNA,
  MIN_ELEMENTOS,
  type MaterialDeReactivo,
} from "@/convex/material";
import { cn } from "@/lib/utils";
import { CLASE_RICO } from "./clase-rico";
import { MaterialReactivo } from "./material-reactivo";

type FilaTemario = FunctionReturnType<typeof api.temario.listarParaStaff>[number];
type Reactivo = NonNullable<FunctionReturnType<typeof api.reactivos.obtener>>;

const LETRAS = ["a", "b", "c", "d"] as const;
const NIVELES: NivelDificultad[] = ["facil", "medio", "dificil"];

/** Un renglón del material con IDENTIDAD propia. El `uid` es estado de cliente: no se
 *  persiste ni viaja en la mutation — solo existe para que React reconcilie por identidad
 *  y no por posición (ver el bloque de estado del material). */
type Renglon = { uid: string; html: string };
type Presentacion = "directa" | "columnas" | "ordenamiento";

const PRESENTACIONES: { id: Presentacion; label: string }[] = [
  { id: "directa", label: "Pregunta directa" },
  { id: "columnas", label: "Relación de columnas" },
  { id: "ordenamiento", label: "Ordenamiento" },
];

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
  const authToken = useAuthToken();

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

  // ── Material de columnas/ordenamiento (LUI-16) ────────────────────────────────
  // ⚠️ Cada renglón lleva un `uid` ESTABLE minteado al crearse, y JAMÁS se usa el índice
  // como `key`. `RichTextEditor` es NO CONTROLADO: lee `value` una sola vez al montar. Con
  // `key={i}`, borrar el renglón de en medio de [A,B,C] dejaría el estado en [A,C] pero
  // React conservaría montado el editor `key=1` **con B dentro** y desmontaría el tercero:
  // la UI mostraría [A,B], el estado diría [A,C], y la siguiente tecla escribiría B encima
  // de C. Corrupción silenciosa, sin un solo error. (Las OPCIONES sí usan `key={i}` y
  // funcionan porque `<Input>` es controlado — copiar ese patrón aquí es el bug.)
  //
  // Los uids INICIALES se derivan del índice al montar (prefijo «i»); los renglones que se
  // agregan después toman uid del contador (prefijo «n»). Prefijos distintos ⇒ un renglón
  // nuevo NUNCA reutiliza el uid de uno borrado, y el contador solo se toca en manejadores
  // de evento — leer un ref durante el render está prohibido (`react-hooks/refs`).
  // Los uids solo tienen que ser únicos entre HERMANOS, así que columna 1 y columna 2
  // pueden repetir «i0» sin problema.
  const proximoUid = useRef(0);
  const nuevoRenglon = (): Renglon => ({ uid: `n${proximoUid.current++}`, html: "" });
  const desdeHtml = (xs: string[]): Renglon[] =>
    xs.map((html, i) => ({ uid: `i${i}`, html }));
  const vacios = (n: number): Renglon[] =>
    Array.from({ length: n }, (_, i) => ({ uid: `i${i}`, html: "" }));

  // Los valores iniciales se calculan en el INICIALIZADOR de `useState`, nunca en render:
  // en render se regenerarían en cada pulsación → remonte por tecla → pérdida de foco y
  // del historial de deshacer.
  const [presentacion, setPresentacion] = useState<Presentacion>(
    inicial?.material?.tipo ?? "directa",
  );
  const [columna1, setColumna1] = useState<Renglon[]>(() =>
    inicial?.material?.tipo === "columnas"
      ? desdeHtml(inicial.material.columna1)
      : vacios(MIN_COLUMNA + 1),
  );
  const [columna2, setColumna2] = useState<Renglon[]>(() =>
    inicial?.material?.tipo === "columnas"
      ? desdeHtml(inicial.material.columna2)
      : vacios(MIN_COLUMNA + 1),
  );
  const [elementos, setElementos] = useState<Renglon[]>(() =>
    inicial?.material?.tipo === "ordenamiento"
      ? desdeHtml(inicial.material.elementos)
      : vacios(MIN_ELEMENTOS),
  );
  // Anuncio para lector de pantalla al agregar/quitar renglones (la lista cambia de
  // tamaño sin que nada más lo comunique).
  const [aviso, setAviso] = useState("");

  // ── Imagen (E3) ──────────────────────────────────────────────────────────────
  const [imagenId, setImagenId] = useState<Id<"_storage"> | null>(
    inicial?.imagenId ?? null,
  );
  const [imagenUrl, setImagenUrl] = useState<string | null>(
    inicial?.imagenUrl ?? null,
  );
  // Solo se conoce el nombre del archivo recién elegido; al recargar de BD no se
  // persiste (decisión: sin campo en el modelo) → el control muestra «Imagen adjunta».
  const [imagenNombre, setImagenNombre] = useState<string | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  // El POST de subida solo devuelve `storageId` (no una URL de lectura): para ver el
  // archivo recién elegido de inmediato se usa un objectURL, revocado al
  // reemplazar/quitar/desmontar para no fugar memoria.
  const objectUrlRef = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function elegirImagen(file: File) {
    setError(null);
    if (!TIPOS_PERMITIDOS.has(file.type))
      return setError("Formato no permitido: usa PNG, JPG, WEBP o GIF.");
    if (file.size > MAX_BYTES)
      return setError("La imagen supera el límite de 5 MB.");
    // Snapshot para restaurar la imagen anterior si el POST falla (nota de auditoría).
    const prev = {
      id: imagenId,
      url: imagenUrl,
      nombre: imagenNombre,
      objectUrl: objectUrlRef.current,
    };
    // objectURL ANTES del await → vista previa inmediata del archivo local.
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImagenUrl(url);
    setImagenNombre(file.name);
    setSubiendoImagen(true);
    tocar();
    try {
      // Subida por el HTTP action autenticado: valida tamaño/tipo ANTES de almacenar
      // (la URL de subida de Convex no tiene tope de tamaño).
      const sitio = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(
        /\.cloud$/,
        ".site",
      );
      const res = await fetch(`${sitio}/reactivos/imagen`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          Authorization: `Bearer ${authToken ?? ""}`,
        },
        body: file,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ConvexError(data.error ?? "No se pudo subir la imagen.");
      }
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      if (!montado.current) return URL.revokeObjectURL(url);
      setImagenId(storageId);
    } catch (err) {
      URL.revokeObjectURL(url);
      if (!montado.current) return;
      objectUrlRef.current = prev.objectUrl;
      setImagenId(prev.id);
      setImagenUrl(prev.url);
      setImagenNombre(prev.nombre);
      setError(mensajeDeError(err));
    } finally {
      if (montado.current) setSubiendoImagen(false);
    }
  }

  function quitarImagen() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImagenId(null);
    setImagenUrl(null);
    setImagenNombre(null);
    tocar();
  }

  // Estados especiales de edición.
  const soloLectura = esEdicion && !inicial.esEditable; // reactivo ajeno abierto por URL
  const bloqueado = esEdicion && inicial.enUso; // en uso → no editar contenido
  const camposDeshabilitados = soloLectura || bloqueado || enviando;
  // Bloqueo del submit mientras sube una imagen: guardar sin el `storageId` persistiría el
  // reactivo SIN imagen y dejaría el blob huérfano.
  const ocupado = enviando || subiendoImagen;

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

  // ── Editor de renglones del material (por UID, nunca por índice: el índice pudo
  // cambiar entre el render y el evento) ────────────────────────────────────────
  type SetRenglones = Dispatch<SetStateAction<Renglon[]>>;
  const setRenglon = (set: SetRenglones, uid: string, html: string) => {
    set((prev) => prev.map((r) => (r.uid === uid ? { ...r, html } : r)));
    tocar();
  };
  const agregarRenglon = (set: SetRenglones, etiqueta: string) => {
    set((prev) => (prev.length >= MAX_RENGLONES ? prev : [...prev, nuevoRenglon()]));
    setAviso(`Renglón agregado a ${etiqueta}.`);
    tocar();
  };
  const quitarRenglon = (
    set: SetRenglones,
    uid: string,
    minimo: number,
    etiqueta: string,
  ) => {
    // Las opciones de respuesta referencian POSICIONES («1b, 2c, 3a»), y el servidor no
    // puede detectar que quedaron descuadradas: son texto libre por contrato. Por eso se
    // confirma explícitamente en vez de validar.
    if (
      !window.confirm(
        "Al quitar un renglón se renumeran los siguientes. Las opciones de respuesta " +
          "que referencian posiciones («1b, 2c, 3a») pueden quedar mal: revísalas antes " +
          "de guardar.\n\n¿Quitar el renglón?",
      )
    )
      return;
    set((prev) => (prev.length <= minimo ? prev : prev.filter((r) => r.uid !== uid)));
    setAviso(`Renglón quitado de ${etiqueta}. Revisa las opciones de respuesta.`);
    tocar();
  };

  /** El material que se PERSISTE, derivado de la presentación activa. Cambiar de pestaña
   *  no destruye el estado local (un clic accidental es recuperable con otro clic): lo que
   *  decide qué se guarda es esta derivación. */
  function materialActual(): MaterialDeReactivo | undefined {
    if (presentacion === "columnas")
      return {
        tipo: "columnas",
        columna1: columna1.map((r) => r.html),
        columna2: columna2.map((r) => r.html),
      };
    if (presentacion === "ordenamiento")
      return { tipo: "ordenamiento", elementos: elementos.map((r) => r.html) };
    return undefined;
  }

  /** Una lista repetible de renglones del material. `titulo` da el nombre accesible de
   *  cada editor («Columna 1, renglón 2») — determinista y por POSICIÓN, que es lo que
   *  referencian las opciones de respuesta. */
  const listaRenglones = (
    titulo: string,
    renglones: Renglon[],
    set: SetRenglones,
    minimo: number,
    marca: (i: number) => string,
  ) => (
    <div>
      <span className="mb-1.5 block text-small font-medium text-ink">{titulo}</span>
      <div className="grid gap-2">
        {renglones.map((r, i) => (
          // key={r.uid}, NUNCA el índice — ver el bloque de estado del material.
          <div key={r.uid} className="flex items-start gap-2">
            <span className="mt-2.5 w-5 shrink-0 font-condensed font-semibold text-muted">
              {marca(i)}
            </span>
            <div className="min-w-0 flex-1">
              <RichTextEditor
                ariaLabel={`${titulo}, renglón ${i + 1}`}
                value={r.html}
                disabled={camposDeshabilitados}
                onChange={(html) => setRenglon(set, r.uid, html)}
              />
            </div>
            {renglones.length > minimo && !camposDeshabilitados && (
              <button
                type="button"
                onClick={() => quitarRenglon(set, r.uid, minimo, titulo)}
                aria-label={`Quitar el renglón ${i + 1} de ${titulo}`}
                className="mt-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg hover:text-unx-error"
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
          onClick={() => agregarRenglon(set, titulo)}
          disabled={renglones.length >= MAX_RENGLONES}
          className="mt-2 inline-flex items-center gap-1 text-small font-semibold text-unx-blue disabled:cursor-not-allowed disabled:text-disabled-text"
        >
          <Plus className="size-4" aria-hidden /> Agregar renglón a {titulo} (máx.{" "}
          {MAX_RENGLONES})
        </button>
      )}
    </div>
  );

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (subiendoImagen)
      return setError("Espera a que termine de subir la imagen.");
    if (!aTextoPlano(enunciado).trim())
      return setError("Escribe el enunciado.");
    const textos = opciones.map((o) => o.texto.trim());
    if (textos.length < 3) return setError("Agrega al menos 3 opciones.");
    if (textos.some((t) => !t))
      return setError("Cada opción debe tener texto.");
    if (correctaIdx < 0 || correctaIdx >= textos.length)
      return setError("Marca cuál es la opción correcta.");
    if (!aTextoPlano(retroalimentacion).trim())
      return setError("Escribe la explicación de la respuesta correcta.");
    if (!subtemaId)
      return setError("Completa la clasificación: sección, área y subtema.");
    if (!dificultad) return setError("Elige el nivel de dificultad.");

    // Espejo de las reglas del material; la AUTORIDAD es el servidor (`convex/material.ts`),
    // que las revalida ante un cliente manipulado.
    const material = materialActual();
    if (material) {
      const minimo = material.tipo === "columnas" ? MIN_COLUMNA : MIN_ELEMENTOS;
      const listas: [string, string[]][] =
        material.tipo === "columnas"
          ? [
              ["la columna 1", material.columna1],
              ["la columna 2", material.columna2],
            ]
          : [["la lista de elementos", material.elementos]];
      for (const [etiqueta, renglones] of listas) {
        if (renglones.length < minimo)
          return setError(`Agrega al menos ${minimo} renglones a ${etiqueta}.`);
        if (renglones.some((h) => !aTextoPlano(h).trim()))
          return setError(`Hay un renglón vacío en ${etiqueta}.`);
      }
    }

    const base = {
      subtemaId: subtemaId as Id<"subtemas">,
      enunciado, // HTML enriquecido; el servidor lo sanea
      opciones: textos.map((texto, i) => ({ id: LETRAS[i], texto })),
      opcionCorrecta: LETRAS[correctaIdx],
      dificultad,
      retroalimentacion, // HTML enriquecido; el servidor lo sanea
    };
    setEnviando(true);
    try {
      if (inicial) {
        // Op discriminada de imagen respecto a la que traía el reactivo.
        const previa = inicial.imagenId ?? null;
        const imagen =
          imagenId === previa
            ? ({ op: "mantener" } as const)
            : imagenId === null
              ? ({ op: "quitar" } as const)
              : ({ op: "reemplazar", imagenId } as const);
        await actualizar({
          id: inicial.id,
          ...base,
          imagen,
          // Intención SIEMPRE explícita. El default de compatibilidad («argumento ausente =
          // mantener») existe para un cliente viejo que no conoce el campo, no para este:
          // aquí sabemos exactamente si hay material o si volvió a pregunta directa.
          material: material
            ? ({ op: "reemplazar", material } as const)
            : ({ op: "quitar" } as const),
        });
      } else {
        await crear({ ...base, imagenId: imagenId ?? undefined, material });
      }
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
          <Label>Enunciado</Label>
          <RichTextEditor
            ariaLabel="Enunciado del reactivo"
            value={enunciado}
            disabled={camposDeshabilitados}
            onChange={(html) => {
              setEnunciado(html);
              tocar();
            }}
          />
          <div className="mt-2">
            <ImageUpload
              ariaLabel="Imagen del reactivo"
              previewUrl={imagenUrl}
              fileName={imagenNombre}
              uploading={subiendoImagen}
              disabled={camposDeshabilitados}
              onPick={elegirImagen}
              onRemove={quitarImagen}
            />
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-small font-medium text-ink">
            Presentación
          </span>
          <Tabs
            tabs={PRESENTACIONES}
            activeId={presentacion}
            disabled={camposDeshabilitados}
            onChange={(id) => {
              // Cambiar de pestaña NO borra las listas: un clic accidental en «Pregunta
              // directa» se recupera con otro clic. Lo que se persiste lo decide
              // `materialActual()` al guardar.
              setPresentacion(id as Presentacion);
              tocar();
            }}
          />
          <p className="mt-1 text-caption text-muted">
            Todas las presentaciones se contestan como opción múltiple: las opciones son
            combinaciones («1b, 2c, 3a») o secuencias («3, 2, 1, 4»).
          </p>
        </div>

        {presentacion === "columnas" && (
          <div className="grid gap-4 rounded-card border border-border bg-bg/50 p-4">
            {listaRenglones("Columna 1", columna1, setColumna1, MIN_COLUMNA, (i) => `${i + 1}.`)}
            {listaRenglones("Columna 2", columna2, setColumna2, MIN_COLUMNA, (i) =>
              `${String.fromCharCode(97 + i)}.`,
            )}
          </div>
        )}

        {presentacion === "ordenamiento" && (
          <div className="rounded-card border border-border bg-bg/50 p-4">
            {listaRenglones(
              "Elementos a ordenar",
              elementos,
              setElementos,
              MIN_ELEMENTOS,
              (i) => `${i + 1}.`,
            )}
          </div>
        )}

        {/* Cambios de tamaño de las listas para lector de pantalla. */}
        <p aria-live="polite" className="sr-only">
          {aviso}
        </p>

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
          <Label>Explicación de la respuesta correcta</Label>
          <RichTextEditor
            ariaLabel="Explicación de la respuesta correcta"
            value={retroalimentacion}
            disabled={camposDeshabilitados}
            onChange={(html) => {
              setRetro(html);
              tocar();
            }}
          />
          <p className="mt-1 text-caption text-muted">
            El alumno la verá al revisar sus respuestas.
          </p>
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
                disabled={ocupado}
              >
                {inicial.activo ? "Desactivar" : "Reactivar"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={cancelar} disabled={enviando}>
                Cancelar
              </Button>
              {!bloqueado && (
                <Button type="submit" disabled={ocupado}>
                  {subiendoImagen
                    ? "Subiendo…"
                    : enviando
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
          {aTextoPlano(enunciado).trim() ? (
            <div
              className={cn("mt-2 text-body font-medium text-ink", CLASE_RICO)}
              dangerouslySetInnerHTML={{ __html: sanear(enunciado) }}
            />
          ) : (
            <p className="mt-2 text-body font-medium text-muted">
              Tu pregunta aparecerá aquí…
            </p>
          )}
          {imagenUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- objectURL local o URL de storage
            <img
              src={imagenUrl}
              alt="Imagen del reactivo"
              className="mt-3 max-h-40 w-fit rounded-card border border-border"
            />
          )}
          {/* El material va entre el enunciado y las opciones, igual que en el player.
              Aquí recibe HTML CRUDO de TipTap (nunca pasó por el servidor): el componente
              lo sanea, que es justo por qué el saneo vive dentro y no en el llamador. */}
          <MaterialReactivo material={materialActual()} className="mt-3" />
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
