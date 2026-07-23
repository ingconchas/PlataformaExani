"use client";

import { useMemo } from "react";
import {
  useConvexAuth,
  useQueries,
  useQuery,
  type RequestForQueries,
} from "convex/react";
import { ClipboardCheck, User, UsersRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MetricCard } from "@/components/ui/metric-card";
import { ShortcutCard } from "@/components/ui/shortcut-card";
import {
  CeldaPuntaje,
  type EstadoPromedio,
} from "@/components/examenes/celda-puntaje";
import { adminShortcuts } from "@/lib/nav";
import { MAX_APLICADAS_MES_PANEL, SCAN_ULTIMOS_PANEL } from "@/convex/metricas";

const COLUMNAS: DataTableColumn[] = [
  { key: "examen", label: "Examen" },
  { key: "grupo", label: "Grupo" },
  { key: "fecha", label: "Fecha" },
  { key: "puntaje", label: "Puntaje promedio", align: "right" },
];

export function InicioClient() {
  const { isAuthenticated } = useConvexAuth();
  // `skip` mientras no hay sesión: evita el parpadeo del error de `requireAdmin`
  // durante la hidratación (mismo patrón que los demás clientes de /admin).
  //
  // CUATRO queries, no una (LUI-30, patrón LUI-19): `resumen` (encabezado + métrica del
  // mes + últimos aplicados), `grupos` y `alumnos` (cada conteo con su propio paginate
  // byte-capped) y un `promedioDe` POR FILA de la tabla (mapa dinámico de `useQueries`).
  const panel = useQuery(api.panel.resumen, isAuthenticated ? {} : "skip");
  const grupos = useQuery(api.panel.grupos, isAuthenticated ? {} : "skip");
  const alumnos = useQuery(api.panel.alumnos, isAuthenticated ? {} : "skip");

  const peticiones = useMemo(() => {
    const r: RequestForQueries = {};
    for (const e of panel?.ultimosExamenes ?? []) {
      r[e.id] = { query: api.panel.promedioDe, args: { asignacionId: e.id } };
    }
    return r;
  }, [panel?.ultimosExamenes]);
  const promedios = useQueries(peticiones);

  const filas = (panel?.ultimosExamenes ?? []).map((e) => ({
    id: e.id,
    examen: <span className="font-semibold text-ink">{e.examen}</span>,
    grupo: e.grupo,
    fecha: <span className="text-muted">{e.fecha}</span>,
    puntaje: <CeldaPuntaje estado={promedios[e.id] as EstadoPromedio} />,
  }));

  // Flags de incompletitud HONESTOS (LUI-30): cada «—» de abajo lleva su explicación
  // visible — un conteo cortado JAMÁS se pinta como cifra exacta.
  const conteosIncompletos =
    grupos?.incompleto === true || alumnos?.incompleto === true;
  const mesIncompleto = panel?.metricas.aplicadasMesIncompleto === true;

  return (
    <>
      {/* El saludo y la fecha vienen del servidor: la zona (America/Mexico_City)
          es regla del PRD, no preferencia del dispositivo. Mientras carga se
          muestra «Hola» a secas en vez de un esqueleto — el encabezado no es la
          parte accionable de la pantalla. */}
      <PageHeader
        title={panel ? `Hola, ${panel.nombre}` : "Hola"}
        description={panel?.fechaLarga}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          value={grupos?.gruposActivos ?? "—"}
          label="Grupos activos"
          tone="blue"
          icon={<UsersRound className="size-[22px]" aria-hidden />}
        />
        <MetricCard
          value={alumnos?.alumnosRegistrados ?? "—"}
          label="Alumnos registrados"
          tone="green"
          icon={<User className="size-[22px]" aria-hidden />}
        />
        <MetricCard
          value={panel?.metricas.examenesAplicadosMes ?? "—"}
          label="Exámenes aplicados este mes"
          tone="yellow"
          icon={<ClipboardCheck className="size-[22px]" aria-hidden />}
        />
      </div>

      {conteosIncompletos && (
        <div className="mt-3">
          <Alert kind="warning">
            Hay demasiados registros para contarlos aquí; las cifras marcadas
            con «—» no están disponibles.
          </Alert>
        </div>
      )}
      {mesIncompleto && (
        <div className="mt-3">
          <Alert kind="warning">
            El conteo del mes superó el límite ({MAX_APLICADAS_MES_PANEL}); la
            cifra exacta no está disponible.
          </Alert>
        </div>
      )}

      {/* `aria-labelledby` convierte esto en un landmark con nombre accesible:
          el lector de pantalla puede saltar a «Accesos directos», y la prueba E2E
          puede acotar su conteo de enlaces a esta región (el sidebar también
          renderiza enlaces, así que un conteo global nunca daría 5). */}
      <section aria-labelledby="accesos-directos" className="mt-8">
        <h2 id="accesos-directos" className="mb-3 text-h3 text-ink">
          Accesos directos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {adminShortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <ShortcutCard
                key={s.href}
                title={s.label}
                description={s.description}
                href={s.href}
                tone={s.tone}
                icon={<Icon className="size-[22px]" aria-hidden />}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="ultimos-examenes" className="mt-8">
        <h2 id="ultimos-examenes" className="mb-3 text-h3 text-ink">
          Últimos exámenes aplicados
        </h2>
        {panel === undefined ? (
          <p className="text-small text-muted">Cargando exámenes…</p>
        ) : (
          <>
            <DataTable
              columns={COLUMNAS}
              rows={filas}
              emptyTitle="Todavía no hay exámenes aplicados"
              emptyText="Los exámenes aparecen aquí cuando reciben su primer envío."
            />
            {panel.ultimosIncompletos && (
              <p className="mt-2 text-small text-muted">
                Se revisaron las {SCAN_ULTIMOS_PANEL} aplicaciones más
                recientes; puede haber anteriores sin listar.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
