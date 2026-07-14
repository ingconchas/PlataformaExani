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
import { RadioGroup } from "@/components/ui/radio";

type Rol = "admin" | "instructor";

export type GrupoOpcion = {
  id: Id<"grupos">;
  nombre: string;
  ciclo: string | null;
};

export type UsuarioEditable = {
  id: Id<"perfiles">;
  nombre: string;
  correo: string;
  rol: Rol;
  materia: string | null;
  grupos: {
    id: Id<"grupos">;
    nombre: string;
    ciclo: string | null;
    activo: boolean;
  }[];
};

const ROLES = [
  { value: "instructor", label: "Instructor" },
  { value: "admin", label: "Administrador" },
];

function etiquetaGrupo(nombre: string, ciclo: string | null): string {
  return ciclo ? `${nombre} · ${ciclo}` : nombre;
}

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

export function UsuarioFormModal({
  usuario,
  grupos,
  onClose,
}: {
  usuario: UsuarioEditable | null;
  grupos: GrupoOpcion[];
  onClose: () => void;
}) {
  const crear = useMutation(api.usuarios.crear);
  const actualizar = useMutation(api.usuarios.actualizar);
  const esEdicion = usuario !== null;

  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [correo, setCorreo] = useState(usuario?.correo ?? "");
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? "instructor");
  const [materia, setMateria] = useState(usuario?.materia ?? "");
  const [grupoIds, setGrupoIds] = useState<string[]>(
    usuario?.grupos.map((g) => g.id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Opciones de grupo desambiguadas «nombre · ciclo»; + grupos cerrados ya
  // asignados marcados «(cerrado)» (política tolerante LUI-13).
  const idsActivos = new Set(grupos.map((g) => g.id as string));
  const opcionesGrupo: MultiSelectOption[] = [
    ...grupos.map((g) => ({
      value: g.id,
      label: etiquetaGrupo(g.nombre, g.ciclo),
    })),
    ...(usuario?.grupos ?? [])
      .filter((g) => !g.activo && !idsActivos.has(g.id))
      .map((g) => ({
        value: g.id,
        label: `${etiquetaGrupo(g.nombre, g.ciclo)} (cerrado)`,
      })),
  ];

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return setError("Escribe el nombre completo.");
    if (!correo.trim()) return setError("Escribe el correo electrónico.");

    const [primero, ...resto] = nombreLimpio.split(/\s+/);
    const esInstructor = rol === "instructor";
    const base = {
      nombre: primero,
      apellidos: resto.join(" ") || undefined,
      materia: esInstructor ? materia.trim() || undefined : undefined,
      grupoIds: esInstructor ? (grupoIds as Id<"grupos">[]) : undefined,
    };
    setEnviando(true);
    try {
      if (usuario) await actualizar({ perfilId: usuario.id, correo, ...base });
      else await crear({ correo, rol, ...base });
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={esEdicion ? "Editar cuenta" : "Crear cuenta"}
      width={520}
      onClose={enviando ? undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form="usuario-form" disabled={enviando}>
            {enviando
              ? "Guardando…"
              : esEdicion
                ? "Guardar cambios"
                : "Crear cuenta"}
          </Button>
        </>
      }
    >
      <form id="usuario-form" className="grid gap-4" onSubmit={guardar}>
        <div>
          <Label htmlFor="usuario-nombre">Nombre completo</Label>
          <Input
            id="usuario-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Laura Ibarra Fuentes"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="usuario-correo">Correo electrónico</Label>
          <Input
            id="usuario-correo"
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="laura.ibarra@institucion.edu.mx"
            autoComplete="off"
          />
        </div>
        <RadioGroup
          name="rol"
          label="Rol"
          options={ROLES}
          value={rol}
          onChange={(v) => setRol(v as Rol)}
          disabled={esEdicion}
        />
        {rol === "instructor" && (
          <>
            <div>
              <Label htmlFor="usuario-materia">Materia (opcional)</Label>
              <Input
                id="usuario-materia"
                value={materia}
                onChange={(e) => setMateria(e.target.value)}
                placeholder="Matemáticas"
                autoComplete="off"
              />
            </div>
            <MultiSelect
              label="Grupos con acceso"
              placeholder="Elige grupos"
              options={opcionesGrupo}
              value={grupoIds}
              onChange={setGrupoIds}
            />
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        {!esEdicion && (
          <Alert kind="info">
            La cuenta queda registrada sin acceso todavía; el correo de invitación
            para crear la contraseña se habilitará más adelante (LUI-103).
          </Alert>
        )}
      </form>
    </Modal>
  );
}
