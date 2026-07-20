"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
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
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { TipoExamenChip } from "./tipo-examen-chip";
import { ConfirmarArchivadoModal } from "./confirmar-archivado-modal";

type Fila = FunctionReturnType<typeof api.examenes.listar>[number];

const PAGE_SIZE = 8;

const COLUMNS: DataTableColumn[] = [
  { key: "nombre", label: "Nombre" },
  { key: "tipo", label: "Tipo" },
  { key: "autor", label: "Autor" },
  { key: "reactivos", label: "Reactivos", align: "right" },
  { key: "tiempo", label: "Tiempo" },
  { key: "estado", label: "Estado" },
  { key: "aplic", label: "Aplicaciones" },
  { key: "accion", label: "Acción", align: "right" },
];

/** «3 h 00 min» / «0 h 45 min» — el formato del Diseño 17. */
function formatoDuracion(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

const ORDEN_ESTADO: Record<Fila["estado"], number> = {
  publicado: 0,
  borrador: 1,
  archivado: 2,
};

const PESTANAS = [
  { id: "todos", label: "Todos" },
  { id: "borrador", label: "Borradores" },
  { id: "publicado", label: "Publicados" },
  { id: "archivado", label: "Archivados" },
] as const;

type TabId = (typeof PESTANAS)[number]["id"];

const VACIO_POR_TAB: Record<TabId, string> = {
  todos: "Aún no hay exámenes",
  borrador: "No hay borradores",
  publicado: "No hay exámenes publicados",
  archivado: "No hay exámenes archivados",
};

// El estado del modal guarda el OBJETO de la fila, jamás su índice: Convex es
// reactivo — si otro usuario archiva algo con el diálogo abierto, la lista se
// reordena bajo los pies y un índice confirmaría sobre el examen equivocado. Es
// la regla del `key={índice}` aplicada al estado del modal.
type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "archivar"; examen: Fila }
  | { tipo: "desarchivar"; examen: Fila };

/**
 * Biblioteca institucional de exámenes (LUI-20 · Diseño 17). Doble montaje:
 * `/instructor/examenes` y `/admin/examenes/biblioteca`.
 *
 * ⚠️ `basePath` = la base de ESTA PANTALLA, **no** la zona. Diverge a propósito
 * de `BancoReactivosClient` (donde sí es la zona): allá las dos rutas son
 * simétricas (`/{zona}/reactivos`); aquí no pueden serlo porque `/admin/examenes`
 * ya es el Resumen (LUI-32). Con la zona como prop, este cliente necesitaría un
 * `if (basePath === "/admin")` interno — exactamente el acoplamiento que el
 * doble montaje evita. Todos los destinos salen de `${basePath}/…`.
 *
 * El servidor entrega TODO (filas LEAN con permisos ESTAMPADOS); el cliente
 * filtra, ordena y pagina en memoria — molde uniforme del repo. Aquí no se
 * compara `autorId` contra la sesión ni se re-deriva ninguna regla.
 */
