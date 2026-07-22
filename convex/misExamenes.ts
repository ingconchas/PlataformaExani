import { type GenericId } from "convex/values";
import { estadoDeVentana } from "./examenEstado";
import { siguienteMedianocheMx } from "./fechas";
import { redondearPuntaje } from "./simulacro";

/**
 * «MIS EXÁMENES» de la alumna (LUI-25), en un módulo PURO.
 *
 * Misma razón de existir que `participacion.ts`: la derivación la comparten el CLIENTE (que
 * la ejecuta con su reloj anclado) y las pruebas (`scripts/test-mis-examenes.ts`), y el
 * SERVIDOR no la ejecuta — `player.misExamenes` entrega fronteras CRUDAS y datos de intento
 * SIN estados de reloj estampados, porque una query de Convex no se re-invalida por el paso
 * del tiempo (contrato de `examenEstado.estadoDeVentana`).
 *
 * Consecuencia buscada: una asignación futura APARECE sola al cruzar `abreEn`, una abierta
 * pasa a vencida al cruzar `cierraEn` y la urgencia «¡Cierra hoy!» se enciende al cruzar la
 * medianoche MX — todo sin re-query, porque `fronteras` alimenta el timer del cliente.
 */

export type AsignacionId = GenericId<"asignaciones">;
export type ExamenId = GenericId<"examenes">;
export type IntentoId = GenericId<"intentos">;

// ─────────────────────────────────────────────────────────────────────────────
// La entrada CRUDA (lo que devuelve `player.misExamenes`)
// ─────────────────────────────────────────────────────────────────────────────

/** Un intento ENVIADO, tal como lo entrega la sonda del servidor. */
export type EnviadoCrudo = {
  intentoId: IntentoId;
  enviadoEn: number | null;
  puntaje: number | null;
  numeroIntento: number | null;
};

/**
 * Una asignación que alcanza a la alumna, con el resultado de sus DOS sondas acotadas.
 *
 * `enviados` trae a lo más DOS filas por contrato del servidor (`take(2)` sobre
 * `intentos.by_asignacion_alumno_estado`): la primera en orden de creación ES el
 * diagnóstico —`numeroIntento === 1`, por el invariante de `iniciarIntento`— y la
 * existencia de la segunda demuestra que hubo al menos un repaso. No se cuenta el total:
 * un conteo exacto exigiría leer la serie completa, y lo único que la pantalla necesita es
 * «¿hubo repaso?». Por eso el badge dice «Repaso realizado» sin número.
 */
export type FilaCruda = {
  asignacionId: AsignacionId;
  examenId: ExamenId;
  titulo: string;
  numReactivos: number;
  duracionMin: number;
  tipoEtiqueta: string;
  esModulo: boolean;
  abreEn: number;
  cierraEn: number;
  enviados: readonly EnviadoCrudo[];
  enCurso: { intentoId: IntentoId; iniciadoEn: number } | null;
};

