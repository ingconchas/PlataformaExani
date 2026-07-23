"use client";

import { useMemo, useState } from "react";
import {
  useConvexAuth,
  useQueries,
  useQuery,
  type RequestForQueries,
} from "convex/react";
import { type FunctionReturnType } from "convex/server";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui/data-table";
import {
  CeldaPuntaje,
  type EstadoPromedio,
} from "@/components/examenes/celda-puntaje";
import { cn } from "@/lib/utils";
import { fechaCortaConAnioMx } from "@/convex/fechas";
import { participacionDe } from "@/convex/resultados";
import {
  derivarEstructura,
  textoAciertosPorSeccion,
  PAGINA_RESUMEN,
  type FilaDeResumen,
} from "@/convex/resumen";

/** Copy exacto del mock 12 / spec de LUI-32. */
const SUBTITULO = "Todas las cifras usan el primer intento de cada alumno.";

const COLUMNAS: DataTableColumn[] = [
  { key: "examen", label: "Examen" },
  { key: "fecha", label: "Fecha" },
  { key: "participantes", label: "Participantes" },
  { key: "promedio", label: "Promedio", align: "right" },
  { key: "secciones", label: "Aciertos por sección" },
];

type Cifras = FunctionReturnType<typeof api.resumenExamenes.cifrasDe>; // CifrasDeAsignacion | null
type EstadoCifras = Cifras | undefined | Error;
type Roster = FunctionReturnType<typeof api.resumenExamenes.rosterDe>; // RosterDeGrupo | null
type EstadoRoster = Roster | undefined;

const EMPTY_FILAS: FilaDeResumen[] = [];

/**
 * RESUMEN DE EXÁMENES APLICADOS — vista de la administradora (LUI-32, mock 12).
 *
 * ══ ARQUITECTURA (plan v4) ══ El `catalogo` (grupos/ciclos) es la fuente ÚNICA de bloques y
 * filtros; `derivarEstructura` (puro) los agrupa por «{Grupo} — Ciclo {ciclo}», ordena y
 * pagina. `bloquesDe` (batched) trae el conteo aplicado de TODOS los bloques de la página;
 * `rosterDe` + N `cifrasDe` se montan SOLO para el bloque EXPANDIDO y su página de filas
 * (acordeón estricto: 1 bloque abierto ⇒ ≤`PAGINA_RESUMEN` queries pesadas simultáneas). Las
 * cifras salen de los mismos helpers que Resultados del examen (paridad por construcción).
 */
