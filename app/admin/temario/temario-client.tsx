"use client";

import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TemarioArbol, type AccionesTemario } from "./temario-arbol";
import {
  AgregarElementoModal,
  RenombrarModal,
} from "./temario-form-modal";
import {
  type FilaTemario,
  hermanosDe,
  nivelClave,
  nivelNombre,
} from "./tipos";

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "agregar" }
  | { tipo: "renombrar"; fila: FilaTemario }
  | { tipo: "desactivar"; fila: FilaTemario }
  | { tipo: "eliminar"; fila: FilaTemario };

/**
 * `/admin/temario` — el catálogo institucional de contenidos (LUI-18).
 *
 * Entrega 2: CRUD completo (crear, renombrar, reordenar, desactivar/reactivar,
 * eliminar). El read-path (`listarArbol`) quedó CONGELADO desde la Entrega 1: el
 * cliente decide qué acciones ofrecer desde la lista aplanada que ya recibe.
 *
 * ── Accesibilidad: NO `role="tree"`, y no es pereza ────────────────────────
 * Un `treeitem` es UN solo widget enfocable: el árbol entero tendría un único tab
 * stop, pero cada fila lleva 4-5 controles. El rol correcto sería `treegrid` con
 * roving tabindex bidimensional (↑↓ filas, ←→ celdas, Home/End, typeahead) — un
 * widget del que este repo no tiene precedente, y **un rol ARIA equivocado es peor
 * que ninguno**. Se usa lo que ES verdad: `<ul>`/`<li>` con `aria-level`. El
 * presupuesto de a11y se gasta donde de verdad falta: los nombres accesibles de los
 * controles y la **región viva** que anuncia el reordenamiento (cuyo único feedback
 * sería visual).
 */
export function TemarioClient() {
  const { isAuthenticated } = useConvexAuth();
  const filas = useQuery(api.temario.listarArbol, isAuthenticated ? {} : "skip");

  // `expansion` guarda SOLO las desviaciones del default (secciones abiertas,
  // áreas cerradas). El default es función pura de la fila → sin `useEffect` que
  // se desincronice en cada refetch, y un nodo nuevo hereda el default solo.
  const [expansion, setExpansion] = useState<Record<string, boolean>>({});
  const estaExpandido = (f: FilaTemario) => expansion[f.id] ?? f.nivel === 1;
  const alternar = (id: string) =>
    setExpansion((prev) => {
      const fila = filas?.find((f) => f.id === id);
      const actual = fila ? estaExpandido(fila) : false;
      return { ...prev, [id]: !actual };
    });

  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });
  const cerrar = () => setModal({ tipo: "cerrado" });
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");

  const cambiarEstado = useMutation(api.temario.cambiarEstado);
  const mover = useMutation(api.temario.mover);

  const acciones: AccionesTemario = {
    onRenombrar: (fila) => setModal({ tipo: "renombrar", fila }),
    onDesactivar: (fila) => setModal({ tipo: "desactivar", fila }),
    onEliminar: (fila) => setModal({ tipo: "eliminar", fila }),
    onReactivar: async (fila) => {
      setErrorAccion(null);
      try {
        await cambiarEstado({
          nivel: nivelClave(fila.nivel),
          id: fila.id,
          activo: true,
        });
      } catch (e) {
        setErrorAccion(mensajeDeError(e));
      }
    },
    onMover: async (fila, direccion) => {
      setErrorAccion(null);
      // La posición destino se computa ANTES de mover (la flecha ya está
      // deshabilitada en los extremos, así que el índice es válido).
      const hermanos = hermanosDe(filas ?? [], fila);
      const i = hermanos.findIndex((f) => f.id === fila.id);
      const destino = direccion === "arriba" ? i : i + 1; // 1-based tras el swap
      try {
        const res = await mover({
          nivel: nivelClave(fila.nivel),
          id: fila.id,
          direccion,
        });
        if (res.movido) {
          setAnuncio(
            `«${fila.nombre}» se movió a la posición ${destino} de ${hermanos.length}.`,
          );
        }
      } catch (e) {
        setErrorAccion(mensajeDeError(e));
      }
    },
  };

  return (
    <>
      <PageHeader
        title="Temario"
        description="Catálogo institucional de contenidos — alimenta la clasificación de reactivos y las secciones de los exámenes"
        action={
          filas && filas.length > 0 ? (
            <Button onClick={() => setModal({ tipo: "agregar" })}>
              <Plus className="size-[18px]" aria-hidden />
              Agregar sección o módulo
            </Button>
          ) : undefined
        }
      />

      {/* Región viva: el único feedback del reordenamiento es visual. */}
      <div aria-live="polite" className="sr-only">
        {anuncio}
      </div>

      {errorAccion && (
        <div className="mb-4">
          <Alert kind="error">{errorAccion}</Alert>
        </div>
      )}

      {filas === undefined ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando temario…
        </div>
      ) : filas.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center shadow-card">
          <p className="text-h3 text-ink">Aún no hay secciones</p>
          <p className="mx-auto mt-1 max-w-md text-small text-muted">
            El temario arranca con las secciones del núcleo del EXANI II. Crea la
            primera sección para empezar a clasificar reactivos.
          </p>
          <div className="mt-4">
            <Button onClick={() => setModal({ tipo: "agregar" })}>
              <Plus className="size-[18px]" aria-hidden />
              Agregar sección o módulo
            </Button>
          </div>
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
            acciones={acciones}
          />
          <p className="mt-3 text-small text-muted">
            Los elementos desactivados no se ofrecen para contenido nuevo, pero
            conservan sus reactivos. Un elemento con reactivos asociados solo se
            puede desactivar, no eliminar.
          </p>
        </section>
      )}

      {modal.tipo === "agregar" && (
        <AgregarElementoModal
          filas={filas ?? []}
          onClose={cerrar}
          onCreado={(parents) =>
            setExpansion((e) => {
              const next = { ...e };
              if (parents.seccionId) next[parents.seccionId] = true;
              if (parents.areaId) next[parents.areaId] = true;
              return next;
            })
          }
        />
      )}
      {modal.tipo === "renombrar" && (
        <RenombrarModal key={modal.fila.id} fila={modal.fila} onClose={cerrar} />
      )}
      {modal.tipo === "desactivar" && (
        <ConfirmarDesactivarModal fila={modal.fila} onClose={cerrar} />
      )}
      {modal.tipo === "eliminar" && (
        <ConfirmarEliminarModal
          fila={modal.fila}
          filas={filas ?? []}
          onClose={cerrar}
        />
      )}
    </>
  );
}

