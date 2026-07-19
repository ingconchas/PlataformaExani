"use client";

import { type FunctionReturnType } from "convex/server";
import { type api } from "@/convex/_generated/api";
import { Select } from "@/components/ui/select";

export type FilaTemario = FunctionReturnType<
  typeof api.temario.listarParaStaff
>[number];

/**
 * Cascada Sección → Área → Subtema. La comparten el formulario de reactivo (LUI-15/16) y el
 * de lectura (LUI-17).
 *
 * ⚠️ La regla que hace que esto merezca ser UN solo componente está en `opcionesDe`: se
 * ofrecen **solo los nodos `disponible`, MÁS el actualmente seleccionado aunque esté
 * retirado**, etiquetado «(retirado)». Sin esa excepción, abrir contenido histórico mostraría
 * su clasificación vacía y guardarlo la perdería. Duplicar una regla así es exactamente como
 * se desvía.
 *
 * El servidor NUNCA acepta la terna: las mutations reciben solo `subtemaId` y derivan el
 * resto con `temario.resolverClasificacion`.
 */
export function SelectorClasificacion({
  temario,
  seccionId,
  areaId,
  subtemaId,
  disabled,
  onChange,
}: {
  temario: FilaTemario[];
  seccionId: string;
  areaId: string;
  subtemaId: string;
  disabled: boolean;
  /** Recibe la terna completa ya consistente: cambiar un nivel LIMPIA los inferiores. */
  onChange: (v: { seccionId: string; areaId: string; subtemaId: string }) => void;
}) {
  const secciones = temario.filter((f) => f.nivel === 1);
  const areas = temario.filter(
    (f): f is Extract<FilaTemario, { nivel: 2 }> => f.nivel === 2,
  );
  const subtemas = temario.filter(
    (f): f is Extract<FilaTemario, { nivel: 3 }> => f.nivel === 3,
  );
  const opcionesDe = (
    nodos: { id: string; nombre: string; disponible: boolean }[],
    actualId: string,
  ) =>
    nodos
      .filter((n) => n.disponible || n.id === actualId)
      .map((n) => ({
        value: n.id,
        label: n.disponible ? n.nombre : `${n.nombre} (retirado)`,
      }));

  const opcSeccion = [
    { value: "", label: "Elige una sección" },
    ...opcionesDe(secciones, seccionId),
  ];
  const opcArea = seccionId
    ? [
        { value: "", label: "Elige un área" },
        ...opcionesDe(
          areas.filter((a) => a.seccionId === seccionId),
          areaId,
        ),
      ]
    : [{ value: "", label: "Elige una sección primero" }];
  const opcSubtema = areaId
    ? [
        { value: "", label: "Elige un subtema" },
        ...opcionesDe(
          subtemas.filter((s) => s.areaId === areaId),
          subtemaId,
        ),
      ]
    : [{ value: "", label: "Elige un área primero" }];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Select
        label="Sección"
        options={opcSeccion}
        value={seccionId}
        disabled={disabled}
        onChange={(e) =>
          onChange({ seccionId: e.target.value, areaId: "", subtemaId: "" })
        }
      />
      <Select
        label="Área temática"
        options={opcArea}
        value={areaId}
        disabled={disabled || !seccionId}
        onChange={(e) =>
          onChange({ seccionId, areaId: e.target.value, subtemaId: "" })
        }
      />
      <Select
        label="Subtema"
        options={opcSubtema}
        value={subtemaId}
        disabled={disabled || !areaId}
        onChange={(e) => onChange({ seccionId, areaId, subtemaId: e.target.value })}
      />
    </div>
  );
}