export function ResumenExamenesClient() {
  const { isAuthenticated } = useConvexAuth();
  const catalogo = useQuery(
    api.resumenExamenes.catalogo,
    isAuthenticated ? {} : "skip",
  );

  const [cicloSel, setCicloSel] = useState("");
  const [grupoSel, setGrupoSel] = useState("");
  const [paginaBloques, setPaginaBloques] = useState(1);
  // Acordeón estricto: `undefined` = sin interacción (abre el primero de la página); `null` =
  // colapsó todo; string = ese bloque abierto.
  const [expandido, setExpandido] = useState<string | null | undefined>(undefined);
  const [paginaFila, setPaginaFila] = useState(1);

  const estructura = useMemo(() => {
    const grupos =
      catalogo && catalogo.problema === null ? catalogo.grupos : [];
    return derivarEstructura({ grupos }, { cicloSel, grupoSel, paginaBloques });
  }, [catalogo, cicloSel, grupoSel, paginaBloques]);

  const bloqueIds = useMemo(
    () => estructura.bloques.map((b) => b.grupoId as string),
    [estructura.bloques],
  );

  const bloques = useQuery(
    api.resumenExamenes.bloquesDe,
    isAuthenticated && bloqueIds.length > 0
      ? { grupoIds: bloqueIds as Id<"grupos">[] }
      : "skip",
  );

  const expandidoEfectivo =
    expandido !== undefined &&
    (expandido === null || bloqueIds.includes(expandido))
      ? expandido
      : (bloqueIds[0] ?? null);

  const bloqueExp =
    estructura.bloques.find((b) => b.grupoId === expandidoEfectivo) ?? null;
  const datosExp =
    bloqueExp && bloques ? bloques.porGrupo[bloqueExp.grupoId] : undefined;
  const filasExp = datosExp?.filas ?? EMPTY_FILAS;
  const totalPaginasFila = Math.max(1, Math.ceil(filasExp.length / PAGINA_RESUMEN));
  const paginaFilaAcotada = Math.min(paginaFila, totalPaginasFila);
  const filasVisibles = useMemo(
    () =>
      filasExp.slice(
        (paginaFilaAcotada - 1) * PAGINA_RESUMEN,
        paginaFilaAcotada * PAGINA_RESUMEN,
      ),
    [filasExp, paginaFilaAcotada],
  );

  const roster = useQuery(
    api.resumenExamenes.rosterDe,
    isAuthenticated && bloqueExp
      ? { grupoId: bloqueExp.grupoId as Id<"grupos"> }
      : "skip",
  ) as EstadoRoster;

  const idsKey = filasVisibles.map((f) => f.asignacionId).join(",");
  const cifrasReqs = useMemo(() => {
    const r: RequestForQueries = {};
    for (const f of filasVisibles) {
      r[f.asignacionId] = {
        query: api.resumenExamenes.cifrasDe,
        args: { asignacionId: f.asignacionId as Id<"asignaciones"> },
      };
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  const cifras = useQueries(cifrasReqs);

  // Reset del acordeón y de la página de filas al cambiar filtros o página de bloques: el
  // primer bloque de la nueva vista abre por default (colapsar a `undefined`).
  const cambiarCiclo = (v: string) => {
    setCicloSel(v);
    setGrupoSel("");
    setPaginaBloques(1);
    setExpandido(undefined);
    setPaginaFila(1);
  };
  const cambiarGrupo = (v: string) => {
    setGrupoSel(v);
    setPaginaBloques(1);
    setExpandido(undefined);
    setPaginaFila(1);
  };
  const cambiarPaginaBloques = (p: number) => {
    setPaginaBloques(p);
    setExpandido(undefined);
    setPaginaFila(1);
  };
  const toggleBloque = (grupoId: string) => {
    setExpandido(expandidoEfectivo === grupoId ? null : grupoId);
    setPaginaFila(1);
  };

  if (catalogo === undefined) {
    return <PageHeader title="Resumen de exámenes" description={SUBTITULO} />;
  }

  const filtros = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-[190px]">
        <Select
          aria-label="Filtrar por grupo"
          data-filtro-grupo
          options={estructura.opcionesGrupo.map((o) => ({
            value: o.valor,
            label: o.etiqueta,
          }))}
          value={grupoSel}
          onChange={(e) => cambiarGrupo(e.target.value)}
        />
      </div>
      <div className="w-[150px]">
        <Select
          aria-label="Filtrar por ciclo"
          data-filtro-ciclo
          options={estructura.opcionesCiclo.map((o) => ({
            value: o.valor,
            label: o.etiqueta,
          }))}
          value={estructura.cicloEfectivo}
          onChange={(e) => cambiarCiclo(e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <div data-resumen-examenes>
      <PageHeader
        title="Resumen de exámenes"
        description={SUBTITULO}
        action={estructura.opcionesCiclo.length > 0 ? filtros : undefined}
      />

      <p className="mb-6 text-small text-muted">
        Este resumen lista las aplicaciones por grupo; las asignaciones
        individuales se consultan en la ficha de cada examen.
      </p>

      {catalogo.problema === "catalogo" ? (
        <Alert kind="warning">
          El catálogo de grupos es demasiado grande para resolverse aquí; no es
          posible mostrar el resumen.
        </Alert>
      ) : estructura.bloques.length === 0 ? (
        <Alert kind="info">
          Todavía no hay grupos que mostrar en este ciclo.
        </Alert>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {estructura.bloques.map((b) => {
              const datos = bloques ? bloques.porGrupo[b.grupoId] : undefined;
              const abierto = expandidoEfectivo === b.grupoId;
              const subtitulo =
                datos === undefined
                  ? "…"
                  : datos.problema === "asignaciones"
                    ? "Datos incompletos"
                    : `${datos.filas.length} simulacro${datos.filas.length === 1 ? "" : "s"} aplicado${datos.filas.length === 1 ? "" : "s"}`;

              return (
                <section key={b.grupoId} data-bloque-grupo={b.titulo}>
                  <button
                    type="button"
                    aria-expanded={abierto}
                    onClick={() => toggleBloque(b.grupoId)}
                    className="flex w-full items-center gap-2 rounded-control px-1 py-2 text-left transition-colors hover:bg-bg"
                  >
                    <ChevronDown
                      className={cn(
                        "size-5 shrink-0 text-muted transition-transform",
                        !abierto && "-rotate-90",
                      )}
                      aria-hidden
                    />
                    <span className="text-h3 text-ink">{b.titulo}</span>
                    <span className="text-small text-muted">{subtitulo}</span>
                    {b.inactivo && (
                      <Badge tone="neutral" className="ml-1">
                        Inactivo
                      </Badge>
                    )}
                  </button>

                  {abierto && (
                    <div className="mt-2">
                      <CuerpoBloque
                        datos={datos}
                        filasVisibles={filasVisibles}
                        cifras={cifras}
                        roster={roster}
                        pagina={paginaFilaAcotada}
                        totalPaginas={totalPaginasFila}
                        onPagina={setPaginaFila}
                      />
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {estructura.totalPaginasBloques > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3 text-small">
              <button
                type="button"
                disabled={estructura.paginaBloques <= 1}
                onClick={() => cambiarPaginaBloques(estructura.paginaBloques - 1)}
                className="rounded-control px-3 py-1.5 font-semibold text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-disabled-text disabled:hover:bg-transparent"
              >
                ‹ Anteriores
              </button>
              <span className="text-muted">
                Grupos {estructura.paginaBloques} / {estructura.totalPaginasBloques}
              </span>
              <button
                type="button"
                disabled={
                  estructura.paginaBloques >= estructura.totalPaginasBloques
                }
                onClick={() => cambiarPaginaBloques(estructura.paginaBloques + 1)}
                className="rounded-control px-3 py-1.5 font-semibold text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-disabled-text disabled:hover:bg-transparent"
              >
                Siguientes ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CuerpoBloque({
  datos,
  filasVisibles,
  cifras,
  roster,
  pagina,
  totalPaginas,
  onPagina,
}: {
  datos: { filas: FilaDeResumen[]; problema: "asignaciones" | null } | undefined;
  filasVisibles: FilaDeResumen[];
  cifras: Record<string, EstadoCifras>;
  roster: EstadoRoster;
  pagina: number;
  totalPaginas: number;
  onPagina: (p: number) => void;
}) {
  if (datos === undefined) {
    return <p className="px-1 text-small text-muted">Cargando…</p>;
  }
  if (datos.problema === "asignaciones") {
    return (
      <Card>
        <p className="text-body font-semibold text-ink">Datos incompletos</p>
        <p className="mt-1 text-small text-muted">
          Este grupo tiene más aplicaciones de las que el presupuesto de lectura
          permite mostrar aquí.
        </p>
      </Card>
    );
  }
  if (datos.filas.length === 0) {
    return (
      <Card>
        <p className="text-small text-muted">
          Este grupo aún no tiene simulacros aplicados.
        </p>
      </Card>
    );
  }

  const hrefPorId = new Map<string, string>();
  const filasTabla: DataTableRow[] = filasVisibles.map((f) => {
    const c = cifras[f.asignacionId];
    const cargado = c !== undefined && c !== null && !(c instanceof Error);
    const titulo = f.titulo ?? (cargado ? c.titulo : null);
    const href = `/admin/examenes/biblioteca/${f.examenId}/resultados?asignacion=${f.asignacionId}`;
    hrefPorId.set(f.asignacionId, href);
    return {
      id: f.asignacionId,
      examen: (
        <Link
          href={href}
          data-fila-examen={titulo ?? ""}
          className="font-semibold text-ink hover:text-unx-blue hover:underline"
          title={titulo === null ? "Título no registrado" : undefined}
        >
          {titulo ?? "—"}
        </Link>
      ),
      fecha: (
        <span className="text-muted">{fechaCortaConAnioMx(f.abreEn)}</span>
      ),
      participantes: <CeldaParticipacion cifras={c} roster={roster} />,
      promedio: <CeldaPuntaje estado={estadoPromedioDe(c)} />,
      secciones: <CeldaSecciones cifras={c} />,
    };
  });

  return (
    <DataTable
      columns={COLUMNAS}
      rows={filasTabla}
      rowHref={(row) => hrefPorId.get(row.id)}
      page={pagina}
      pageCount={totalPaginas}
      onPageChange={onPagina}
    />
  );
}

/** Los cinco estados de la celda de promedio a partir del estado de `cifrasDe`. */
function estadoPromedioDe(c: EstadoCifras): EstadoPromedio {
  if (c === undefined) return undefined;
  if (c === null || c instanceof Error) return c;
  if (c.problema) return { valor: null, incompleto: true };
  return { valor: c.promedio, incompleto: false };
}

function CeldaParticipacion({
  cifras,
  roster,
}: {
  cifras: EstadoCifras;
  roster: EstadoRoster;
}) {
  if (cifras === undefined || roster === undefined) {
    return <span className="text-muted">…</span>;
  }
  if (cifras === null || cifras instanceof Error || roster === null) {
    return (
      <span
        className="text-small text-muted"
        title="No se pudieron cargar los participantes."
      >
        Datos incompletos
      </span>
    );
  }
  if (cifras.problema || roster.problema) {
    return (
      <span
        className="text-small text-muted"
        title="No se pudieron cargar los participantes."
      >
        Datos incompletos
      </span>
    );
  }
  const part = participacionDe(cifras.enviadasAlumnoIds, roster.alumnoIds);
  const pct =
    roster.deTotal > 0
      ? Math.min(100, (part.completaron / roster.deTotal) * 100)
      : 0;
  return (
    <div>
      <span className="flex items-center gap-2">
        <span className="tabular-nums whitespace-nowrap" data-participacion>
          {part.completaron} de {roster.deTotal}
        </span>
        <span
          aria-hidden
          className="inline-block h-1.5 w-[60px] shrink-0 overflow-hidden rounded-full bg-border"
        >
          <span
            className="block h-full rounded-full bg-unx-blue"
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
      {part.fuerasDeRoster > 0 && (
        <p className="mt-0.5 text-caption text-muted" data-fuera-roster>
          +{part.fuerasDeRoster} fuera del roster
        </p>
      )}
    </div>
  );
}

function CeldaSecciones({ cifras }: { cifras: EstadoCifras }) {
  if (cifras === undefined) return <span className="text-muted">…</span>;
  if (cifras === null || cifras instanceof Error) {
    return <span className="text-small text-muted">Datos incompletos</span>;
  }
  if (cifras.problema) {
    return (
      <span
        className="text-small text-muted"
        title="No se pudo cargar el desglose por sección."
      >
        Datos incompletos
      </span>
    );
  }
  const { seccionesTexto, seccionesTitulo } = textoAciertosPorSeccion(
    cifras.secciones,
  );
  // Sin ninguna sección con datos Y sin envíos legados: «—» a secas. Pero si hay envíos SIN
  // desglose (legado), el caption debe verse aunque no haya ninguna sección que mostrar —
  // de lo contrario una fila 100 % legada ocultaría que sus cifras no incluyen desglose.
  if (seccionesTexto === "" && cifras.sinDesglose === 0)
    return <span className="text-muted">—</span>;
  return (
    <div>
      {/* El vidente ve las abreviaturas; el lector de pantalla lee los nombres COMPLETOS
          (sr-only), no solo el `title` — que es inaccesible en móvil/teclado/lectores. */}
      {seccionesTexto === "" ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="text-muted" title={seccionesTitulo} data-secciones>
          <span aria-hidden="true">{seccionesTexto}</span>
          <span className="sr-only">{seccionesTitulo}</span>
        </span>
      )}
      {cifras.sinDesglose > 0 && (
        <p className="mt-0.5 text-caption text-muted" data-sin-desglose>
          {cifras.sinDesglose} sin desglose
        </p>
      )}
    </div>
  );
}