function ConfirmarDesactivarModal({
  fila,
  onClose,
}: {
  fila: FilaTemario;
  onClose: () => void;
}) {
  const cambiarEstado = useMutation(api.temario.cambiarEstado);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await cambiarEstado({
        nivel: nivelClave(fila.nivel),
        id: fila.id,
        activo: false,
      });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Desactivar ${nivelNombre(fila.nivel)} «${fila.nombre}»?`}
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
        <p>
          Dejará de ofrecerse para clasificar contenido nuevo, junto con todo lo que
          cuelga de él. Conserva sus reactivos y sus reportes históricos, y puedes
          reactivarlo cuando quieras.
        </p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function ConfirmarEliminarModal({
  fila,
  filas,
  onClose,
}: {
  fila: FilaTemario;
  filas: FilaTemario[];
  onClose: () => void;
}) {
  const eliminar = useMutation(api.temario.eliminar);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cuenta la estructura que se irá en cascada (todo garantizado sin reactivos).
  const descendientes = filas.filter(
    (f) =>
      (f.nivel === 2 && f.seccionId === fila.id) ||
      (f.nivel === 3 &&
        (f.seccionId === fila.id || f.areaId === fila.id)),
  );
  const nAreas = descendientes.filter((f) => f.nivel === 2).length;
  const nSubtemas = descendientes.filter((f) => f.nivel === 3).length;
  const partes = [
    nAreas > 0 ? `${nAreas} ${nAreas === 1 ? "área" : "áreas"}` : null,
    nSubtemas > 0
      ? `${nSubtemas} ${nSubtemas === 1 ? "subtema" : "subtemas"}`
      : null,
  ].filter(Boolean);

  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      await eliminar({ nivel: nivelClave(fila.nivel), id: fila.id });
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`¿Eliminar ${nivelNombre(fila.nivel)} «${fila.nombre}»?`}
      width={440}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmar} disabled={enviando}>
            {enviando ? "Eliminando…" : "Eliminar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p>
          {partes.length > 0
            ? `Se eliminarán también ${partes.join(" y ")}. Esta acción no se puede deshacer.`
            : "Esta acción no se puede deshacer."}
        </p>
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
