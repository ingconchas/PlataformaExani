"use client";

import { useCallback, useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ChevronDown, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { HBarChart } from "@/components/ui/hbar-chart";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";
import { cn } from "@/lib/utils";
import {
  derivarResultados,
  derivarSelectorResultados,
  pctDeFraccion,
  type AsignacionId,
  type ResultadosQ1,
  type ResultadosQ2,
  type ResultadosQ3,
  type ProblemaResultados,
} from "@/convex/resultados";
import { fechaHoraMx } from "@/convex/fechas";

/** Subtítulo FIJO de la pantalla (copy exacto del issue LUI-30). */
const SUBTITULO =
  "Todas las cifras usan el primer intento (diagnóstico) de cada alumno; los repasos no alteran estos resultados.";

/** Filas por página de la tabla de alumnas (los grupos superan las ~8 del mock). */
const FILAS_POR_PAGINA = 20;

const COPY_PROBLEMA: Record<ProblemaResultados, string> = {
  roster:
    "El grupo tiene demasiados perfiles para leer su lista aquí; no es posible mostrar resultados completos.",
  intentos:
    "Esta aplicación tiene más intentos de los que el presupuesto de lectura permite; para no mostrar cifras parciales, la analítica no está disponible.",
  clasificaciones:
    "El catálogo de secciones y áreas de estos resultados es demasiado grande para resolverse aquí; la analítica no está disponible.",
};

/**
 * RESULTADOS DEL EXAMEN — vista del instructor y gemela admin (LUI-30 · LUI-31
 * integrada; mock 20, variante 02 = administradora en solo lectura).
 *
 * ══ ARQUITECTURA (plan v4-M2) ══ TRES capas con UN solo reloj anclado a Q1:
 *  1. El wrapper monta Q1 (`deExamen`) y resuelve encabezado/estados de problema.
 *  2. `derivarSelectorResultados(asignacionesQ1, ahora)` — derivación pura PROPIA del
 *     selector: particiona programadas/elegibles, decide el default y entrega las
 *     FRONTERAS del conjunto (todos los `abreEn`/`cierraEn` futuros — la del cierre de la
 *     seleccionada incluida). Al cruzar un `abreEn` la re-derivación habilita Q2/Q3 SIN
 *     recargar; una PROGRAMADA seleccionada muestra placeholder sin montar Q2/Q3.
 *  3. `ResultadosCargados` monta SOLO con Q2 y Q3 resueltas y deriva TODO con
 *     `derivarResultados(q2, q3, ahora)` — su única lectura del reloj es el flip
 *     Pendiente→«No contestó» al cruzar el cierre (jamás estampado por el servidor).
 */
export function ResultadosExamenClient({
  examenId,
  variante,
  asignacionInicial,
}: {
  examenId: string;
  variante: "instructor" | "admin";
  /** Preselección OPCIONAL desde el drill-down del Resumen (LUI-32, `?asignacion=`). Solo
   *  afecta la UI: si el id no es una opción válida, `ResultadosConSelector` cae al default
   *  (validación existente `opciones.some(...)`); las queries autorizan igual. */
  asignacionInicial?: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const q1 = useQuery(
    api.resultadosExamen.deExamen,
    isAuthenticated ? { examenId } : "skip",
  );
  const [seleccionManual, setSeleccionManual] = useState<string | null>(
    asignacionInicial ?? null,
  );

  if (q1 === undefined) {
    return <PageHeader title="Resultados" description={SUBTITULO} />;
  }
  if (q1 === null) {
    return (
      <>
        <PageHeader title="Resultados" />
        <Alert kind="warning">Este examen no existe o fue eliminado.</Alert>
      </>
    );
  }
  if (q1.problema !== null) {
    const copy: Record<NonNullable<typeof q1.problema>, string> = {
      membresia:
        "Tu membresía de grupos supera el límite legible; no es posible resolver tu acceso a estos resultados.",
      catalogo:
        "El catálogo de grupos es demasiado grande para resolverse aquí; no es posible mostrar el selector.",
      asignaciones:
        "Este examen tiene más aplicaciones de las que el presupuesto de lectura permite; no es posible mostrar el selector completo.",
    };
    return (
      <>
        <PageHeader
          title={`${q1.examen.titulo} — Resultados`}
          description={SUBTITULO}
        />
        <Alert kind="warning">{copy[q1.problema]}</Alert>
      </>
    );
  }
  return (
    <ResultadosConSelector
      q1={q1}
      variante={variante}
      seleccionManual={seleccionManual}
      onSeleccionar={setSeleccionManual}
    />
  );
}

function ResultadosConSelector({
  q1,
  variante,
  seleccionManual,
  onSeleccionar,
}: {
  q1: ResultadosQ1;
  variante: "instructor" | "admin";
  seleccionManual: string | null;
  onSeleccionar: (id: string) => void;
}) {
  // UN reloj para toda la pantalla, anclado a Q1. Las fronteras son FUNCIÓN de `ahora`
  // (contrato del hook): las entrega la derivación pura del selector — incluyen el
  // próximo `abreEn` (habilita una programada sin recargar) y cada `cierraEn` futuro
  // (el flip Pendiente→«No contestó» de la seleccionada).
  const fronterasDe = useCallback(
    (t: number) => derivarSelectorResultados(q1.asignaciones, t).fronteras,
    [q1.asignaciones],
  );
  const ahora = useRelojAnclado(q1.ahoraServidor, fronterasDe);

  const selector = useMemo(
    () => derivarSelectorResultados(q1.asignaciones, ahora),
    [q1.asignaciones, ahora],
  );
  const seleccionadaId: AsignacionId | null =
    seleccionManual !== null &&
    selector.opciones.some((o) => o.asignacionId === seleccionManual)
      ? (seleccionManual as AsignacionId)
      : selector.seleccionDefault;
  const opcion =
    selector.opciones.find((o) => o.asignacionId === seleccionadaId) ?? null;
  const asignacionCruda =
    q1.asignaciones.find((a) => a.asignacionId === seleccionadaId) ?? null;

  // Q2/Q3 SOLO para una selección elegible (una programada no tiene resultados que
  // montar; el skip también evita pedir con `null`).
  const habilitada =
    opcion !== null &&
    opcion.estadoVentana !== "programada" &&
    seleccionadaId !== null;
  const q2 = useQuery(
    api.resultadosExamen.deAsignacion,
    habilitada ? { asignacionId: seleccionadaId } : "skip",
  );
  const q3 = useQuery(
    api.resultadosExamen.intentosDe,
    habilitada ? { asignacionId: seleccionadaId } : "skip",
  );

  const esAdmin = variante === "admin";

  return (
    <div data-resultados>
      {esAdmin ? (
        <>
          {/* Banner candado de la variante administradora (mock 20, variante 02). */}
          <div
            data-banner-solo-lectura
            className="mb-4 flex items-center gap-3 rounded-card border border-border bg-bg px-4 py-3 text-small text-text"
          >
            <Lock className="size-4 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-semibold text-ink">
                Vista de solo lectura
              </span>{" "}
              — Resumen de exámenes
            </span>
          </div>
          {/* Breadcrumb exigido por la spec de LUI-32 (manda sobre el mock, que lo omite). */}
          <Breadcrumb
            items={[
              { label: "Resumen de exámenes", href: "/admin/examenes" },
              {
                label: `${q1.examen.titulo}${
                  asignacionCruda?.grupoNombre
                    ? ` · ${asignacionCruda.grupoNombre}`
                    : ""
                }`,
              },
            ]}
          />
        </>
      ) : (
        <Breadcrumb
          items={[
            { label: "Exámenes", href: "/instructor/examenes" },
            { label: q1.examen.titulo },
            { label: "Resultados" },
          ]}
        />
      )}

      <div className="mt-2">
        <PageHeader
          title={`${q1.examen.titulo} — Resultados`}
          description={SUBTITULO}
        />
      </div>

      {(q1.individualesOmitidas > 0 || (!esAdmin && q1.ajenasOmitidas > 0)) && (
        <p className="mb-3 text-small text-muted">
          {q1.individualesOmitidas > 0 &&
            `${q1.individualesOmitidas} asignación${q1.individualesOmitidas === 1 ? "" : "es"} individual${q1.individualesOmitidas === 1 ? "" : "es"} no se muestra${q1.individualesOmitidas === 1 ? "" : "n"} aquí. `}
          {!esAdmin &&
            q1.ajenasOmitidas > 0 &&
            `${q1.ajenasOmitidas} aplicación${q1.ajenasOmitidas === 1 ? "" : "es"} de grupos que no impartes no se lista${q1.ajenasOmitidas === 1 ? "" : "n"}.`}
        </p>
      )}

      {selector.opciones.length === 0 ? (
        <Alert kind="info">
          Este examen todavía no tiene aplicaciones a grupos.
        </Alert>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Select
              aria-label="Grupo"
              containerClassName="w-64"
              data-selector-grupo
              options={selector.opciones.map((o) => ({
                value: o.asignacionId,
                label: o.etiqueta,
              }))}
              value={seleccionadaId ?? ""}
              onChange={(e) => onSeleccionar(e.target.value)}
            />
            {opcion && opcion.estadoVentana !== "programada" && (
              <span className="text-small text-muted">
                Aplicado el {opcion.fechaAbre}
              </span>
            )}
          </div>

          {opcion && opcion.estadoVentana === "programada" ? (
            <Alert kind="info">
              Esta aplicación aún no abre — programada para el{" "}
              {fechaHoraMx(opcion.abreEn)}. Los resultados aparecerán cuando el
              grupo pueda presentarla.
            </Alert>
          ) : q2 === undefined || q3 === undefined ? (
            <p className="text-small text-muted">Cargando resultados…</p>
          ) : q2 === null || q3 === null ? (
            <Alert kind="warning">
              No tienes acceso a esta aplicación (el grupo pudo cambiar entre
              lecturas).
            </Alert>
          ) : (
            <ResultadosCargados q2={q2} q3={q3} ahora={ahora} />
          )}
        </>
      )}
    </div>
  );
}

/** Cifra grande del promedio (40px condensed, mock 20) con los TRES estados de
 *  `CeldaPuntaje` del panel: cifra / «—» (sin calificados) / «Datos incompletos». */
function CifraPromedio({
  valor,
  incompleto,
}: {
  valor: number | null;
  incompleto: boolean;
}) {
  if (incompleto)
    return (
      <span
        className="text-small text-muted"
        title="Esta aplicación tiene demasiados intentos para promediar aquí."
      >
        Datos incompletos
      </span>
    );
  if (valor === null) return <span className="text-[40px] text-muted">—</span>;
  return (
    <span
      data-promedio
      className="font-condensed text-[40px] font-semibold leading-none tabular-nums text-ink"
    >
      {valor}
    </span>
  );
}

const BADGE_ESTADO: Record<
  "completado" | "en_curso" | "pendiente" | "no_contesto",
  { tone: "green" | "blue" | "yellow" | "neutral"; texto: string }
> = {
  completado: { tone: "green", texto: "Completado" },
  en_curso: { tone: "blue", texto: "En curso" },
  pendiente: { tone: "yellow", texto: "No ha iniciado" },
  no_contesto: { tone: "neutral", texto: "No contestó" },
};

function ResultadosCargados({
  q2,
  q3,
  ahora,
}: {
  q2: ResultadosQ2;
  q3: ResultadosQ3;
  ahora: number;
}) {
  const r = useMemo(() => derivarResultados(q2, q3, ahora), [q2, q3, ahora]);
  // Acordeón (patrón del temario): el estado guarda SOLO desviaciones del default; el
  // default abre la sección MÁS DÉBIL — el insumo directo para planear el repaso.
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);

  if (r.estado === "problema") {
    return <Alert kind="warning">{COPY_PROBLEMA[r.problema]}</Alert>;
  }

  const claveSeccion = (id: string | null) => id ?? "sin-clasificacion";
  const conPct = r.acordeon.filter((s) => s.pct !== null);
  const masDebil =
    conPct.length > 0
      ? conPct.reduce((min, s) => ((s.pct ?? 1) < (min.pct ?? 1) ? s : min))
      : null;
  const estaExpandida = (id: string | null) =>
    expansion[claveSeccion(id)] ??
    (masDebil !== null && claveSeccion(id) === claveSeccion(masDebil.seccionId));

  const columnas: DataTableColumn[] = [
    { key: "alumno", label: "Alumno" },
    { key: "puntaje", label: "Puntaje", align: "right" },
    ...r.columnas.map((c, i) => ({
      key: `sec-${i}`,
      label: c.nombre ?? "Sección eliminada",
      align: "center" as const,
    })),
    { key: "estado", label: "Estado" },
  ];

  const filtro = busqueda.trim().toLocaleLowerCase("es");
  const filasFiltradas = r.filas.filter(
    (f) => filtro === "" || f.nombre.toLocaleLowerCase("es").includes(filtro),
  );
  const totalPaginas = Math.max(1, Math.ceil(filasFiltradas.length / FILAS_POR_PAGINA));
  const paginaAcotada = Math.min(pagina, totalPaginas);
  const visibles = filasFiltradas.slice(
    (paginaAcotada - 1) * FILAS_POR_PAGINA,
    paginaAcotada * FILAS_POR_PAGINA,
  );

  const filasTabla = visibles.map((f) => {
    const badge = BADGE_ESTADO[f.estado];
    return {
      id: f.alumnoId as string,
      alumno: (
        <span data-fila-alumno={f.nombre} className="font-semibold text-ink">
          {f.nombre}
        </span>
      ),
      puntaje:
        f.puntaje !== null ? (
          <span className="font-condensed text-[18px] font-semibold tabular-nums text-unx-blue">
            {f.puntaje}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
      ...Object.fromEntries(
        f.porSeccion.map((c, i) => [
          `sec-${i}`,
          c !== null ? (
            <span className="tabular-nums text-muted">
              {c.aciertos}/{c.total}
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
        ]),
      ),
      estado: (
        <div data-estado={f.estado}>
          <Badge tone={badge.tone}>{badge.texto}</Badge>
          {f.estado === "completado" && f.enviadoEn !== null && (
            <p className="mt-1 text-caption text-muted">
              {fechaHoraMx(f.enviadoEn)}
            </p>
          )}
          {f.estado === "en_curso" && f.iniciadoEn !== null && (
            <p className="mt-1 text-caption text-muted">
              Inició el {fechaHoraMx(f.iniciadoEn)}
            </p>
          )}
        </div>
      ),
    };
  });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CifraPromedio
            valor={r.promedio.valor}
            incompleto={r.promedio.incompleto}
          />
          <p className="mt-1 text-small text-muted">
            Promedio del grupo · escala 700–1300
          </p>
          {(r.mayorPuntaje !== null || r.menorPuntaje !== null) && (
            <p className="mt-1 text-caption text-muted">
              Más alto {r.mayorPuntaje ?? "—"} · Más bajo {r.menorPuntaje ?? "—"}
            </p>
          )}
        </Card>
        <Card>
          <span
            data-participacion
            className="font-condensed text-[40px] font-semibold leading-none tabular-nums text-ink"
          >
            {r.participacion.completaron} de {r.participacion.total}
          </span>
          <ProgressBar
            className="mt-2"
            value={r.participacion.completaron}
            max={r.participacion.total}
            tone={r.participacion.tono}
            label="Participación"
          />
        </Card>
        <Card>
          {/* DOS ausencias distintas (media del GO de B): `null` = sin datos agregados
              («—»); `nombre: null` = la sección EXISTE en la analítica pero su doc fue
              eliminado — se dice igual que en el acordeón y la tabla, jamás se colapsa
              a «sin datos». */}
          <span className="text-h3 text-ink" data-mejor-seccion>
            {r.mejorSeccion === null
              ? "—"
              : (r.mejorSeccion.nombre ?? "Sección eliminada")}
          </span>
          <p className="mt-1 text-small text-muted">Mejor sección del grupo</p>
        </Card>
      </div>

      {(r.desgloseIncompleto > 0 || r.presentaronFueraDeRoster > 0) && (
        <p className="mt-3 text-small text-muted">
          {r.desgloseIncompleto > 0 &&
            `El desglose por área no incluye ${r.desgloseIncompleto} envío${r.desgloseIncompleto === 1 ? "" : "s"} antiguo${r.desgloseIncompleto === 1 ? "" : "s"} (sin detalle por sección). `}
          {r.presentaronFueraDeRoster > 0 &&
            `${r.presentaronFueraDeRoster} resultado${r.presentaronFueraDeRoster === 1 ? "" : "s"} de alumnas que ya no están en el grupo cuenta${r.presentaronFueraDeRoster === 1 ? "" : "n"} en el promedio.`}
        </p>
      )}

      <Card className="mt-6">
        <CardTitle>Desempeño por área temática</CardTitle>
        <CardDescription>
          Porcentaje de aciertos del grupo · insumo para planear la siguiente
          sesión · da clic en una materia para abrir sus áreas
        </CardDescription>
        <div className="mt-4 flex flex-col gap-1">
          {r.acordeon.length === 0 && (
            <p className="text-small text-muted">
              Aún no hay envíos con desglose para graficar.
            </p>
          )}
          {r.acordeon.map((s) => {
            const clave = claveSeccion(s.seccionId);
            const abierta = estaExpandida(s.seccionId);
            const nombre =
              s.seccionId === null
                ? "Sin clasificación vigente"
                : (s.nombre ?? "Sección eliminada");
            return (
              <div key={clave} data-acordeon-seccion={nombre}>
                <button
                  type="button"
                  aria-expanded={abierta}
                  onClick={() =>
                    setExpansion((prev) => ({ ...prev, [clave]: !abierta }))
                  }
                  className="font-condensed flex w-full items-center gap-2 rounded-control px-2 py-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-text transition-colors hover:bg-bg"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      !abierta && "-rotate-90",
                    )}
                    aria-hidden
                  />
                  {nombre}
                  {s.pct !== null && (
                    <span className="tabular-nums">
                      · {pctDeFraccion(s.pct)}%
                    </span>
                  )}
                </button>
                {abierta && (
                  <div className="px-2 pb-3 pt-1">
                    {s.areas.length === 0 ? (
                      <p className="text-small text-muted">
                        Sin áreas con datos en esta sección.
                      </p>
                    ) : (
                      <HBarChart
                        highlightTag="reforzar en repaso"
                        data={s.areas.map((a) => ({
                          label: a.nombre ?? "Área eliminada",
                          value: pctDeFraccion(a.pct),
                          highlight: a.reforzar,
                        }))}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <section aria-labelledby="tabla-alumnas" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="tabla-alumnas" className="text-h3 text-ink">
            Resultados por alumno
          </h2>
          <SearchInput
            placeholder="Buscar alumno…"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <DataTable
          columns={columnas}
          rows={filasTabla}
          page={paginaAcotada}
          pageCount={totalPaginas}
          onPageChange={setPagina}
          emptyTitle={
            busqueda ? "Sin coincidencias" : "Este grupo no tiene alumnas"
          }
          emptyText={
            busqueda
              ? "Ningún alumno coincide con la búsqueda."
              : "Cuando el grupo tenga alumnas activas, aparecerán aquí."
          }
        />
      </section>
    </>
  );
}
