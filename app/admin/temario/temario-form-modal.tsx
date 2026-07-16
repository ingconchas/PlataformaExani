"use client";

import { type FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { type FilaTemario, nivelClave, nivelNombre } from "./tipos";

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

type TipoAlta = "nucleo" | "modulo" | "area" | "subtema";

const TIPOS: { value: TipoAlta; label: string }[] = [
  { value: "nucleo", label: "Sección de núcleo" },
  { value: "modulo", label: "Módulo" },
  { value: "area", label: "Área temática" },
  { value: "subtema", label: "Subtema" },
];

/**
 * Modal «Agregar elemento» — cubre los 4 casos con un selector de tipo primero
 * (el AC amplía el mock, que solo creaba áreas/subtemas). Envía **solo el padre
 * directo**: la sección de un subtema se deriva del área en el servidor, nunca
 * viaja la terna. Los selects de padre solo ofrecen elementos ACTIVOS —«los
 * desactivados no se ofrecen para contenido nuevo»— y el submit se bloquea (no
 * manda un id muerto) cuando no hay un padre válido.
 */
export function AgregarElementoModal({
  filas,
  onClose,
  onCreado,
}: {
  filas: FilaTemario[];
  onClose: () => void;
  /** Para auto-expandir los ancestros del nodo nuevo. */
  onCreado: (parents: { seccionId?: string; areaId?: string }) => void;
}) {
  const crear = useMutation(api.temario.crear);

  const [tipo, setTipo] = useState<TipoAlta>("nucleo");
  const [seccionId, setSeccionId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Solo padres ACTIVOS. Las secciones se listan en el orden del árbol (núcleo
  // antes que módulos), con sufijo «· módulo» porque el Select no tiene optgroup.
  const secciones = filas.filter((f) => f.nivel === 1 && f.activo);
  const opcionesSeccion = secciones.map((s) => ({
    value: s.id,
    label: s.nivel === 1 && s.tipo === "modulo" ? `${s.nombre} · módulo` : s.nombre,
  }));
  const areas = filas.filter(
    (f) => f.nivel === 2 && f.activo && f.seccionId === seccionId,
  );
  const opcionesArea = areas.map((a) => ({ value: a.id, label: a.nombre }));

  const necesitaSeccion = tipo === "area" || tipo === "subtema";
  const necesitaArea = tipo === "subtema";
  const seccionValida = opcionesSeccion.some((o) => o.value === seccionId);
  const areaValida = opcionesArea.some((o) => o.value === areaId);
  const seccionSinAreas = necesitaArea && seccionValida && opcionesArea.length === 0;

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Escribe el nombre.");
    if (necesitaSeccion && !seccionValida) {
      return setError(
        secciones.length === 0
          ? "Crea primero una sección activa donde colocarlo."
          : "Elige una sección.",
      );
    }
    if (necesitaArea && !areaValida) {
      return setError(
        seccionSinAreas
          ? "Esta sección aún no tiene áreas. Crea primero un área."
          : "Elige un área.",
      );
    }

    const parentId =
      tipo === "area" ? seccionId : tipo === "subtema" ? areaId : undefined;
    setEnviando(true);
    try {
      await crear({ tipo, nombre: nombre.trim(), parentId });
      // Auto-expandir: un subtema nace bajo un área que arranca colapsada.
      if (tipo === "area") onCreado({ seccionId });
      else if (tipo === "subtema") onCreado({ seccionId, areaId });
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title="Agregar elemento"
      width={480}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="temario-agregar" disabled={enviando}>
            {enviando ? "Agregando…" : "Agregar"}
          </Button>
        </>
      }
    >
      <form id="temario-agregar" className="grid gap-4" onSubmit={guardar}>
        <Select
          label="Tipo"
          options={TIPOS}
          value={tipo}
          onChange={(e) => {
            // `nombre` persiste; los ids se recalculan por relevancia.
            setTipo(e.target.value as TipoAlta);
            setError(null);
          }}
        />

        {necesitaSeccion &&
          (secciones.length === 0 ? (
            <Alert kind="warning">
              No hay secciones activas. Crea primero una sección o módulo.
            </Alert>
          ) : (
            <Select
              label="Sección"
              placeholder="Elige una sección"
              options={opcionesSeccion}
              value={seccionValida ? seccionId : ""}
              onChange={(e) => {
                setSeccionId(e.target.value);
                setAreaId(""); // el área deja de ser válida al cambiar de sección
              }}
            />
          ))}

        {necesitaArea && seccionValida && (
          <Select
            label="Área temática"
            placeholder={
              seccionSinAreas ? "Esta sección aún no tiene áreas" : "Elige un área"
            }
            options={opcionesArea}
            value={areaValida ? areaId : ""}
            onChange={(e) => setAreaId(e.target.value)}
            disabled={seccionSinAreas}
          />
        )}

        <div>
          <Label htmlFor="temario-nombre">Nombre</Label>
          <Input
            id="temario-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Desigualdades"
            autoComplete="off"
          />
        </div>

        {error && <Alert kind="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

/** Modal «Renombrar» — un solo Input pre-cargado. */
export function RenombrarModal({
  fila,
  onClose,
}: {
  fila: FilaTemario;
  onClose: () => void;
}) {
  const renombrar = useMutation(api.temario.renombrar);
  const [nombre, setNombre] = useState(fila.nombre);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Escribe el nombre.");
    setEnviando(true);
    try {
      await renombrar({
        nivel: nivelClave(fila.nivel),
        id: fila.id,
        nombre: nombre.trim(),
      });
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`Renombrar ${nivelNombre(fila.nivel)}`}
      width={440}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="temario-renombrar" disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <form id="temario-renombrar" onSubmit={guardar} className="grid gap-3">
        <div>
          <Label htmlFor="temario-renombrar-nombre">Nombre</Label>
          <Input
            id="temario-renombrar-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error && <Alert kind="error">{error}</Alert>}
      </form>
    </Modal>
  );
}
