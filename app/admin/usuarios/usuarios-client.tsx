"use client";

import { type ReactNode, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FunctionReturnType } from "convex/server";
import { Ban, Pencil, Plus, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { UsuarioFormModal } from "./usuario-form-modal";

type Usuario = FunctionReturnType<typeof api.usuarios.listarStaff>[number];

const PAGE_SIZE = 8;

const COLUMNS: DataTableColumn[] = [
  { key: "nombre", label: "Nombre", sortable: true },
  { key: "correo", label: "Correo" },
  { key: "rol", label: "Rol" },
  { key: "grupos", label: "Grupos con acceso" },
  { key: "estado", label: "Estado" },
  { key: "acciones", label: "Acciones", align: "right" },
];

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "form"; usuario: Usuario | null }
  | { tipo: "desactivar"; usuario: Usuario };

export function UsuariosClient() {
  const staff = useQuery(api.usuarios.listarStaff);
  const grupos = useQuery(api.grupos.listar);
  const cambiarEstado = useMutation(api.usuarios.cambiarEstado);

  const [busqueda, setBusqueda] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cerrar = () => setModal({ tipo: "cerrado" });

  async function reactivar(u: Usuario) {
    setErrorAccion(null);
    try {
      await cambiarEstado({ perfilId: u.id, activo: true });
    } catch (e) {
      setErrorAccion(mensajeDeError(e));
    }
  }

  const total = staff?.length ?? 0;
  const q = busqueda.trim().toLowerCase();
  const filtrados = (staff ?? []).filter(
    (u) =>
      !q ||
      u.nombre.toLowerCase().includes(q) ||
      u.correo.toLowerCase().includes(q),
  );
  // Mantiene admins-primero del backend; el sort solo invierte para "desc".
  const ordenados = sortDir === "asc" ? filtrados : [...filtrados].reverse();
  const pageCount = Math.max(1, Math.ceil(ordenados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = ordenados.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const grupoOpciones = (grupos ?? []).map((g) => ({
    id: g.id,
    nombre: g.nombre,
    ciclo: g.ciclo,
  }));

  const rows: DataTableRow[] = visibles.map((u) => ({
    id: u.id,
    nombre: (
      <div className="flex items-center gap-3">
        <Avatar nombre={u.nombre} size={32} />
        <div>
          <div className="font-semibold text-ink">{u.nombre}</div>
          {u.materia && <div className="text-caption text-muted">{u.materia}</div>}
        </div>
      </div>
    ),
    correo: <span className="text-muted">{u.correo}</span>,
    rol:
      u.rol === "admin" ? (
        <Badge tone="blue">Administrador</Badge>
      ) : (
        <Badge tone="neutral">Instructor</Badge>
      ),
    grupos: u.accesoTodos ? (
      <span className="text-muted">Todos</span>
    ) : u.grupos.length === 0 ? (
      <span className="text-muted">—</span>
    ) : (
      <div className="flex flex-wrap gap-1">
        {u.grupos.map((g) => (
          <span
            key={g.id}
            className="inline-flex items-center rounded-full bg-bg px-2 py-0.5 text-caption text-text"
          >
            {g.ciclo ? `${g.nombre} · ${g.ciclo}` : g.nombre}
            {!g.activo && " (cerrado)"}
          </span>
        ))}
      </div>
    ),
    estado: u.activo ? (
      <Badge tone="green">Activo</Badge>
    ) : (
      <Badge tone="neutral">Inactivo</Badge>
    ),
    acciones: u.esCuentaPropia ? (
      <span className="text-caption text-muted">Tu cuenta</span>
    ) : (
      <div className="flex justify-end gap-1.5">
        <IconBtn
          label={`Editar a ${u.nombre}`}
          className="text-unx-blue"
          onClick={() => setModal({ tipo: "form", usuario: u })}
        >
          <Pencil className="size-[17px]" aria-hidden />
        </IconBtn>
        {u.activo ? (
          <IconBtn
            label={`Desactivar a ${u.nombre}`}
            onClick={() => setModal({ tipo: "desactivar", usuario: u })}
          >
            <Ban className="size-[17px]" aria-hidden />
          </IconBtn>
        ) : (
          <IconBtn
            label={`Reactivar a ${u.nombre}`}
            className="text-unx-green"
            onClick={() => reactivar(u)}
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
        title="Usuarios y permisos"
        description={`${total} ${total === 1 ? "cuenta" : "cuentas"} del staff`}
        action={
          <Button onClick={() => setModal({ tipo: "form", usuario: null })}>
            <Plus className="size-[18px]" aria-hidden /> Crear cuenta
          </Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <SearchInput
          placeholder="Buscar por nombre o correo…"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setPage(1);
          }}
          fullWidth
        />
      </div>

      {errorAccion && (
        <div className="mb-4">
          <Alert kind="error">{errorAccion}</Alert>
        </div>
      )}

      {staff === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando cuentas…
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
          emptyTitle="No encontramos cuentas"
          emptyText="Revisa la búsqueda o crea una cuenta de staff."
        />
      )}

      {modal.tipo === "form" && (
        <UsuarioFormModal
          key={modal.usuario?.id ?? "nuevo"}
          usuario={
            modal.usuario
              ? {
                  id: modal.usuario.id,
                  nombre: modal.usuario.nombre,
                  correo: modal.usuario.correo,
                  rol: modal.usuario.rol,
                  materia: modal.usuario.materia,
                  grupos: modal.usuario.grupos,
                }
              : null
          }
          grupos={grupoOpciones}
          onClose={cerrar}
        />
      )}
      {modal.tipo === "desactivar" && (
        <ConfirmarDesactivarModal usuario={modal.usuario} onClose={cerrar} />
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

function ConfirmarDesactivarModal({
  usuario,
  onClose,
}: {
  usuario: Usuario;
  onClose: () => void;
}) {
  const cambiarEstado = useMutation(api.usuarios.cambiarEstado);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await cambiarEstado({ perfilId: usuario.id, activo: false });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Desactivar la cuenta de ${usuario.nombre}?`}
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
        <p>Esta cuenta perderá el acceso; su contenido creado se conserva.</p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
