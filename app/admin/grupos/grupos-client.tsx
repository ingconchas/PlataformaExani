"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FunctionReturnType } from "convex/server";
import { Ban, Pencil, Plus, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { GrupoFormModal } from "./grupo-form-modal";

type Grupo = FunctionReturnType<typeof api.grupos.listarGestion>[number];
type Estado = "todos" | "activos" | "cerrados";

const PAGE_SIZE = 8;

const TURNO_LABEL: Record<"matutino" | "vespertino" | "sabatino", string> = {
  matutino: "Matutino",
  vespertino: "Vespertino",
  sabatino: "Sabatino",
};

const COLUMNS: DataTableColumn[] = [
  { key: "nombre", label: "Nombre del grupo", sortable: true },
  { key: "ciclo", label: "Ciclo" },
  { key: "turno", label: "Turno" },
  { key: "instructores", label: "Instructores" },
  { key: "alumnos", label: "Alumnos", align: "right" },
  { key: "estado", label: "Estado" },
  { key: "acciones", label: "Acciones", align: "right" },
];

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "form"; grupo: Grupo | null }
  | { tipo: "cerrar"; grupo: Grupo };

export function GruposClient() {
  const grupos = useQuery(api.grupos.listarGestion);
  const instructores = useQuery(api.instructores.listar);
  const cambiarEstado = useMutation(api.grupos.cambiarEstado);

  const [tab, setTab] = useState<Estado>("todos");
  const [filtroCiclo, setFiltroCiclo] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cerrar = () => setModal({ tipo: "cerrado" });

  async function reabrir(g: Grupo) {
    setErrorAccion(null);
    try {
      await cambiarEstado({ grupoId: g.id, activo: true });
    } catch (e) {
      setErrorAccion(mensajeDeError(e));
    }
  }

  const opcionesInstructores = (instructores ?? []).map((i) => ({
    value: i.id,
    label: i.materia ? `${i.nombre} — ${i.materia}` : i.nombre,
  }));

  const total = grupos?.length ?? 0;

  // Opciones de ciclo derivadas de los valores existentes.
  const ciclos = Array.from(
    new Set((grupos ?? []).map((g) => g.ciclo).filter((c): c is string => !!c)),
  ).sort((a, b) => a.localeCompare(b, "es"));
  const opcionesCiclo = [
    { value: "", label: "Todos los ciclos" },
    ...ciclos.map((c) => ({ value: c, label: c })),
  ];

  const filtrados = (grupos ?? []).filter((g) => {
    const coincideTab =
      tab === "todos" || (tab === "activos" ? g.activo : !g.activo);
    const coincideCiclo = !filtroCiclo || g.ciclo === filtroCiclo;
    return coincideTab && coincideCiclo;
  });
  const ordenados = [...filtrados].sort((a, b) => {
    const cmp =
      a.nombre.localeCompare(b.nombre, "es") ||
      (a.ciclo ?? "").localeCompare(b.ciclo ?? "", "es");
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageCount = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = ordenados.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const rows: DataTableRow[] = visibles.map((g) => ({
    id: g.id,
    nombre: (
      <Link
        href={`/admin/grupos/${g.id}`}
        className="font-semibold text-ink transition-colors hover:text-unx-blue"
      >
        {g.nombre}
      </Link>
    ),
    ciclo: g.ciclo ?? <span className="text-muted">—</span>,
    turno: g.turno ? (
      TURNO_LABEL[g.turno]
    ) : (
      <span className="text-muted">—</span>
    ),
    instructores:
      g.instructores.length === 0 ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="inline-flex items-center gap-2.5">
          <AvatarGroup nombres={g.instructores.map((i) => i.nombre)} />
          <span className="text-text">
            {g.instructores.map((i) => i.nombre).join(", ")}
          </span>
        </span>
      ),
    alumnos: <span className="font-condensed">{g.alumnosCount}</span>,
    estado: g.activo ? (
      <Badge tone="green">Activo</Badge>
    ) : (
      <Badge tone="neutral">Cerrado</Badge>
    ),
    acciones: (
      <div className="flex justify-end gap-1.5">
        <IconBtn
          label={`Editar ${g.nombre}`}
          className="text-unx-blue"
          onClick={() => setModal({ tipo: "form", grupo: g })}
        >
          <Pencil className="size-[17px]" aria-hidden />
        </IconBtn>
        {g.activo ? (
          <IconBtn
            label={`Cerrar ${g.nombre}`}
            onClick={() => setModal({ tipo: "cerrar", grupo: g })}
          >
            <Ban className="size-[17px]" aria-hidden />
          </IconBtn>
        ) : (
          <IconBtn
            label={`Reabrir ${g.nombre}`}
            className="text-unx-green"
            onClick={() => reabrir(g)}
          >
            <RotateCcw className="size-[17px]" aria-hidden />
          </IconBtn>
        )}
      </div>
    ),
  }));

  return (
    <>
      <PageHeader
        title="Grupos"
        description={`${total} ${total === 1 ? "grupo" : "grupos"}`}
        action={
          <Button onClick={() => setModal({ tipo: "form", grupo: null })}>
            <Plus className="size-[18px]" aria-hidden /> Crear grupo
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { id: "todos", label: "Todos" },
            { id: "activos", label: "Activos" },
            { id: "cerrados", label: "Cerrados" },
          ]}
          activeId={tab}
          onChange={(id) => {
            setTab(id as Estado);
            setPage(1);
          }}
        />
        <div className="w-[200px]">
          <Select
            aria-label="Filtrar por ciclo"
            options={opcionesCiclo}
            value={filtroCiclo}
            onChange={(e) => {
              setFiltroCiclo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {errorAccion && (
        <div className="mb-4">
          <Alert kind="error">{errorAccion}</Alert>
        </div>
      )}

      {grupos === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando grupos…
        </div>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          sortBy="nombre"
          sortDir={sortDir}
          onSort={() => {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            setPage(1);
          }}
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          emptyTitle="No hay grupos que mostrar"
          emptyText="Crea un grupo o cambia los filtros para ver más."
        />
      )}

      {modal.tipo === "form" && (
        <GrupoFormModal
          key={modal.grupo?.id ?? "nuevo"}
          grupo={modal.grupo}
          instructores={opcionesInstructores}
          onClose={cerrar}
        />
      )}
      {modal.tipo === "cerrar" && (
        <ConfirmarCerrarModal grupo={modal.grupo} onClose={cerrar} />
      )}
    </>
  );
}

function IconBtn({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-[34px] items-center justify-center rounded-control border border-border bg-surface text-muted transition-colors hover:bg-bg",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ConfirmarCerrarModal({
  grupo,
  onClose,
}: {
  grupo: Grupo;
  onClose: () => void;
}) {
  const cambiarEstado = useMutation(api.grupos.cambiarEstado);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await cambiarEstado({ grupoId: grupo.id, activo: false });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Cerrar ${grupo.nombre}?`}
      width={440}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmar} disabled={enviando}>
            {enviando ? "Cerrando…" : "Cerrar grupo"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p>
          El grupo dejará de recibir alumnos y exámenes nuevos. Su historial de
          resultados se conserva y puedes reabrirlo cuando lo necesites.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
