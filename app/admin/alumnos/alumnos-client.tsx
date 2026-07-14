"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { Ban, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Alumno = FunctionReturnType<typeof api.alumnos.listar>[number];
type Grupo = FunctionReturnType<typeof api.grupos.listar>[number];
type Estado = "todos" | "activos" | "inactivos";

const PAGE_SIZE = 8;

const COLUMNS: DataTableColumn[] = [
  { key: "nombre", label: "Nombre", sortable: true },
  { key: "correo", label: "Correo" },
  { key: "grupo", label: "Grupo" },
  { key: "estado", label: "Estado" },
  { key: "acceso", label: "Último acceso" },
  { key: "acciones", label: "Acciones", align: "right" },
];

function nombreCompleto(a: { nombre: string; apellidos: string }): string {
  return `${a.nombre} ${a.apellidos}`.trim();
}

function tiempoRelativo(ts: number | null): string {
  if (!ts) return "Nunca";
  const dias = Math.floor((Date.now() - ts) / 86_400_000);
  if (dias <= 0) return "Hoy";
  if (dias === 1) return "hace 1 día";
  if (dias < 7) return `hace ${dias} días`;
  const semanas = Math.floor(dias / 7);
  if (semanas < 5) return semanas === 1 ? "hace 1 semana" : `hace ${semanas} semanas`;
  const meses = Math.floor(dias / 30);
  return meses <= 1 ? "hace 1 mes" : `hace ${meses} meses`;
}

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "form"; alumno: Alumno | null }
  | { tipo: "desactivar"; alumno: Alumno };

