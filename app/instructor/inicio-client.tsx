"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import {
  useConvexAuth,
  useQueries,
  useQuery,
  type RequestForQueries,
} from "convex/react";
import { Database, FileText } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  MAX_GRUPOS_PANEL,
  MAX_PENDIENTES_VISIBLES,
  derivarPanelInstructor,
  type EstadoParticipacion,
  type GrupoId,
  type ParticipacionDeGrupo,
} from "@/convex/participacion";
import { fechaHoraMx, fechaLargaMx } from "@/convex/fechas";
import { useRelojAnclado } from "@/lib/use-reloj-anclado";

type Q1 = FunctionReturnType<typeof api.panelInstructor.resumen>;
type Material = FunctionReturnType<typeof api.panelInstructor.material>;

// Enlaces con forma de botón (un <Button> dentro de <Link> anidaría interactivos):
// las clases COMPLETAS del Button primary/secondary md (button.tsx).
const LINK_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control bg-unx-blue px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-unx-blue-hover";
const LINK_SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-control border-[1.5px] border-unx-blue bg-surface px-4 text-body font-medium text-unx-blue transition-colors duration-150 hover:bg-unx-blue-tint";

const COLUMNAS_PENDIENTES: DataTableColumn[] = [
  { key: "alumno", label: "Alumno" },
  { key: "grupo", label: "Grupo" },
  { key: "examen", label: "Examen" },
  { key: "estado", label: "Estado", align: "right" },
];

/**
 * Panel principal del instructor (LUI-19 · Diseño 13) en TRES capas — la
 * partición espeja las TRES queries de `convex/panelInstructor.ts` (una query no
 * puede paginar dos veces) y las reglas de Hooks (precedente
 * `asignar-examen-client`: el wrapper resuelve la carga y el componente CARGADO
 * posee los hooks del reloj, que deben correr incondicionales):
 *
 *   1. `InicioInstructorClient` — Q1/Q3 + rama de carga (sin falso vacío).
 *   2. `ParticipacionesLoader`  — las Q2 por grupo vía `useQueries` (UN hook,
 *      mapa dinámico) y la NORMALIZACIÓN de su contrato COMPLETO
 *      `resultado | null | undefined | Error`.
 *   3. `PanelInstructorCargado` — reloj anclado + derivación + render.
 */
export function InicioInstructorClient() {
  const { isAuthenticated } = useConvexAuth();
  // `skip` mientras no hay sesión: evita el parpadeo del error de `requireStaff`
  // durante la hidratación (mismo patrón que el resto del panel).
  const q1 = useQuery(
    api.panelInstructor.resumen,
    isAuthenticated ? {} : "skip",
  );
  const material = useQuery(
    api.panelInstructor.material,
    isAuthenticated ? {} : "skip",
  );

  // Rama de CARGA explícita (tras los hooks): sin ella, un `panel === undefined`
  // convertido en listas vacías pintaría el falso «No tienes exámenes…».
  if (q1 === undefined) {
    return <PageHeader title="Hola" />;
  }
  return <ParticipacionesLoader q1={q1} material={material} />;
}

function ParticipacionesLoader({
  q1,
  material,
}: {
  q1: Q1;
  material: Material | undefined;
}) {
  // Una Q2 por grupo SANO con al menos una asignación viva en Q1. Los grupos con
  // `problema` no montan Q2 (sus asignaciones ni siquiera viajaron).
  const gruposConVivas = useMemo(() => {
    const conVivas = new Set<string>(
      q1.asignaciones.map((a) => a.grupoId as string),
    );
    return q1.grupos.filter(
      (g) => g.problema === undefined && conVivas.has(g.grupoId as string),
    );
  }, [q1]);

  const peticiones = useMemo(() => {
    const r: RequestForQueries = {};
    for (const g of gruposConVivas) {
      r[g.grupoId as string] = {
        query: api.panelInstructor.participacionDeGrupo,
        args: { grupoId: g.grupoId },
      };
    }
    return r;
  }, [gruposConVivas]);
  const resultados = useQueries(peticiones);

  // Contrato COMPLETO de useQueries: `resultado | null | undefined | Error`.
  //  · `undefined` → cargando (el ÚNICO estado que cuenta como carga);
  //  · `null` → la query negó el acceso (membresía revocada o grupo cerrado
  //    entre snapshots) → "sin_acceso" — problema por grupo, NO carga;
  //  · `Error` → "error" — problema por grupo;
  //  · resultado → datos (que aún pueden traer `problema`/`sondasOmitidas`).
  const participaciones = useMemo(() => {
    const m = new Map<GrupoId, EstadoParticipacion>();
    for (const g of gruposConVivas) {
      const r = resultados[g.grupoId as string] as
        | ParticipacionDeGrupo
        | null
        | undefined
        | Error;
      if (r instanceof Error) m.set(g.grupoId, "error");
      else if (r === null) m.set(g.grupoId, "sin_acceso");
      else m.set(g.grupoId, r);
    }
    return m;
  }, [gruposConVivas, resultados]);

  return (
    <PanelInstructorCargado
      q1={q1}
      material={material}
      participaciones={participaciones}
    />
  );
}