/** El payload de `player.misExamenes` sin el ancla (que el cliente consume aparte). */
export type MisExamenesCrudo = {
  filas: readonly FilaCruda[];
  historialGrupoIncompleto: boolean;
  directasIncompletas: boolean;
  asignacionesLegadasOmitidas: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lo derivado (lo que pinta la pantalla)
// ─────────────────────────────────────────────────────────────────────────────

export type CardPendiente = {
  asignacionId: AsignacionId;
  titulo: string;
  tipoEtiqueta: string;
  esModulo: boolean;
  numReactivos: number;
  duracionMin: number;
  cierraEn: number;
  /** Cierra ANTES de la próxima medianoche MX → deadline en naranja. */
  urgente: boolean;
  /** Intento vivo que reanudar: la card muestra «En curso» + «Continuar». */
  enCurso: IntentoId | null;
};

export type CardCompletado = {
  asignacionId: AsignacionId;
  titulo: string;
  /** Del DIAGNÓSTICO (intento 1), ya redondeado: el resultado oficial de LUI-104. */
  puntaje: number | null;
  contestadoEn: number | null;
  intentoId: IntentoId;
  ventanaAbierta: boolean;
  cierraEn: number;
  tieneRepaso: boolean;
  /**
   * Repaso VIVO (M2 de la auditoría v3): mientras exista, la card muestra «Repaso en curso»
   * + «Continuar» y OCULTA «Repetir como repaso». Esconder un intento cuyo reloj corre —o
   * invitar a empezar otro que la mutation acabaría reanudando— es exactamente la mentira
   * que este campo elimina.
   */
  repasoEnCurso: IntentoId | null;
};

export type CardVencido = {
  asignacionId: AsignacionId;
  titulo: string;
  cierraEn: number;
};

export type DerivadoMisExamenes = {
  pendientes: CardPendiente[];
  completados: CardCompletado[];
  vencidos: CardVencido[];
  /** Instantes FUTUROS en que algo de lo derivado cambia: el timer anclado del cliente
   *  despierta ahí y solo ahí. */
  fronteras: number[];
  /** Hay asignaciones que aún no abren. Apaga el vacío EXITOSO: «no tienes simulacros
   *  asignados» sería falso cuando sí los tiene, solo que todavía no empiezan. */
  hayFuturas: boolean;
  /** Alguna cota del servidor recortó la lectura: la pantalla lo dice y nunca muestra el
   *  vacío exitoso. */
  incompleto: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Derivación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿La ventana cierra HOY (hora del centro de México)? Frontera EXCLUSIVA: un cierre
 * exactamente en la medianoche pertenece al día siguiente —el intervalo es semiabierto, así
 * que a las 00:00 ya está cerrada— y la etiqueta «¡Cierra hoy a las 00:00!» sería absurda.
 * Un cierre ya pasado no es urgente: es historia.
 */
export function esCierraHoy(cierraEn: number, ahora: number): boolean {
  return cierraEn > ahora && cierraEn < siguienteMedianocheMx(ahora);
}

/** Título del resultado de un repaso (LUI-104): «Simulacro General 2 — repaso 2». El
 *  diagnóstico no lleva sufijo. */
export function etiquetaResultado(
  titulo: string,
  numeroIntento: number | null,
): string {
  return numeroIntento !== null && numeroIntento > 1
    ? `${titulo} — repaso ${numeroIntento}`
    : titulo;
}

const porTexto = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * Clasifica y ordena las filas crudas contra un `ahora` dado.
 *
 * Reglas (LUI-25):
 *  · **Pendiente** = ventana ABIERTA sin ningún envío. Con intento vivo se ofrece
 *    «Continuar»; sin él, «Comenzar».
 *  · **Completado** = ∃ envío, esté la ventana abierta o cerrada. El puntaje y la fecha son
 *    los del DIAGNÓSTICO (intento 1) — los repasos jamás cambian el resultado oficial.
 *  · **Vencido** = ventana CERRADA sin envío. No accionable. Un `en_curso` que quedó sin
 *    enviar cae aquí: con el recorte del límite al cierre de la ventana (`simulacro.limiteDe`)
 *    ese intento YA venció, y su cierre durable lo entregará; ofrecer «Continuar» sobre él
 *    sería invitar a una pantalla que solo puede decir «se acabó el tiempo».
 *  · **Futura** (`abreEn > ahora`) = no se lista, pero enciende `hayFuturas` y aporta su
 *    frontera: la card aparece sola al cruzar la apertura.
 *
 * Todos los órdenes son TOTALES (desempate final por id): sin eso, dos filas equivalentes
 * podrían intercambiarse entre renders y el E2E compararía contra un orden inestable.
 */
export function derivarMisExamenes(
  crudo: MisExamenesCrudo,
  ahora: number,
): DerivadoMisExamenes {
  const pendientes: CardPendiente[] = [];
  const completados: CardCompletado[] = [];
  const vencidos: CardVencido[] = [];
  const fronteras: number[] = [siguienteMedianocheMx(ahora)];
  let hayFuturas = false;

  for (const f of crudo.filas) {
    const estado = estadoDeVentana(f.abreEn, f.cierraEn, ahora);
    if (f.abreEn > ahora) fronteras.push(f.abreEn);
    if (f.cierraEn > ahora) fronteras.push(f.cierraEn);

    if (estado === "programada") {
      hayFuturas = true;
      continue;
    }

    const diagnostico = f.enviados[0] ?? null;
    if (diagnostico) {
      completados.push({
        asignacionId: f.asignacionId,
        titulo: f.titulo,
        puntaje:
          diagnostico.puntaje === null
            ? null
            : redondearPuntaje(diagnostico.puntaje),
        contestadoEn: diagnostico.enviadoEn,
        intentoId: diagnostico.intentoId,
        ventanaAbierta: estado === "abierta",
        cierraEn: f.cierraEn,
        tieneRepaso: f.enviados.length > 1,
        repasoEnCurso:
          estado === "abierta" && f.enCurso ? f.enCurso.intentoId : null,
      });
      continue;
    }

    if (estado === "abierta") {
      pendientes.push({
        asignacionId: f.asignacionId,
        titulo: f.titulo,
        tipoEtiqueta: f.tipoEtiqueta,
        esModulo: f.esModulo,
        numReactivos: f.numReactivos,
        duracionMin: f.duracionMin,
        cierraEn: f.cierraEn,
        urgente: esCierraHoy(f.cierraEn, ahora),
        enCurso: f.enCurso ? f.enCurso.intentoId : null,
      });
      continue;
    }

    vencidos.push({
      asignacionId: f.asignacionId,
      titulo: f.titulo,
      cierraEn: f.cierraEn,
    });
  }

  // Los que cierran antes, arriba (criterio de aceptación de LUI-25).
  pendientes.sort(
    (a, b) =>
      a.cierraEn - b.cierraEn ||
      porTexto(a.titulo, b.titulo) ||
      porTexto(a.asignacionId, b.asignacionId),
  );
  // Abiertos primero (son los accionables: repaso disponible), luego por entrega reciente.
  completados.sort(
    (a, b) =>
      Number(b.ventanaAbierta) - Number(a.ventanaAbierta) ||
      (b.contestadoEn ?? 0) - (a.contestadoEn ?? 0) ||
      porTexto(a.titulo, b.titulo) ||
      porTexto(a.asignacionId, b.asignacionId),
  );
  // Los más recientes primero: un vencido de hace dos años no encabeza la lista.
  vencidos.sort(
    (a, b) =>
      b.cierraEn - a.cierraEn ||
      porTexto(a.titulo, b.titulo) ||
      porTexto(a.asignacionId, b.asignacionId),
  );

  return {
    pendientes,
    completados,
    vencidos,
    fronteras: [...new Set(fronteras)].sort((a, b) => a - b),
    hayFuturas,
    incompleto:
      crudo.historialGrupoIncompleto ||
      crudo.directasIncompletas ||
      crudo.asignacionesLegadasOmitidas,
  };
}