export function AlumnosClient() {
  const router = useRouter();
  const alumnos = useQuery(api.alumnos.listar);
  const grupos = useQuery(api.grupos.listar);
  const cambiarEstado = useMutation(api.alumnos.cambiarEstado);

  const [busqueda, setBusqueda] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<Estado>("todos");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cerrar = () => setModal({ tipo: "cerrado" });

  async function reactivar(a: Alumno) {
    setErrorAccion(null);
    try {
      await cambiarEstado({ perfilId: a.id, activo: true });
    } catch (e) {
      setErrorAccion(mensajeDeError(e));
    }
  }

  const total = alumnos?.length ?? 0;

  const q = busqueda.trim().toLowerCase();
  const filtrados = (alumnos ?? []).filter((a) => {
    const coincideBusqueda =
      !q || nombreCompleto(a).toLowerCase().includes(q) || a.correo.toLowerCase().includes(q);
    const coincideGrupo = !filtroGrupo || a.grupoId === filtroGrupo;
    const coincideEstado =
      filtroEstado === "todos" || (filtroEstado === "activos" ? a.activo : !a.activo);
    return coincideBusqueda && coincideGrupo && coincideEstado;
  });
  const ordenados = [...filtrados].sort((a, b) => {
    const cmp = nombreCompleto(a).localeCompare(nombreCompleto(b), "es");
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageCount = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = ordenados.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const opcionesGrupo = [
    { value: "", label: "Todos los grupos" },
    ...(grupos ?? []).map((g) => ({ value: g.id, label: g.nombre })),
  ];
  const opcionesEstado = [
    { value: "todos", label: "Estado: todos" },
    { value: "activos", label: "Activos" },
    { value: "inactivos", label: "Inactivos" },
  ];

  const rows: DataTableRow[] = visibles.map((a) => ({
    id: a.id,
    nombre: <span className="font-semibold text-ink">{nombreCompleto(a)}</span>,
    correo: <span className="text-muted">{a.correo}</span>,
    grupo: a.grupoNombre ?? <span className="text-muted">—</span>,
    estado: a.activo ? <Badge tone="green">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge>,
    acceso: <span className="text-muted">{tiempoRelativo(a.ultimoAccesoEn)}</span>,
    acciones: (
      <div className="flex justify-end gap-1.5">
        <IconBtn
          label={`Editar a ${nombreCompleto(a)}`}
          className="text-unx-blue"
          onClick={() => setModal({ tipo: "form", alumno: a })}
        >
          <Pencil className="size-[17px]" aria-hidden />
        </IconBtn>
        {a.activo ? (
          <IconBtn
            label={`Desactivar a ${nombreCompleto(a)}`}
            onClick={() => setModal({ tipo: "desactivar", alumno: a })}
          >
            <Ban className="size-[17px]" aria-hidden />
          </IconBtn>
        ) : (
          <IconBtn
            label={`Reactivar a ${nombreCompleto(a)}`}
            className="text-unx-green"
            onClick={() => reactivar(a)}
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
        title="Alumnos"
        description={`${total} ${total === 1 ? "alumno" : "alumnos"}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/admin/alumnos/importar")}>
              <Upload className="size-[18px]" aria-hidden /> Importar CSV
            </Button>
            <Button onClick={() => setModal({ tipo: "form", alumno: null })}>
              <Plus className="size-[18px]" aria-hidden /> Agregar alumno
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <SearchInput
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPage(1);
            }}
            fullWidth
          />
        </div>
        <div className="w-[200px]">
          <Select
            aria-label="Filtrar por grupo"
            options={opcionesGrupo}
            value={filtroGrupo}
            onChange={(e) => {
              setFiltroGrupo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-[180px]">
          <Select
            aria-label="Filtrar por estado"
            options={opcionesEstado}
            value={filtroEstado}
            onChange={(e) => {
              setFiltroEstado(e.target.value as Estado);
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

      {alumnos === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando alumnos…
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
          emptyTitle="No encontramos alumnos con ese nombre"
          emptyText="Revisa la escritura o limpia la búsqueda para ver a todos los alumnos."
        />
      )}

      {modal.tipo === "form" && (
        <AlumnoFormModal
          key={modal.alumno?.id ?? "nuevo"}
          alumno={modal.alumno}
          grupos={grupos ?? []}
          onClose={cerrar}
        />
      )}
      {modal.tipo === "desactivar" && (
        <ConfirmarDesactivarModal alumno={modal.alumno} onClose={cerrar} />
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

function AlumnoFormModal({
  alumno,
  grupos,
  onClose,
}: {
  alumno: Alumno | null;
  grupos: Grupo[];
  onClose: () => void;
}) {
  const crear = useMutation(api.alumnos.crear);
  const actualizar = useMutation(api.alumnos.actualizar);
  const formId = useId();
  const esEdicion = alumno !== null;

  const [nombre, setNombre] = useState(alumno ? nombreCompleto(alumno) : "");
  const [correo, setCorreo] = useState(alumno?.correo ?? "");
  const [grupoId, setGrupoId] = useState<string>(alumno?.grupoId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Grupos activos + (si el grupo actual del alumno está cerrado) ese grupo como
  // opción visible marcada «(cerrado)», para no perderlo al editar —política
  // tolerante, LUI-12—. No se ofrecen otros grupos cerrados para reasignar.
  const opcionesGrupo = grupos.map((g) => ({ value: g.id, label: g.nombre }));
  if (alumno && alumno.grupoId && !grupos.some((g) => g.id === alumno.grupoId)) {
    opcionesGrupo.unshift({
      value: alumno.grupoId,
      label: `${alumno.grupoNombre ?? "Grupo"} (cerrado)`,
    });
  }

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) {
      setError("Escribe el nombre completo.");
      return;
    }
    if (!correo.trim()) {
      setError("Escribe el correo electrónico.");
      return;
    }
    const [primero, ...resto] = nombreLimpio.split(/\s+/);
    const datos = {
      nombre: primero,
      apellidos: resto.join(" ") || undefined,
      correo,
      grupoId: grupoId ? (grupoId as Id<"grupos">) : undefined,
    };
    setEnviando(true);
    try {
      if (alumno) await actualizar({ perfilId: alumno.id, ...datos });
      else await crear(datos);
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={esEdicion ? "Editar alumno" : "Agregar alumno"}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={enviando}>
            {enviando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Agregar alumno"}
          </Button>
        </>
      }
    >
      <form id={formId} className="grid gap-4" onSubmit={guardar}>
        <div>
          <Label htmlFor="alumno-nombre">Nombre completo</Label>
          <Input
            id="alumno-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre y apellidos"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="alumno-correo">Correo electrónico</Label>
          <Input
            id="alumno-correo"
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="alumno@correo.com"
            autoComplete="off"
          />
        </div>
        <Select
          label="Grupo"
          placeholder="Elige un grupo"
          options={opcionesGrupo}
          value={grupoId}
          onChange={(e) => setGrupoId(e.target.value)}
        />
        {error && <Alert kind="error">{error}</Alert>}
        {!esEdicion && (
          <Alert kind="info">
            El alumno queda registrado sin acceso todavía; el correo de invitación se habilitará
            más adelante (LUI-103).
          </Alert>
        )}
      </form>
    </Modal>
  );
}

function ConfirmarDesactivarModal({
  alumno,
  onClose,
}: {
  alumno: Alumno;
  onClose: () => void;
}) {
  const cambiarEstado = useMutation(api.alumnos.cambiarEstado);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await cambiarEstado({ perfilId: alumno.id, activo: false });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Desactivar a ${nombreCompleto(alumno)}?`}
      width={440}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmar} disabled={enviando}>
            {enviando ? "Desactivando…" : "Desactivar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p>
          El alumno no podrá ingresar; su historial se conserva. Puedes reactivarlo cuando lo
          necesites.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
