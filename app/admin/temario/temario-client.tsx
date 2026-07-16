"use client";

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { TemarioArbol } from "./temario-arbol";
import { type FilaTemario } from "./tipos";

/**
 * `/admin/temario` — el catálogo institucional de contenidos (LUI-18, Entrega 1).
 *
 * Esta entrega es de **solo lectura**: el árbol, los contadores, el badge y el
 * separador MÓDULOS. El CRUD es la Entrega 2, y no se renderizan botones que no
 * hagan nada — un árbol con acciones muertas sería el peor artefacto posible para
 * quien lo revise y para Mayra.
 *
 * ── Accesibilidad: NO `role="tree"`, y no es pereza ────────────────────────
 * Un `treeitem` es UN solo widget enfocable: el árbol entero tendría un único tab
 * stop. Cuando la Entrega 2 meta 2-5 controles por fila, el rol correcto pasaría a
 * ser `treegrid`, con roving tabindex bidimensional (↑↓ filas, ←→ celdas,
 * Home/End, typeahead) — un widget genuinamente difícil del que este repo no tiene
 * un solo precedente. Y **un rol ARIA equivocado es peor que ninguno**: el lector
 * anuncia «árbol», la usuaria cambia de modelo de interacción, y el contrato de
 * teclado no responde. Eso es una regresión, no una mejora.
 *
 * Así que se usa lo que ES verdad: `<ul>`/`<li>` reales con `aria-level`. El
 * presupuesto de accesibilidad se gasta donde de verdad falta (los nombres
 * accesibles de los controles y, en la Entrega 2, una región viva que anuncie el
 * reordenamiento, cuyo único feedback hoy sería visual).
 */
export function TemarioClient() {
  // Dispara la query solo con la sesión resuelta (evita un parpadeo de error por
  // el gate de authz durante la hidratación).
  const { isAuthenticated } = useConvexAuth();
  const filas = useQuery(api.temario.listarArbol, isAuthenticated ? {} : "skip");

  // `expansion` guarda SOLO las desviaciones del default, y el default es una
  // función pura de la fila. Así no hace falta un `useEffect` que siembre el
  // estado cuando la query resuelve (no conoces los ids hasta entonces) ni
  // resincronizarlo en cada refetch, y un nodo nuevo hereda el default solo.
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  // Secciones abiertas, áreas cerradas: un temario real ronda 150-250 filas
  // expandido del todo (un muro), y todo colapsado esconde justo lo que hace de
  // esto un árbol. Así el primer pintado muestra la forma del catálogo.
  const estaExpandido = (f: FilaTemario) => expansion[f.id] ?? f.nivel === 1;
  const alternar = (id: string) =>
    setExpansion((prev) => {
      const fila = filas?.find((f) => f.id === id);
      const actual = fila ? estaExpandido(fila) : false;
      return { ...prev, [id]: !actual };
    });

  return (
    <>
      <PageHeader
        title="Temario"
        description="Catálogo institucional de contenidos — alimenta la clasificación de reactivos y las secciones de los exámenes"
      />

      {filas === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando temario…
        </div>
      ) : filas.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center shadow-card">
          <p className="text-h3 text-ink">Aún no hay secciones</p>
          <p className="mt-1 text-small text-muted">
            El temario arranca con las secciones del núcleo del EXANI II. Si esta
            pantalla está vacía, falta sembrarlas.
          </p>
        </div>
      ) : (
        <section aria-labelledby="arbol-temario">
          <h2 id="arbol-temario" className="sr-only">
            Árbol del temario
          </h2>
          <TemarioArbol
            filas={filas}
            estaExpandido={estaExpandido}
            onAlternar={alternar}
          />
          <p className="mt-3 text-small text-muted">
            Los elementos desactivados no se ofrecen para contenido nuevo, pero
            conservan sus reactivos. Un elemento con reactivos asociados solo se
            puede desactivar, no eliminar.
          </p>
        </section>
      )}
    </>
  );
}
