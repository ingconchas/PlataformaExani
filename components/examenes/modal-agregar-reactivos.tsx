"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { FilaTemario } from "@/convex/temario";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import { DifficultyMeter } from "@/components/ui/difficulty-meter";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";

type FilaBanco = FunctionReturnType<typeof api.reactivos.listar>[number];

const PAGE_SIZE = 8;

const COLUMNS: DataTableColumn[] = [
  { key: "sel", label: "" },
  { key: "enunciado", label: "Enunciado" },
  { key: "area", label: "Área" },
  { key: "dificultad", label: "Dificultad" },
  { key: "autor", label: "Autor" },
];

/** Búsqueda insensible a acentos (mismo criterio que el banco). */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

type Oferta =
  | { tipo: "reactivo"; fila: FilaBanco }
  | { tipo: "lectura"; lecturaId: string; titulo: string; hermanas: FilaBanco[] };

/**
 * Modal «Agregar reactivos a {sección}» (Diseño 18, variante 02).
 *
 * La OFERTA es la del banco que `publicar` aceptará (el cliente filtra; la autoridad es
 * el servidor): sueltos ACTIVOS con clasificación DISPONIBLE de la sección destino; las
 * lecturas como UNA fila por bloque («se agrega completa»), solo las PUBLICABLES — el
 * veredicto agregado `bloquePublicable` viene estampado del servidor y excluye bloques
 * dañados o incompletos. Lo ya presente en el examen se excluye.
 *
 * La SELECCIÓN vive en un `Set` FUERA del filtrado y la paginación: cambiar de filtro o
 * de página no la pierde («N seleccionados» persistente, spec 2026-07-12).
 *
 * SECCIÓN PLANA (sin áreas ni subtemas): ningún reactivo puede clasificarse en ella —
 * estado vacío honesto con copy POR ZONA (solo admin tiene `/admin/temario`; el
 * instructor recibe el aviso sin enlace) y **sin** el CTA de crear reactivo
 * (`reactivos.crear` exige `subtemaId`: el formulario sería imposible de completar).
 */
