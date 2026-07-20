"use client";

import { type ReactNode, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { type FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookText, Eye, Lock, Pencil, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import {
  DifficultyMeter,
  etiquetaDificultad,
  type NivelDificultad,
} from "@/components/ui/difficulty-meter";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FiltrosActivos, type ChipFiltro } from "./filtros-activos";
import { ReactivoPreviewModal } from "./reactivo-preview-modal";

type FilaTemario = FunctionReturnType<typeof api.temario.listarParaStaff>[number];

const PAGE_SIZE = 8;
type Estado = "todos" | "disponibles" | "desactivados";

const COLUMNS: DataTableColumn[] = [
  { key: "enunciado", label: "Enunciado" },
  { key: "seccion", label: "Sección" },
  { key: "area", label: "Área" },
  { key: "subtema", label: "Subtema" },
  { key: "dificultad", label: "Dificultad" },
  { key: "autor", label: "Autor" },
  { key: "acciones", label: "Acciones", align: "right" },
];

/** Búsqueda insensible a acentos (los enunciados los tienen). */
function normalizar(s: string): string {
  // Quita los signos diacríticos combinantes (U+0300–U+036F) tras descomponer.
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function truncar(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/**
 * `/{admin,instructor}/reactivos` — el banco de reactivos (LUI-14), montado en las
 * dos zonas con el mismo cliente. `basePath` solo distingue a dónde apuntan los
 * enlaces de crear/editar; el resto es idéntico porque el servidor estampa
 * `esEditable` por fila (admin edita todo; instructor solo lo suyo).
 *
 * Molde del repo: el servidor entrega TODO (`reactivos.listar`) y el cliente
 * filtra + ordena + pagina en memoria. El candado («en uso») llega en una query
 * aparte (`reactivos.enUso`) con su propio presupuesto de lectura.
 */
export function BancoReactivosClient({ basePath }: { basePath: string }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const listar = useQuery(api.reactivos.listar, isAuthenticated ? {} : "skip");
  const enUso = useQuery(api.reactivos.enUso, isAuthenticated ? {} : "skip");
  const temario = useQuery(
    api.temario.listarParaStaff,
    isAuthenticated ? {} : "skip",
  );
  // El candado depende de `enUso`. La tabla NO se renderiza hasta que `enUso` esté
  // definido (ver el guard de carga abajo): si no, durante el lapso en que `listar`
  // ya cargó pero `enUso` no, un reactivo editable-y-bloqueado mostraría el LÁPIZ en
  // vez del candado —el contrato central de LUI-14—. El `?? []` solo cubre ese lapso
  // previo al render (las filas calculadas entonces nunca se muestran).
  const bloqueados = new Set(enUso ?? []);

  const [busqueda, setBusqueda] = useState("");
  const [filtroSeccion, setFiltroSeccion] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroSubtema, setFiltroSubtema] = useState("");
  const [filtroDificultad, setFiltroDificultad] = useState<"" | NivelDificultad>("");
  const [filtroAutor, setFiltroAutor] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<Estado>("todos");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);

  // ── Opciones de los filtros ────────────────────────────────────────────────
  const filas = temario ?? [];
  const secciones = filas.filter((f) => f.nivel === 1);
  const areas = filas.filter(
    (f): f is Extract<FilaTemario, { nivel: 2 }> => f.nivel === 2,
  );
  const subtemas = filas.filter(
    (f): f is Extract<FilaTemario, { nivel: 3 }> => f.nivel === 3,
  );
  const etiquetaNodo = (nombre: string, activo: boolean) =>
    activo ? nombre : `${nombre} (desactivado)`;

  const opcSeccion = [
    { value: "", label: "Sección: todas" },
    ...secciones.map((s) => ({ value: s.id, label: etiquetaNodo(s.nombre, s.activo) })),
  ];
  const areasDeLaSeccion = areas.filter((a) => a.seccionId === filtroSeccion);
  const opcArea = filtroSeccion
    ? [
        { value: "", label: "Área: todas" },
        ...areasDeLaSeccion.map((a) => ({
          value: a.id,
          label: etiquetaNodo(a.nombre, a.activo),
        })),
      ]
    : [{ value: "", label: "Elige una sección" }];
  const subtemasDelArea = subtemas.filter((st) => st.areaId === filtroArea);
  const opcSubtema = filtroArea
    ? [
        { value: "", label: "Subtema: todos" },
        ...subtemasDelArea.map((st) => ({
          value: st.id,
          label: etiquetaNodo(st.nombre, st.activo),
        })),
      ]
    : [{ value: "", label: "Elige un área" }];

  const opcDificultad = [
    { value: "", label: "Dificultad: todas" },
    { value: "facil", label: etiquetaDificultad.facil },
    { value: "medio", label: etiquetaDificultad.medio },
    { value: "dificil", label: etiquetaDificultad.dificil },
  ];
  const autores = [
    ...new Map(
      (listar ?? []).map((r) => [r.autorId, r.autorNombre] as const),
    ).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const opcAutor = [{ value: "", label: "Autor: todos" }, ...autores];
  const opcEstado = [
    { value: "todos", label: "Estado: todos" },
    { value: "disponibles", label: "Disponibles" },
    { value: "desactivados", label: "Desactivados" },
  ];

  // ── Filtrado + orden + paginación (en memoria, como el resto del repo) ──────
  const q = normalizar(busqueda.trim());
  const filtrados = (listar ?? []).filter((r) => {
    if (filtroSeccion && r.seccionId !== filtroSeccion) return false;
    if (filtroArea && r.areaId !== filtroArea) return false;
    if (filtroSubtema && r.subtemaId !== filtroSubtema) return false;
    if (filtroDificultad && r.dificultad !== filtroDificultad) return false;
    if (filtroAutor && r.autorId !== filtroAutor) return false;
    if (filtroEstado === "disponibles" && !r.activo) return false;
    if (filtroEstado === "desactivados" && r.activo) return false;
    if (q && !normalizar(r.enunciado).includes(q)) return false;
    return true;
  });
  const ordenados = [...filtrados].sort(
    (a, b) =>
      a.seccionNombre.localeCompare(b.seccionNombre, "es") ||
      a.areaNombre.localeCompare(b.areaNombre, "es") ||
      a.subtemaNombre.localeCompare(b.subtemaNombre, "es") ||
      a.enunciado.localeCompare(b.enunciado, "es"),
  );
  const pageCount = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = ordenados.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const total = listar?.length ?? 0;
  const hayFiltros =
    !!busqueda.trim() ||
    !!filtroSeccion ||
    !!filtroArea ||
    !!filtroSubtema ||
    !!filtroDificultad ||
    !!filtroAutor ||
    filtroEstado !== "todos";

  // ── Chips de filtros activos ────────────────────────────────────────────────
  const nombreDe = (lista: { id: string; nombre: string }[], id: string) =>
    lista.find((x) => x.id === id)?.nombre ?? id;
  const limpiar = () => {
    setBusqueda("");
    setFiltroSeccion("");
    setFiltroArea("");
    setFiltroSubtema("");
    setFiltroDificultad("");
    setFiltroAutor("");
    setFiltroEstado("todos");
    setPage(1);
  };
  const chips: ChipFiltro[] = [];
  if (filtroSeccion)
    chips.push({
      key: "seccion",
      label: `Sección: ${nombreDe(secciones, filtroSeccion)}`,
      onRemove: () => {
        setFiltroSeccion("");
        setFiltroArea("");
        setFiltroSubtema("");
        setPage(1);
      },
    });
  if (filtroArea)
    chips.push({
      key: "area",
      label: `Área: ${nombreDe(areas, filtroArea)}`,
      onRemove: () => {
        setFiltroArea("");
        setFiltroSubtema("");
        setPage(1);
      },
    });
  if (filtroSubtema)
    chips.push({
      key: "subtema",
      label: `Subtema: ${nombreDe(subtemas, filtroSubtema)}`,
      onRemove: () => {
        setFiltroSubtema("");
        setPage(1);
      },
    });
  if (filtroDificultad)
    chips.push({
      key: "dificultad",
      label: `Dificultad: ${etiquetaDificultad[filtroDificultad]}`,
      onRemove: () => {
        setFiltroDificultad("");
        setPage(1);
      },
    });
  if (filtroAutor)
    chips.push({
      key: "autor",
      label: `Autor: ${autores.find((a) => a.value === filtroAutor)?.label ?? filtroAutor}`,
      onRemove: () => {
        setFiltroAutor("");
        setPage(1);
      },
    });
  if (filtroEstado !== "todos")
    chips.push({
      key: "estado",
      label: `Estado: ${filtroEstado === "disponibles" ? "Disponibles" : "Desactivados"}`,
      onRemove: () => {
        setFiltroEstado("todos");
        setPage(1);
      },
    });
  if (busqueda.trim())
    chips.push({
      key: "busqueda",
      label: `Búsqueda: «${busqueda.trim()}»`,
      onRemove: () => {
        setBusqueda("");
        setPage(1);
      },
    });

  // ── Filas de la tabla ───────────────────────────────────────────────────────
  const rows: DataTableRow[] = visibles.map((r) => ({
    id: r.id,
    enunciado: (
      <div className={cn("max-w-[440px]", !r.activo && "opacity-55")}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{truncar(r.enunciado, 100)}</span>
          {!r.activo && <Badge tone="neutral">Desactivado</Badge>}
          {/* Presentación (LUI-16). Solo viaja el discriminante, no los renglones: la
              celda sigue mostrando el enunciado en TEXTO PLANO y el material NO es
              buscable en esta entrega. */}
          {r.presentacion !== "directa" && (
            <Badge tone="neutral">
              {r.presentacion === "columnas" ? "Columnas" : "Ordenamiento"}
            </Badge>
          )}
        </div>
        {/* El chip es un ENLACE a su lectura (LUI-17): desde cualquier pregunta se llega al
            pasaje. Cuando la referencia es INCONSISTENTE (`bloque` y el `lecturaId`
            deprecado apuntan a lecturas distintas) el servidor ya suprime `lecturaId`, así
            que no hay a dónde enlazar y se degrada a texto. */}
        {r.tieneLectura &&
          (r.lecturaId ? (
            <Link
              href={`${basePath}/lecturas/${r.lecturaId}/editar`}
              className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-unx-blue-tint px-2 py-0.5 text-caption font-semibold text-unx-blue transition-colors hover:bg-unx-blue hover:text-white"
            >
              <BookText className="size-3" aria-hidden />
              Lectura: {r.lecturaTitulo}
            </Link>
          ) : (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-unx-blue-tint px-2 py-0.5 text-caption font-semibold text-unx-blue">
              <BookText className="size-3" aria-hidden />
              Lectura: {r.lecturaTitulo}
            </span>
          ))}
      </div>
    ),
    seccion: <span className="text-muted">{r.seccionNombre}</span>,
    area: <span className="text-muted">{r.areaNombre}</span>,
    subtema: <span className="text-muted">{r.subtemaNombre}</span>,
    dificultad: <DifficultyMeter level={r.dificultad} size="chip" showLabel />,
    autor: (
      <span className="inline-flex items-center gap-2">
        <Avatar nombre={r.autorNombre} size={26} />
        <span className="whitespace-nowrap text-small">{r.autorNombre}</span>
      </span>
    ),
    acciones: (
      <div className="flex justify-end gap-1.5">
        <IconBtn
          label={`Ver el reactivo «${truncar(r.enunciado, 40)}»`}
          className="text-unx-blue"
          onClick={() => setPreview(r.id)}
        >
          <Eye className="size-[17px]" aria-hidden />
        </IconBtn>
        {/* PUERTA ÚNICA (LUI-17): una pregunta de bloque se edita DESDE su lectura, y su
            `aria-label` lo dice. El destino distinto no es cosmético — `reactivos.actualizar`
            rechaza estos reactivos server-side, así que mandar aquí al formulario genérico
            solo llevaría a un callejón. Ojo: al cambiar la etiqueta, estas filas dejan de
            casar con el locator `/^Editar el reactivo/` de `e2e-lui14`, que es lo deseado. */}
        {/* ⚠️ El CANDADO manda sobre el destino: si el reactivo está congelado hay que
            mostrar el candado aunque pertenezca a un bloque. `enUso` ya viene expandido, así
            que las HERMANAS de una pregunta comprometida también lo muestran — que es la
            señal visual que promete la expansión del candado. */}
        {r.esEditable &&
          (bloqueados.has(r.id) ? (
            <IconBtn
              label={
                r.lecturaId
                  ? `En uso en un examen · abrir la lectura «${r.lecturaTitulo ?? ""}» para desactivar`
                  : `En uso en un examen · abrir «${truncar(r.enunciado, 40)}» para desactivar`
              }
              href={
                r.lecturaId
                  ? `${basePath}/lecturas/${r.lecturaId}/editar`
                  : `${basePath}/reactivos/${r.id}/editar`
              }
            >
              <Lock className="size-[17px]" aria-hidden />
            </IconBtn>
          ) : r.lecturaId ? (
            <IconBtn
              label={`Editar en la lectura «${r.lecturaTitulo ?? ""}»`}
              className="text-unx-blue"
              href={`${basePath}/lecturas/${r.lecturaId}/editar`}
            >
              <Pencil className="size-[17px]" aria-hidden />
            </IconBtn>
          ) : (
            <IconBtn
              label={`Editar el reactivo «${truncar(r.enunciado, 40)}»`}
              className="text-unx-blue"
              href={`${basePath}/reactivos/${r.id}/editar`}
            >
              <Pencil className="size-[17px]" aria-hidden />
            </IconBtn>
          ))}
      </div>
    ),
  }));

  return (
    <>
      <PageHeader
        title="Banco de reactivos"
        description={
          hayFiltros
            ? `${ordenados.length} de ${total} ${total === 1 ? "reactivo" : "reactivos"}`
            : `${total} ${total === 1 ? "reactivo" : "reactivos"} · banco institucional`
        }
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push(`${basePath}/lecturas/nueva`)}
            >
              Crear lectura
            </Button>
            <Button onClick={() => router.push(`${basePath}/reactivos/nuevo`)}>
              <Plus className="size-[18px]" aria-hidden /> Crear reactivo
            </Button>
          </div>
        }
      />

      {/* Región viva: anuncia el conteo tras filtrar (feedback no solo visual). */}
      <div aria-live="polite" className="sr-only">
        {hayFiltros ? `${ordenados.length} reactivos encontrados` : ""}
      </div>

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <SearchInput
            placeholder="Buscar en el enunciado…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPage(1);
            }}
            fullWidth
          />
        </div>
        <Select
          aria-label="Filtrar por sección"
          containerClassName="w-[170px]"
          options={opcSeccion}
          value={filtroSeccion}
          onChange={(e) => {
            setFiltroSeccion(e.target.value);
            setFiltroArea("");
            setFiltroSubtema("");
            setPage(1);
          }}
        />
        <Select
          aria-label="Filtrar por área temática"
          containerClassName="w-[170px]"
          options={opcArea}
          value={filtroArea}
          disabled={!filtroSeccion}
          onChange={(e) => {
            setFiltroArea(e.target.value);
            setFiltroSubtema("");
            setPage(1);
          }}
        />
        <Select
          aria-label="Filtrar por subtema"
          containerClassName="w-[170px]"
          options={opcSubtema}
          value={filtroSubtema}
          disabled={!filtroArea}
          onChange={(e) => {
            setFiltroSubtema(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Filtrar por dificultad"
          containerClassName="w-[150px]"
          options={opcDificultad}
          value={filtroDificultad}
          onChange={(e) => {
            setFiltroDificultad(e.target.value as "" | NivelDificultad);
            setPage(1);
          }}
        />
        <Select
          aria-label="Filtrar por autor"
          containerClassName="w-[170px]"
          options={opcAutor}
          value={filtroAutor}
          onChange={(e) => {
            setFiltroAutor(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Filtrar por estado"
          containerClassName="w-[160px]"
          options={opcEstado}
          value={filtroEstado}
          onChange={(e) => {
            setFiltroEstado(e.target.value as Estado);
            setPage(1);
          }}
        />
      </div>

      <FiltrosActivos chips={chips} onLimpiar={limpiar} />

      {listar === undefined || enUso === undefined ? (
        // Se espera a AMBAS: sin `enUso` no se sabe qué reactivos van bloqueados, y
        // mostrar acciones a medias pintaría lápices donde deben ir candados.
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando reactivos…
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          emptyTitle={
            hayFiltros
              ? "No hay reactivos con esta combinación"
              : "Aún no hay reactivos"
          }
          emptyText={
            hayFiltros
              ? "Prueba con otra dificultad o limpia los filtros."
              : "Crea el primer reactivo del banco institucional."
          }
          emptyAction={
            hayFiltros ? (
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            ) : (
              <Button onClick={() => router.push(`${basePath}/reactivos/nuevo`)}>
                <Plus className="size-[18px]" aria-hidden /> Crear reactivo
              </Button>
            )
          }
        />
      )}

      <p className="mt-3 text-small text-muted">
        Editar aparece solo en tus propios reactivos; los administradores pueden
        editar todos. Un reactivo en uso en un examen (publicado o archivado, con asignaciones o intentos) se bloquea para editar
        (<Lock className="inline size-3.5 align-[-2px]" aria-hidden />); ábrelo para
        desactivarlo.
      </p>

      {preview && (
        <ReactivoPreviewModal
          reactivoId={preview}
          basePath={basePath}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

/** Botón/enlace de icono de 34px (patrón de `alumnos-client.tsx`). Con `href`
 *  navega (edición → LUI-15); con `onClick` actúa (ver → preview). */
function IconBtn({
  label,
  onClick,
  href,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const clase = cn(
    "inline-flex size-[34px] items-center justify-center rounded-control border border-border bg-surface text-muted transition-colors hover:bg-bg",
    className,
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={clase}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={clase}>
      {children}
    </button>
  );
}
