"use client";

import { type FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  MultiSelect,
  type MultiSelectOption,
} from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";

type Turno = "matutino" | "vespertino" | "sabatino";

/** Datos mínimos que el formulario necesita para editar (los cubre una fila de
 *  `listarGestion` o el detalle de `obtener`). */
export type GrupoEditable = {
  id: Id<"grupos">;
  nombre: string;
  ciclo: string | null;
  turno: Turno | null;
  instructores: {
    id: Id<"users">;
    nombre: string;
    materia: string | null;
    activo: boolean;
  }[];
};

const TURNOS: { value: Turno; label: string }[] = [
  { value: "matutino", label: "Matutino" },
  { value: "vespertino", label: "Vespertino" },
  { value: "sabatino", label: "Sabatino" },
];

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

export function GrupoFormModal({
  grupo,
  instructores,
  onClose,
}: {
  grupo: GrupoEditable | null;
  instructores: MultiSelectOption[];
  onClose: () => void;
}) {
  const crear = useMutation(api.grupos.crear);
  const actualizar = useMutation(api.grupos.actualizar);
  const esEdicion = grupo !== null;

  const [nombre, setNombre] = useState(grupo?.nombre ?? "");
  const [ciclo, setCiclo] = useState(grupo?.ciclo ?? "");
  const [turno, setTurno] = useState<string>(grupo?.turno ?? "");
  const [instructorIds, setInstructorIds] = useState<string[]>(
    grupo?.instructores.map((i) => i.id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Opciones = instructores activos (prop) ∪ los ya asignados que estén
  // inactivos, marcados «(inactivo)», para conservarlos al editar (política
  // tolerante LUI-13).
  const idsActivos = new Set(instructores.map((o) => o.value));
  const opcionesInstructores = [
    ...instructores,
    ...(grupo?.instructores ?? [])
      .filter((i) => !i.activo && !idsActivos.has(i.id))
      .map((i) => ({
        value: i.id,
        label: `${i.materia ? `${i.nombre} — ${i.materia}` : i.nombre} (inactivo)`,
      })),
  ];

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Escribe el nombre del grupo.");
    if (!ciclo.trim()) return setError("Escribe el ciclo (por ejemplo, 2026-B).");
    if (!turno) return setError("Elige un turno.");
    if (instructorIds.length === 0)
      return setError("Asigna al menos un instructor.");

    const datos = {
      nombre: nombre.trim(),
      ciclo: ciclo.trim(),
      turno: turno as Turno,
      instructorIds: instructorIds as Id<"users">[],
    };
    setEnviando(true);
    try {
      if (grupo) await actualizar({ grupoId: grupo.id, ...datos });
      else await crear(datos);
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={esEdicion ? "Editar grupo" : "Crear grupo"}
      width={520}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="grupo-form" disabled={enviando}>
            {enviando
              ? "Guardando…"
              : esEdicion
                ? "Guardar cambios"
                : "Crear grupo"}
          </Button>
        </>
      }
    >
      <form id="grupo-form" className="grid gap-4" onSubmit={guardar}>
        <div>
          <Label htmlFor="grupo-nombre">Nombre del grupo</Label>
          <Input
            id="grupo-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Matutino C"
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="grupo-ciclo">Ciclo</Label>
            <Input
              id="grupo-ciclo"
              value={ciclo}
              onChange={(e) => setCiclo(e.target.value)}
              placeholder="2026-B"
              autoComplete="off"
            />
          </div>
          <Select
            label="Turno"
            placeholder="Elige un turno"
            options={TURNOS}
            value={turno}
            onChange={(e) => setTurno(e.target.value)}
          />
        </div>
        <div>
          <MultiSelect
            label="Instructores"
            placeholder="Elige instructores"
            options={opcionesInstructores}
            value={instructorIds}
            onChange={setInstructorIds}
          />
          <p className="mt-1.5 text-caption text-muted">
            Puedes asignar varios instructores, uno por materia.
          </p>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
      </form>
    </Modal>
  );
}