function PanelInstructorCargado({
  q1,
  material,
  participaciones,
}: {
  q1: Q1;
  material: Material | undefined;
  participaciones: ReadonlyMap<GrupoId, EstadoParticipacion>;
}) {
  // ── Reloj ANCLADO al servidor ──────────────────────────────────────────────
  // El hook compartido `useRelojAnclado` (extraído al tercer consumidor, como estaba
  // declarado aquí): `ahoraServidor` es ancla de INICIO, el avance lo pone
  // `performance.now()` y el timer despierta en las FRONTERAS de la derivación —
  // aperturas y cierres futuros (una programada APARECE al cruzar su `abreEn`; una
  // abierta DESAPARECE al cruzar su `cierraEn`, sin re-query: al cruzar no cambia
  // ningún documento) más la próxima medianoche MX (la fecha del encabezado cruza
  // sola). El contrato completo vive en `lib/use-reloj-anclado.ts`.
  //
  // Las fronteras se pasan como FUNCIÓN del reloj (contrato del hook): la próxima
  // medianoche depende del propio `ahora`, así que un arreglo fijo dejaría de tener
  // fronteras tras el primer cruce.
  const fronterasDe = useCallback(
    (t: number) => derivarPanelInstructor(q1, participaciones, t).fronteras,
    [q1, participaciones],
  );
  const ahora = useRelojAnclado(q1.ahoraServidor, fronterasDe);

  const derivado = useMemo(
    () => derivarPanelInstructor(q1, participaciones, ahora),
    [q1, participaciones, ahora],
  );

  // ── Problemas explícitos (jamás silencio) ─────────────────────────────────
  const nombreDe = useMemo(
    () => new Map(q1.grupos.map((g) => [g.grupoId as string, g.nombre])),
    [q1.grupos],
  );
  const avisosPorGrupo: { clave: string; texto: string }[] = [];
  for (const g of q1.grupos) {
    if (g.problema === "asignaciones_vivas") {
      avisosPorGrupo.push({
        clave: `vivas-${g.grupoId}`,
        texto: `El grupo «${g.nombre}» excede el límite de asignaciones vivas y no puede mostrarse en el panel.`,
      });
    }
  }
  for (const [grupoId, p] of participaciones) {
    const nombre = nombreDe.get(grupoId as string) ?? "…";
    if (p === "error") {
      avisosPorGrupo.push({
        clave: `error-${grupoId}`,
        texto: `No se pudo cargar la participación del grupo «${nombre}».`,
      });
    } else if (p === "sin_acceso") {
      avisosPorGrupo.push({
        clave: `acceso-${grupoId}`,
        texto: `Ya no tienes acceso al grupo «${nombre}» (membresía revocada o grupo cerrado); su participación no se muestra.`,
      });
    } else if (p !== undefined && p.problema === "roster") {
      avisosPorGrupo.push({
        clave: `roster-${grupoId}`,
        texto: `El roster del grupo «${nombre}» excede el límite del panel; su participación no se muestra.`,
      });
    } else if (p !== undefined && p.sondasOmitidas) {
      avisosPorGrupo.push({
        clave: `sondas-${grupoId}`,
        texto: `El volumen del grupo «${nombre}» supera el presupuesto del panel; los avances no se muestran.`,
      });
    }
  }

  const encabezado = (
    <PageHeader
      title={`Hola, ${q1.nombre}`}
      // Derivada del reloj ANCLADO (no estampada por el servidor): la próxima
      // medianoche MX está en las fronteras del timer, así que la fecha cruza
      // sola — una query no se re-ejecuta porque pase el tiempo.
      description={fechaLargaMx(ahora)}
    />
  );

  // Estados de SOLO problema: sin datos utilizables, sin secciones.
  if (q1.membresiaDesbordada) {
    return (
      <div data-ahora-servidor={q1.ahoraServidor}>
        {encabezado}
        <Alert kind="error">
          Tu cuenta tiene más grupos de los permitidos (datos previos a la
          cota); pide a una administradora depurar tus membresías.
        </Alert>
      </div>
    );
  }
  if (q1.catalogoDesbordado) {
    return (
      <div data-ahora-servidor={q1.ahoraServidor}>
        {encabezado}
        <Alert kind="error">
          El catálogo de grupos excede el límite del panel; el panel no puede
          mostrarse.
        </Alert>
      </div>
    );
  }

  const avisos = (
    <>
      {q1.gruposOmitidos && (
        <Alert kind="warning">
          Tienes más de {MAX_GRUPOS_PANEL} grupos activos; el panel muestra{" "}
          {MAX_GRUPOS_PANEL}.
        </Alert>
      )}
      {q1.asignacionesLegadasOmitidas && (
        <Alert kind="warning">
          Se omitieron asignaciones antiguas sin título registrado.
        </Alert>
      )}
      {avisosPorGrupo.map((a) => (
        <Alert key={a.clave} kind="warning">
          {a.texto}
        </Alert>
      ))}
    </>
  );

  const seccionMaterial = (
    <section aria-labelledby="tu-material" className="mt-8">
      <h2 id="tu-material" className="mb-3 text-h3 text-ink">
        Tu material
      </h2>
      <Card className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-unx-blue-tint text-unx-blue">
          <Database className="size-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">Banco de reactivos</p>
          <p className="text-small text-muted">
            {material === undefined
              ? "Cargando…"
              : material.desbordado
                ? "El conteo no está disponible (catálogo desbordado)."
                : `${material.totalReactivos} reactivos institucionales`}
          </p>
        </div>
        <Link href="/instructor/reactivos" className={LINK_SECONDARY}>
          Ir al banco
        </Link>
      </Card>
    </section>
  );

  if (derivado.cards.length === 0) {
    // El VACÍO EXITOSO (mock 13, variante 02: SOLO header + card + CTA) exige
    // datos COMPLETOS. Sin cards, no hay Q2 requeridas, así que
    // `datosPendientesCompletos` equivale a «Q1 sin omisiones»: con grupos
    // omitidos, legadas o desbordes, afirmar «no tienes exámenes» sería un
    // falso éxito con CTA contradictorio (hallazgo medio del GO de código).
    if (derivado.datosPendientesCompletos) {
      return (
        <div data-ahora-servidor={q1.ahoraServidor}>
          {encabezado}
          <div className="space-y-4">
            {avisos}
            <Card className="px-4 py-8 text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-unx-blue-tint text-unx-blue">
                <FileText className="size-6" aria-hidden />
              </div>
              <CardTitle>No tienes exámenes en aplicación</CardTitle>
              <p className="mx-auto mt-1 max-w-md text-small text-muted">
                Crea un examen y asígnalo a tus grupos para verlo aquí.
              </p>
              <div className="mt-5">
                <Link href="/instructor/examenes/nuevo" className={LINK_PRIMARY}>
                  Crear examen
                </Link>
              </div>
            </Card>
          </div>
        </div>
      );
    }
    // Q1 incompleta y cero cards visibles: estado INCOMPLETO, jamás el CTA de
    // vacío. «Tu material» sí se muestra (es independiente de los grupos: Q3).
    return (
      <div data-ahora-servidor={q1.ahoraServidor}>
        {encabezado}
        <div className="space-y-4">{avisos}</div>
        <p className="mt-4 text-small text-muted">
          No puede confirmarse tu lista de exámenes activos: hay datos omitidos
          (ver avisos).
        </p>
        {seccionMaterial}
      </div>
    );
  }

  // ── Pendientes: filas visibles + estados sin mentiras ─────────────────────
  const filasPendientes = derivado.pendientes
    .slice(0, MAX_PENDIENTES_VISIBLES)
    .map((f) => ({
      id: `${f.examenId}-${f.grupoId}-${f.alumnoId}`,
      alumno: (
        <span
          data-pendiente-alumno={f.alumnoId}
          data-grupo={f.grupoId}
          data-examen={f.examenId}
          className="font-semibold text-ink"
        >
          {f.alumnoNombre}
        </span>
      ),
      grupo: f.grupoNombre,
      examen: <span className="text-muted">{f.examenTitulo}</span>,
      estado: (
        <Badge tone={f.estado === "en_curso" ? "blue" : "orange"}>
          {f.estado === "en_curso" ? "En curso" : "No ha iniciado"}
        </Badge>
      ),
    }));

  return (
    <div data-ahora-servidor={q1.ahoraServidor}>
      {encabezado}
      <div className="space-y-4">{avisos}</div>

      <section aria-labelledby="examenes-activos" className="mt-4">
        <h2 id="examenes-activos" className="mb-3 text-h3 text-ink">
          Exámenes activos
        </h2>
        {derivado.cards.map((card) => (
          <Card
            key={card.examenId}
            data-examen-activo={card.examenId}
            className="mb-4"
          >
            <div className="flex items-start justify-between gap-4">
              <CardTitle>{card.titulo}</CardTitle>
              <Badge tone="yellow">
                {/* Derivado del read-model + reloj anclado; el «achievement»
                    sólido del mock no existe en el sistema de tintes AA. */}
                Cierra el {fechaHoraMx(card.cierraProximo)}
              </Badge>
            </div>
            {card.barras.length > 0 && (
              <div className="mt-4 grid gap-3">
                {card.barras.map((b) => (
                  <div key={b.grupoId} data-grupo-barra={b.grupoId}>
                    <ProgressBar
                      value={b.completaron}
                      max={b.total}
                      tone={b.tono}
                      label={`${b.nombre} · ${b.completaron} de ${b.total} completaron`}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <Link
                href={`/instructor/examenes/${card.examenId}/resultados`}
                aria-label={`Ver resultados de «${card.titulo}»`}
                className="text-small font-semibold text-unx-blue"
              >
                Ver resultados →
              </Link>
            </div>
          </Card>
        ))}
      </section>

      <section aria-labelledby="pendientes-participacion" className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="pendientes-participacion" className="text-h3 text-ink">
            Pendientes de participación
          </h2>
          {derivado.pendientes.length > 0 && derivado.examenVerTodos && (
            <Link
              data-ver-todos
              href={`/instructor/examenes/${derivado.examenVerTodos}/resultados`}
              className="text-small font-semibold text-unx-blue"
            >
              Ver todos
            </Link>
          )}
        </div>
        {filasPendientes.length === 0 && derivado.participacionesCargando ? (
          <p className="text-small text-muted">Cargando participación…</p>
        ) : filasPendientes.length === 0 &&
          !derivado.datosPendientesCompletos ? (
          // Sin filas visibles Y con datos incompletos, afirmar «Nadie
          // pendiente» sería un falso éxito (condición del GO).
          <p className="text-small text-muted">
            No puede confirmarse la participación: hay grupos sin datos (ver
            avisos).
          </p>
        ) : (
          <>
            <DataTable
              columns={COLUMNAS_PENDIENTES}
              rows={filasPendientes}
              emptyTitle="Nadie pendiente"
              emptyText="Todas tus alumnas ya enviaron su intento."
            />
            {derivado.participacionesCargando && (
              <p className="mt-2 text-caption text-muted">
                Cargando la participación de otros grupos…
              </p>
            )}
          </>
        )}
      </section>

      {seccionMaterial}
    </div>
  );
}