export function ModalAgregarReactivos({
  seccionId,
  seccionNombre,
  temario,
  banco,
  temarioPath,
  yaEnExamen,
  lecturasYaEnExamen,
  onAgregar,
  onCrearDirecto,
  onClose,
}: {
  seccionId: string;
  seccionNombre: string;
  temario: FilaTemario[];
  banco: FilaBanco[];
  temarioPath?: string;
  yaEnExamen: Set<string>;
  lecturasYaEnExamen: Set<string>;
  onAgregar: (sel: { reactivos: string[]; lecturas: string[] }) => void;
  onCrearDirecto: () => void;
  onClose: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroSubtema, setFiltroSubtema] = useState("");
  const [filtroDif, setFiltroDif] = useState("");
  const [page, setPage] = useState(1);
  // La selección PERSISTE entre filtros y páginas: claves `r:{id}` / `l:{lecturaId}`.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const areas = useMemo(
    () => temario.filter((f) => f.nivel === 2 && f.seccionId === seccionId),
    [temario, seccionId],
  );
  const subtemas = useMemo(
    () =>
      temario.filter(
        (f) =>
          f.nivel === 3 &&
          f.seccionId === seccionId &&
          (filtroArea === "" || f.areaId === filtroArea),
      ),
    [temario, seccionId, filtroArea],
  );
  const subtemaDisponible = useMemo(
    () =>
      new Map(
        temario
          .filter((f) => f.nivel === 3)
          .map((f) => [f.id as string, f.disponible]),
      ),
    [temario],
  );
  const esPlana = areas.length === 0;

  // ── La oferta (pre-filtros de UI) ─────────────────────────────────────────
  const ofertas = useMemo<Oferta[]>(() => {
    const sueltos: Oferta[] = banco
      .filter(
        (r) =>
          r.seccionId === seccionId &&
          !r.enBloque &&
          r.activo &&
          (subtemaDisponible.get(r.subtemaId) ?? false) &&
          !yaEnExamen.has(r.id),
      )
      .map((fila) => ({ tipo: "reactivo" as const, fila }));

    const porLectura = new Map<string, FilaBanco[]>();
    for (const r of banco) {
      if (!r.enBloque || !r.bloquePublicable || r.lecturaId === null) continue;
      if (r.seccionId !== seccionId) continue;
      if (lecturasYaEnExamen.has(r.lecturaId)) continue;
      const lista = porLectura.get(r.lecturaId) ?? [];
      lista.push(r);
      porLectura.set(r.lecturaId, lista);
    }
    const lecturas: Oferta[] = [...porLectura.entries()].map(
      ([lecturaId, hermanas]) => ({
        tipo: "lectura" as const,
        lecturaId,
        titulo: hermanas[0]?.lecturaTitulo ?? "—",
        hermanas: [...hermanas].sort(
          (a, b) => (a.bloqueOrden ?? 0) - (b.bloqueOrden ?? 0),
        ),
      }),
    );

    return [...sueltos, ...lecturas].sort((a, b) => {
      const ta = a.tipo === "reactivo" ? a.fila.enunciado : a.titulo;
      const tb = b.tipo === "reactivo" ? b.fila.enunciado : b.titulo;
      return ta.localeCompare(tb, "es");
    });
  }, [banco, seccionId, subtemaDisponible, yaEnExamen, lecturasYaEnExamen]);

  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return ofertas.filter((o) => {
      if (o.tipo === "reactivo") {
        const r = o.fila;
        return (
          (q === "" || normalizar(r.enunciado).includes(q)) &&
          (filtroArea === "" || r.areaId === filtroArea) &&
          (filtroSubtema === "" || r.subtemaId === filtroSubtema) &&
          (filtroDif === "" || r.dificultad === filtroDif)
        );
      }
      // Lectura: casa si el TÍTULO o alguna hermana casan; área/subtema por sus
      // hermanas (comparten clasificación); dificultad si ALGUNA hermana la tiene.
      return (
        (q === "" ||
          normalizar(o.titulo).includes(q) ||
          o.hermanas.some((h) => normalizar(h.enunciado).includes(q))) &&
        (filtroArea === "" || o.hermanas.some((h) => h.areaId === filtroArea)) &&
        (filtroSubtema === "" ||
          o.hermanas.some((h) => h.subtemaId === filtroSubtema)) &&
        (filtroDif === "" ||
          o.hermanas.some((h) => h.dificultad === filtroDif))
      );
    });
  }, [ofertas, busqueda, filtroArea, filtroSubtema, filtroDif]);

  const pageCount = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibles = filtradas.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  function alternar(clave: string) {
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave);
      else n.add(clave);
      return n;
    });
  }

  function confirmar() {
    const reactivos: string[] = [];
    const lecturas: string[] = [];
    for (const clave of seleccion) {
      if (clave.startsWith("r:")) reactivos.push(clave.slice(2));
      else lecturas.push(clave.slice(2));
    }
    onAgregar({ reactivos, lecturas });
  }

  const rows: DataTableRow[] = visibles.map((o) => {
    const clave =
      o.tipo === "reactivo" ? `r:${o.fila.id}` : `l:${o.lecturaId}`;
    const marcada = seleccion.has(clave);
    const etiqueta =
      o.tipo === "reactivo"
        ? o.fila.enunciado
        : `la lectura ${o.titulo}`;
    return {
      id: clave,
      sel: (
        <input
          type="checkbox"
          aria-label={`Seleccionar ${etiqueta}`}
          checked={marcada}
          onChange={() => alternar(clave)}
          className="size-4 accent-unx-blue"
        />
      ),
      enunciado:
        o.tipo === "reactivo" ? (
          <span className="block max-w-[280px] truncate" title={o.fila.enunciado}>
            {o.fila.enunciado}
          </span>
        ) : (
          <span className="block max-w-[280px]">
            <span className="block truncate font-medium" title={o.titulo}>
              {o.titulo}
            </span>
            <span className="block text-caption font-semibold text-unx-blue">
              ▤ Lectura · {o.hermanas.length} pregunta
              {o.hermanas.length === 1 ? "" : "s"} · se agrega completa
            </span>
          </span>
        ),
      area:
        o.tipo === "reactivo"
          ? o.fila.areaNombre
          : (o.hermanas[0]?.areaNombre ?? "—"),
      dificultad:
        o.tipo === "reactivo" ? (
          <DifficultyMeter level={o.fila.dificultad} size="chip" />
        ) : (
          <span className="text-muted">—</span>
        ),
      autor:
        o.tipo === "reactivo"
          ? o.fila.autorNombre
          : (o.hermanas[0]?.autorNombre ?? "—"),
    };
  });

  return (
    <Modal
      title={`Agregar reactivos a ${seccionNombre}`}
      width={780}
      onClose={onClose}
      actions={
        <>
          <span className="mr-auto text-small text-muted" aria-live="polite">
            {seleccion.size} seleccionado{seleccion.size === 1 ? "" : "s"}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={seleccion.size === 0}>
            Agregar al examen
          </Button>
        </>
      }
    >
      {esPlana ? (
        <Alert kind="warning">
          {temarioPath ? (
            <>
              Esta sección aún no tiene áreas ni subtemas en el temario, así que
              ningún reactivo puede clasificarse en ella. Agrégalos en{" "}
              <Link className="font-semibold underline" href={temarioPath}>
                Gestión de temario
              </Link>{" "}
              antes de armar su examen.
            </>
          ) : (
            <>
              Esta sección aún no tiene áreas ni subtemas; solicita a
              administración que los agregue en el temario antes de armar su
              examen.
            </>
          )}
        </Alert>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[200px] flex-1">
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
              aria-label="Filtrar por área"
              containerClassName="w-[160px]"
              options={[
                { value: "", label: "Área: todas" },
                ...areas.map((a) => ({ value: a.id as string, label: a.nombre })),
              ]}
              value={filtroArea}
              onChange={(e) => {
                setFiltroArea(e.target.value);
                setFiltroSubtema("");
                setPage(1);
              }}
            />
            <Select
              aria-label="Filtrar por subtema"
              containerClassName="w-[170px]"
              options={[
                { value: "", label: "Subtema: todos" },
                ...subtemas.map((s) => ({
                  value: s.id as string,
                  label: s.nombre,
                })),
              ]}
              value={filtroSubtema}
              onChange={(e) => {
                setFiltroSubtema(e.target.value);
                setPage(1);
              }}
            />
            <Select
              aria-label="Filtrar por dificultad"
              containerClassName="w-[170px]"
              options={[
                { value: "", label: "Dificultad: todas" },
                { value: "facil", label: "Básico" },
                { value: "medio", label: "Intermedio" },
                { value: "dificil", label: "Avanzado" },
              ]}
              value={filtroDif}
              onChange={(e) => {
                setFiltroDif(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <DataTable
            columns={COLUMNS}
            rows={rows}
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
            emptyTitle="No hay reactivos que ofrecer"
            emptyText="Ajusta los filtros, o crea un reactivo nuevo para esta sección."
          />

          <button
            type="button"
            onClick={onCrearDirecto}
            className="justify-self-start text-small font-semibold text-unx-blue hover:underline"
          >
            + Crear reactivo nuevo — se agregará directo a este examen
          </button>
        </div>
      )}
    </Modal>
  );
}