export function BibliotecaExamenesClient({ basePath }: { basePath: string }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const listar = useQuery(api.examenes.listar, isAuthenticated ? {} : "skip");

  const [tab, setTab] = useState<TabId>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [filtroAutor, setFiltroAutor] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });

  const examenes = useMemo(() => listar ?? [], [listar]);

  const opcAutor = useMemo(() => {
    const nombres = [...new Set(examenes.map((e) => e.autorNombre))].sort(
      (a, b) => a.localeCompare(b, "es"),
    );
    return [
      { value: "", label: "Todos los autores" },
      ...nombres.map((n) => ({ value: n, label: n })),
    ];
  }, [examenes]);

  // Los CONTADORES de las pestañas se calculan sobre el conjunto PRE-pestaña
  // (búsqueda y autor aplicados; pestaña no): así «Publicados 0» con una búsqueda
  // activa significa honestamente «ningún publicado coincide con tu búsqueda», y
  // los números siempre cuadran con lo que cada pestaña mostraría al hacer clic.
  const preTab = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return examenes.filter(
      (e) =>
        (q === "" || e.titulo.toLowerCase().includes(q)) &&
        (filtroAutor === "" || e.autorNombre === filtroAutor),
    );
  }, [examenes, busqueda, filtroAutor]);

  const conteos = useMemo(() => {
    const c = { todos: preTab.length, borrador: 0, publicado: 0, archivado: 0 };
    for (const e of preTab) c[e.estado]++;
    return c;
  }, [preTab]);

  const filtrados = useMemo(
    () => (tab === "todos" ? preTab : preTab.filter((e) => e.estado === tab)),
    [preTab, tab],
  );

  const ordenados = useMemo(
    () =>
      [...filtrados].sort(
        (a, b) =>
          ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
          a.titulo.localeCompare(b.titulo, "es"),
      ),
    [filtrados],
  );

  const hayFiltros = busqueda.trim() !== "" || filtroAutor !== "";

  const pageCount = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = ordenados.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function limpiar() {
    setBusqueda("");
    setFiltroAutor("");
    setPage(1);
  }

  const rows: DataTableRow[] = visibles.map((e) => ({
    id: e.id,
    nombre: (
      <span className="block max-w-[220px] truncate font-medium text-ink" title={e.titulo}>
        {e.titulo}
      </span>
    ),
    tipo: <TipoExamenChip esModulo={e.esModulo} etiqueta={e.tipoEtiqueta} />,
    autor: (
      <span className="flex items-center gap-2">
        <Avatar nombre={e.autorNombre} size={24} />
        <span className="truncate">{e.autorNombre}</span>
      </span>
    ),
    reactivos: e.reactivosCount,
    tiempo: <span className="whitespace-nowrap">{formatoDuracion(e.duracionMin)}</span>,
    estado: (
      <Badge tone={e.estado === "publicado" ? "green" : "neutral"}>
        {e.estado}
      </Badge>
    ),
    aplic: <CeldaAplicaciones examen={e} />,
    accion: <CeldaAcciones examen={e} basePath={basePath} onModal={setModal} />,
  }));

  return (
    <>
      <PageHeader
        title="Exámenes"
        description={
          listar === undefined
            ? "Biblioteca institucional"
            : hayFiltros
              ? `${preTab.length} de ${examenes.length} exámenes`
              : `${examenes.length} exámenes · biblioteca institucional — todos la ven completa, cada examen muestra su autor`
        }
        action={
          <Button onClick={() => router.push(`${basePath}/nuevo`)}>
            <Plus className="size-[18px]" aria-hidden /> Crear examen
          </Button>
        }
      />

      {/* Región viva: anuncia el conteo tras filtrar (feedback no solo visual). */}
      <div aria-live="polite" className="sr-only">
        {hayFiltros ? `${filtrados.length} exámenes encontrados` : ""}
      </div>

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <SearchInput
            placeholder="Buscar por título…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPage(1);
            }}
            fullWidth
          />
        </div>
        <Select
          aria-label="Filtrar por autor"
          containerClassName="w-[190px]"
          options={opcAutor}
          value={filtroAutor}
          onChange={(e) => {
            setFiltroAutor(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="mb-4">
        <Tabs
          tabs={PESTANAS.map((p) => ({
            id: p.id,
            label: p.label,
            count: conteos[p.id],
          }))}
          activeId={tab}
          onChange={(id) => {
            setTab(id as TabId);
            setPage(1); // el más olvidado de los tres `setPage(1)`
          }}
        />
      </div>

      {listar === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando exámenes…
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          // Estado vacío TERNARIO: (a) filtros sin coincidencia → limpiar; (b)
          // pestaña vacía SIN filtros → copy propio y SIN «Limpiar filtros» (no
          // hay nada que limpiar); (c) biblioteca vacía → crear.
          emptyTitle={
            hayFiltros ? "No hay exámenes con esta combinación" : VACIO_POR_TAB[tab]
          }
          emptyText={
            hayFiltros
              ? "Prueba con otro autor o limpia los filtros."
              : "Crea un examen desde el banco institucional de reactivos."
          }
          emptyAction={
            hayFiltros ? (
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            ) : (
              <Button onClick={() => router.push(`${basePath}/nuevo`)}>
                <Plus className="size-[18px]" aria-hidden /> Crear examen
              </Button>
            )
          }
        />
      )}

      <p className="mt-3 text-small text-muted">
        Los borradores solo los edita su autor; los administradores pueden editar
        todos. Un examen publicado se archiva cuando todas sus asignaciones
        concluyen; el archivado conserva sus resultados.
      </p>

      {modal.tipo !== "cerrado" && (
        <ConfirmarArchivadoModal
          examen={modal.examen}
          modo={modal.tipo}
          onClose={() => setModal({ tipo: "cerrado" })}
        />
      )}
    </>
  );
}

