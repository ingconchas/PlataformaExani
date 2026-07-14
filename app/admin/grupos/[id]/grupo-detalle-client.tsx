"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ClipboardCheck, Pencil, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import { MetricCard } from "@/components/ui/metric-card";
import { SearchInput } from "@/components/ui/search-input";
import { GrupoFormModal } from "../grupo-form-modal";

const PAGE_SIZE = 8;

const TURNO_LABEL: Record<"matutino" | "vespertino" | "sabatino", string> = {
  matutino: "matutino",
  vespertino: "vespertino",
  sabatino: "sabatino",
};

const COLUMNS: DataTableColumn[] = [
  { key: "nombre", label: "Nombre" },
  { key: "correo", label: "Correo" },
  { key: "estado", label: "Estado" },
  { key: "acceso", label: "Último acceso" },
];

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

export function GrupoDetalleClient({ grupoId }: { grupoId: string }) {
  const grupo = useQuery(api.grupos.obtener, { grupoId });
  const instructores = useQuery(api.instructores.listar);

  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);
  const [editando, setEditando] = useState(false);

  if (grupo === undefined) {
    return (
      <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
        Cargando grupo…
      </div>
    );
  }

  if (grupo === null) {
    return (
      <div className="rounded-card border border-border bg-surface p-10 text-center shadow-card">
        <p className="text-h3 text-ink">Grupo no encontrado</p>
        <p className="mt-1 text-small text-muted">
          El grupo que buscas no existe o fue eliminado.
        </p>
        <Link
          href="/admin/grupos"
          className="mt-4 inline-block font-semibold text-unx-blue hover:underline"
        >
          ← Volver a Grupos
        </Link>
      </div>
    );
  }

  const subtitulo = [
    grupo.ciclo ? `Ciclo ${grupo.ciclo}` : null,
    grupo.turno ? `Turno ${TURNO_LABEL[grupo.turno]}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const q = busqueda.trim().toLowerCase();
  const filtrados = grupo.alumnos.filter(
    (a) =>
      !q ||
      a.nombre.toLowerCase().includes(q) ||
      a.correo.toLowerCase().includes(q),
  );
  const pageCount = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = filtrados.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const rows: DataTableRow[] = visibles.map((a) => ({
    id: a.id,
    nombre: <span className="font-semibold text-ink">{a.nombre}</span>,
    correo: <span className="text-muted">{a.correo}</span>,
    estado: a.activo ? (
      <Badge tone="green">Activo</Badge>
    ) : (
      <Badge tone="neutral">Inactivo</Badge>
    ),
    acceso: <span className="text-muted">{tiempoRelativo(a.ultimoAccesoEn)}</span>,
  }));

  const opcionesInstructores = (instructores ?? []).map((i) => ({
    value: i.id,
    label: i.materia ? `${i.nombre} — ${i.materia}` : i.nombre,
  }));

  return (
    <>
      <Breadcrumb
        items={[{ label: "Grupos", href: "/admin/grupos" }, { label: grupo.nombre }]}
      />
      <div className="mt-3">
        <PageHeader
          title={grupo.nombre}
          description={subtitulo || undefined}
          action={
            <Button variant="secondary" onClick={() => setEditando(true)}>
              <Pencil className="size-[18px]" aria-hidden /> Editar grupo
            </Button>
          }
        />
      </div>

      {!grupo.activo && (
        <div className="mb-4">
          <Badge tone="neutral">Grupo cerrado</Badge>
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-small font-semibold uppercase tracking-[0.06em] text-muted">
            Instructores
          </h2>
          {grupo.instructores.length === 0 ? (
            <p className="text-muted">Sin instructores asignados.</p>
          ) : (
            <ul className="grid gap-3">
              {grupo.instructores.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <Avatar nombre={i.nombre} size={32} />
                  <span className="text-body text-text">
                    <span className="font-semibold text-ink">{i.nombre}</span>
                    {i.materia ? ` · ${i.materia}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            value={grupo.metricas.alumnosCount}
            label="Alumnos"
            tone="blue"
            icon={<Users className="size-[22px]" aria-hidden />}
          />
          <MetricCard
            value={grupo.metricas.examenesAplicados}
            label="Exámenes aplicados"
            tone="green"
            icon={<ClipboardCheck className="size-[22px]" aria-hidden />}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">Alumnos del grupo</h2>
        <div className="w-[260px]">
          <SearchInput
            placeholder="Buscar alumno…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPage(1);
            }}
            fullWidth
          />
        </div>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        page={safePage}
        pageCount={pageCount}
        onPageChange={setPage}
        emptyTitle="Sin alumnos"
        emptyText="Este grupo aún no tiene alumnos. Asígnalos desde Gestión de alumnos."
      />

      {editando && (
        <GrupoFormModal
          grupo={{
            id: grupo.id,
            nombre: grupo.nombre,
            ciclo: grupo.ciclo,
            turno: grupo.turno,
            instructores: grupo.instructores.map((i) => ({ id: i.id })),
          }}
          instructores={opcionesInstructores}
          onClose={() => setEditando(false)}
        />
      )}
    </>
  );
}
