"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { ClipboardCheck, User, UsersRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MetricCard } from "@/components/ui/metric-card";
import { ShortcutCard } from "@/components/ui/shortcut-card";
import { adminShortcuts } from "@/lib/nav";

const COLUMNAS: DataTableColumn[] = [
  { key: "examen", label: "Examen" },
  { key: "grupo", label: "Grupo" },
  { key: "fecha", label: "Fecha" },
  { key: "puntaje", label: "Puntaje promedio", align: "right" },
];

/** Puntaje EXANI en escala 700–1300: protagonista, en cifras condensadas. `null`
 *  → «—» (aún sin intentos calificados). Nunca 0: sería imposible en la escala. */
function CeldaPuntaje({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted">—</span>;
  return (
    <span className="font-condensed text-[20px] font-semibold tabular-nums text-unx-blue">
      {valor}
    </span>
  );
}

export function InicioClient() {
  const { isAuthenticated } = useConvexAuth();
  // `skip` mientras no hay sesión: evita el parpadeo del error de `requireAdmin`
  // durante la hidratación (mismo patrón que los demás clientes de /admin).
  const panel = useQuery(api.panel.resumen, isAuthenticated ? {} : "skip");

  const filas = (panel?.ultimosExamenes ?? []).map((e) => ({
    id: e.id,
    examen: <span className="font-semibold text-ink">{e.examen}</span>,
    grupo: e.grupo,
    fecha: <span className="text-muted">{e.fecha}</span>,
    puntaje: <CeldaPuntaje valor={e.puntajePromedio} />,
  }));

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
          value={panel?.metricas.gruposActivos ?? "—"}
          label="Grupos activos"
          tone="blue"
          icon={<UsersRound className="size-[22px]" aria-hidden />}
        />
        <MetricCard
          value={panel?.metricas.alumnosRegistrados ?? "—"}
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
          <DataTable
            columns={COLUMNAS}
            rows={filas}
            emptyTitle="Todavía no hay exámenes aplicados"
            emptyText="Cuando un examen se asigne a un grupo y su ventana abra, aparecerá aquí."
          />
        )}
      </section>
    </>
  );
}