/** «N asignaciones» + desglose de ventanas DERIVADO en el servidor. «—» cuando no
 *  hay ninguna (borradores y publicados sin asignar — la celda no distingue el
 *  porqué; la acción de la fila sí). */
function CeldaAplicaciones({ examen }: { examen: Fila }) {
  if (examen.asignacionesCount === 0) return <span className="text-muted">—</span>;
  const v = examen.ventanas;
  const partes = [
    v.programadas > 0 && `${v.programadas} programada${v.programadas === 1 ? "" : "s"}`,
    v.abiertas > 0 && `${v.abiertas} abierta${v.abiertas === 1 ? "" : "s"}`,
    v.cerradas > 0 && `${v.cerradas} cerrada${v.cerradas === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <span className="block whitespace-nowrap">
      {examen.asignacionesCount} asignaci{examen.asignacionesCount === 1 ? "ón" : "ones"}
      <span className="block text-caption text-muted">{partes.join(" · ")}</span>
    </span>
  );
}

/**
 * Acciones por estado y permiso — TODO estampado por el servidor; aquí solo se
 * enruta. «Ver» aparece en TODAS las filas (la biblioteca es institucional:
 * dejar un borrador ajeno sin forma de mirarlo contradice su premisa).
 *
 * El botón de archivar se muestra aunque `archivableAhora` sea falso: el diálogo
 * explica el impedimento. El VERBO cambia con el estado (Archivar/Desarchivar) —
 * no solo un icono — para que exista para lectores de pantalla y locators.
 */
function CeldaAcciones({
  examen,
  basePath,
  onModal,
}: {
  examen: Fila;
  basePath: string;
  onModal: (m: ModalState) => void;
}) {
  const enlaces: React.ReactNode[] = [];
  const link = (href: string, texto: string, aria: string, primario = false) => (
    <Link
      key={aria}
      href={href}
      aria-label={aria}
      className={
        primario
          ? "font-semibold text-unx-blue hover:underline"
          : "font-semibold text-muted hover:text-ink hover:underline"
      }
    >
      {texto}
    </Link>
  );

  if (examen.estado === "borrador") {
    if (examen.esEditable) {
      enlaces.push(
        link(
          `${basePath}/${examen.id}/editar`,
          "Continuar editando",
          `Continuar editando «${examen.titulo}»`,
          true,
        ),
      );
    } else {
      enlaces.push(
        <span key="ajeno" className="text-muted">
          Solo su autor lo edita
        </span>,
      );
    }
  } else if (examen.tieneResultados) {
    enlaces.push(
      link(
        `${basePath}/${examen.id}/resultados`,
        "Ver resultados",
        `Ver resultados de «${examen.titulo}»`,
        true,
      ),
    );
  } else if (examen.estado === "publicado") {
    enlaces.push(
      link(
        `${basePath}/${examen.id}/asignar`,
        "Asignar",
        `Asignar «${examen.titulo}»`,
        true,
      ),
    );
  }

  enlaces.push(
    link(`${basePath}/${examen.id}/vista`, "Ver", `Ver el examen «${examen.titulo}»`),
  );

  if (examen.puedeSolicitarArchivado) {
    enlaces.push(
      <button
        key="archivar"
        type="button"
        aria-label={`Archivar «${examen.titulo}»`}
        onClick={() => onModal({ tipo: "archivar", examen })}
        className="font-semibold text-muted hover:text-ink hover:underline"
      >
        Archivar
      </button>,
    );
  }
  if (examen.puedeDesarchivar) {
    enlaces.push(
      <button
        key="desarchivar"
        type="button"
        aria-label={`Desarchivar «${examen.titulo}»`}
        onClick={() => onModal({ tipo: "desarchivar", examen })}
        className="font-semibold text-muted hover:text-ink hover:underline"
      >
        Desarchivar
      </button>,
    );
  }

  return (
    <span className="flex items-center justify-end gap-2 whitespace-nowrap text-small">
      {enlaces.map((nodo, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-border-strong">·</span>}
          {nodo}
        </span>
      ))}
    </span>
  );
}
