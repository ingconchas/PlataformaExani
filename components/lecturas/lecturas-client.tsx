"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookText, Lock, Pencil, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { DifficultyMeter } from "@/components/ui/difficulty-meter";
import { SearchInput } from "@/components/ui/search-input";
import { canonizar } from "@/convex/texto";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { key: "titulo", label: "Lectura" },
  { key: "clasificacion", label: "Clasificación" },
  { key: "preguntas", label: "Preguntas", align: "center" as const },
  { key: "dificultad", label: "Dificultad" },
  { key: "autor", label: "Autor" },
  { key: "acciones", label: "", align: "right" as const },
];

/**
 * `/{admin,instructor}/lecturas` — listado institucional de lecturas (LUI-17).
 *
 * Mismo molde que el banco de reactivos: el servidor entrega todo enriquecido (incluido
 * `esEditable`, que el cliente NO deriva comparando ids) y el cliente filtra. Todo el staff
 * ve el catálogo completo; cada fila muestra su autor.
 */
export function LecturasClient({ basePath }: { basePath: string }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const lecturas = useQuery(api.lecturas.listar, isAuthenticated ? {} : "skip");
  const [busqueda, setBusqueda] = useState("");

  if (lecturas === undefined) {
    return (
      <>
        <Encabezado basePath={basePath} router={router} />
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando…
        </div>
      </>
    );
  }

  const q = canonizar(busqueda);
  const visibles = q
    ? lecturas.filter((l) => canonizar(l.titulo).includes(q))
    : lecturas;

  const rows: DataTableRow[] = visibles.map((l) => ({
    id: l.id,
    titulo: (
      <div className={cn("max-w-[380px]", !l.activo && "opacity-55")}>
        <div className="flex items-center gap-2">
          <BookText className="size-4 shrink-0 text-unx-blue" aria-hidden />
          <span className="font-medium text-ink">{l.titulo}</span>
          {!l.activo && <Badge tone="neutral">Desactivada</Badge>}
          {l.enUso && <Badge tone="neutral">En uso</Badge>}
        </div>
        <p className="mt-1 line-clamp-1 text-caption text-muted">{l.extracto}</p>
      </div>
    ),
    clasificacion: (
      <span className="text-muted">
        {l.seccionNombre} · {l.areaNombre} · {l.subtemaNombre}
      </span>
    ),
    preguntas: (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-condensed font-semibold text-ink">{l.preguntas}</span>
        {/* «Incompleta» es la regla de PUBLICACIÓN hecha visible: es lo que impedirá que la
            lectura entre a un examen (LUI-21). */}
        {!l.publicable && <Badge tone="yellow">Incompleta</Badge>}
      </span>
    ),
    dificultad: l.dificultad ? (
      <DifficultyMeter level={l.dificultad} size="chip" showLabel />
    ) : (
      <span className="text-muted">—</span>
    ),
    autor: <span className="whitespace-nowrap text-small">{l.autorNombre}</span>,
    acciones: (
      <div className="flex justify-end">
        {l.esEditable ? (
          <Link
            href={`${basePath}/lecturas/${l.id}/editar`}
            aria-label={`Editar la lectura «${l.titulo}»`}
            title={`Editar la lectura «${l.titulo}»`}
            className="inline-flex size-[34px] items-center justify-center rounded-control border border-border bg-surface text-unx-blue transition-colors hover:bg-bg"
          >
            <Pencil className="size-[17px]" aria-hidden />
          </Link>
        ) : (
          <span
            aria-label={`Lectura de ${l.autorNombre}: solo lectura`}
            title={`Lectura de ${l.autorNombre}: solo lectura`}
            className="inline-flex size-[34px] items-center justify-center rounded-control border border-border bg-bg text-disabled-text"
          >
            <Lock className="size-[17px]" aria-hidden />
          </span>
        )}
      </div>
    ),
  }));

  return (
    <>
      <Encabezado basePath={basePath} router={router} />
      <div className="mb-3 max-w-[360px]">
        <SearchInput
          placeholder="Buscar por título…"
          aria-label="Buscar lecturas"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>
      {lecturas.length === 0 ? (
        <Alert kind="info">
          Todavía no hay lecturas. Crea la primera para agrupar preguntas de comprensión
          lectora.
        </Alert>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          emptyTitle="Sin resultados"
          emptyText="Ninguna lectura coincide con la búsqueda."
        />
      )}
    </>
  );
}

function Encabezado({
  basePath,
  router,
}: {
  basePath: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <PageHeader
      title="Lecturas"
      description="Pasajes con su bloque de preguntas"
      action={
        <Button onClick={() => router.push(`${basePath}/lecturas/nueva`)}>
          <Plus className="size-[18px]" aria-hidden /> Crear lectura
        </Button>
      }
    />
  );
}
