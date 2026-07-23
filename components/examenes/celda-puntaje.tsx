/**
 * Celda del PROMEDIO en escala 700–1300 (LUI-30), compartida por el panel del admin
 * (`app/admin/inicio-client.tsx`) y el Resumen de exámenes (LUI-32). Se extrajo 1:1 al nacer
 * su segundo consumidor: una sola definición ⇒ los cinco estados no pueden discrepar entre
 * las dos pantallas.
 *
 * El promedio llega por `useQueries` (una query por fila), así que su estado es el contrato
 * de CUATRO miembros `resultado | null | undefined | Error`, que aquí produce CINCO estados
 * visuales: «…» = cargando; la cifra; «—» = sin intentos calificados; **«Datos incompletos»**
 * = el servidor no promedió (más intentos de los que el presupuesto permite leer, o un
 * problema de la fila) — pintar el prefijo daría una cifra precisa y falsa; y «Error» si la
 * query falló o la fila desapareció. Nunca 0: sería imposible en la escala.
 */
export type EstadoPromedio =
  | { valor: number | null; incompleto: boolean }
  | null
  | undefined
  | Error;

export function CeldaPuntaje({ estado }: { estado: EstadoPromedio }) {
  if (estado === undefined) return <span className="text-muted">…</span>;
  if (estado instanceof Error || estado === null)
    return (
      <span
        className="text-small text-muted"
        title="No se pudo cargar el promedio de este examen."
      >
        Error
      </span>
    );
  if (estado.incompleto)
    return (
      <span
        className="text-small text-muted"
        title="Este examen tiene demasiados intentos para calcular el promedio aquí."
      >
        Datos incompletos
      </span>
    );
  if (estado.valor === null) return <span className="text-muted">—</span>;
  return (
    <span className="font-condensed text-[20px] font-semibold tabular-nums text-unx-blue">
      {estado.valor}
    </span>
  );
}
