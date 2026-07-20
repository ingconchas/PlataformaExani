"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FilaTemario } from "@/convex/temario";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { DifficultyMeter, etiquetaDificultad } from "@/components/ui/difficulty-meter";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ModalAgregarReactivos } from "./modal-agregar-reactivos";

type FilaBanco = FunctionReturnType<typeof api.reactivos.listar>[number];
type Examen = NonNullable<FunctionReturnType<typeof api.examenes.paraConstructor>>;
/** La variante completa (el otro miembro de la unión es `{problema:"fueraDeCota",…}`). */
type ExamenCompleto = Extract<Examen, { problema: null }>;

/** Meta precargada por la plantilla «Simulacro de núcleo»: la convención UNX (30/30/30
 *  del Diseño 18). Vive AQUÍ, en la plantilla del cliente — no es constante del sistema
 *  (la meta es opcional y editable por examen). */
const META_NUCLEO = 30;

function mensajeDeError(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  return "Ocurrió un error. Intenta de nuevo.";
}

// ── Estado local AGRUPADO ────────────────────────────────────────────────────
// El invariante del servidor (rachas contiguas por sección, bloques como unidad) queda
// garantizado POR CONSTRUCCIÓN: mover un bloque = mover UN item; la serialización a
// `reactivoIds` es un flatMap siempre conforme. Estado plano + agrupación derivada en
// render haría torpe «el bloque se mueve como unidad».

type ItemUI =
  | { tipo: "reactivo"; id: string }
  | { tipo: "bloque"; lecturaId: string; reactivoIds: string[] };

type SeccionUI = {
  seccionId: string;
  meta: number | null;
  items: ItemUI[];
  /** Anexada por DRIFT (la sección real de un reactivo ya no estaba declarada). */
  drift: boolean;
};

function reactivosDe(s: SeccionUI): number {
  return s.items.reduce(
    (n, it) => n + (it.tipo === "bloque" ? it.reactivoIds.length : 1),
    0,
  );
}

function serializar(secciones: SeccionUI[]): string[] {
  return secciones.flatMap((s) =>
    s.items.flatMap((it) => (it.tipo === "bloque" ? it.reactivoIds : [it.id])),
  );
}

/**
 * Constructor de examen (LUI-21 · Diseño 18). Doble montaje:
 * `/{instructor/examenes,admin/examenes/biblioteca}/{nuevo,[id]/editar}`.
 *
 * Props de ruta EXPLÍCITAS (cero `if (admin)` interno):
 *  · `basePath`   — base de la PANTALLA de exámenes (volver/editar salen de aquí);
 *  · `reactivosPath` — base de la zona para el form de reactivo (crear-directo);
 *  · `temarioPath`   — ruta a Gestión de temario, SOLO en el montaje admin (el aviso de
 *    sección plana enlaza allá; el instructor recibe copy sin enlace — esa pantalla no
 *    existe en su zona).
 *
 * Wrapper de hidratación (patrón `reactivo-form-client`): espera el temario, el banco y
 * —en edición— `paraConstructor` antes de montar el form UNA vez. El ESTADO del examen se
 * sigue leyendo de la query reactiva: si deja de ser borrador (otra pestaña publicó), el
 * form muestra un banner de solo lectura y deshabilita Guardar/Publicar — el servidor
 * rechaza igual; la doble defensa es para que la autora lo VEA, no para autorizar.
 *
 * ⚠️ Aviso de cambios sin guardar — ALCANCE DECLARADO: cubre cierre/recarga
 * (`beforeunload`) y salidas internas por CLICK (breadcrumb, enlaces del shell). El botón
 * Atrás del navegador (popstate de SPA) queda FUERA: App Router no ofrece bloqueo fiable
 * de popstate, y un bloqueo a medias es peor que el límite documentado.
 */
export function ConstructorExamenClient({
  basePath,
  reactivosPath,
  temarioPath,
  examenId,
}: {
  basePath: string;
  reactivosPath: string;
  temarioPath?: string;
  examenId?: string;
}) {
  const { isAuthenticated } = useConvexAuth();
  const temario = useQuery(
    api.temario.listarParaStaff,
    isAuthenticated ? {} : "skip",
  );
  const banco = useQuery(api.reactivos.listar, isAuthenticated ? {} : "skip");
  const existente = useQuery(
    api.examenes.paraConstructor,
    examenId && isAuthenticated ? { examenId } : "skip",
  );
  const esEdicion = !!examenId;
  const cargando =
    temario === undefined ||
    banco === undefined ||
    (esEdicion && existente === undefined);

  return (
    <>
      {cargando ? (
        <div className="rounded-card border border-border bg-surface p-10 text-center text-muted shadow-card">
          Cargando…
        </div>
      ) : esEdicion && existente === null ? (
        <Alert kind="error">
          No se encontró el examen. Vuelve a la{" "}
          <a className="underline" href={basePath}>
            biblioteca
          </a>
          .
        </Alert>
      ) : esEdicion && existente!.problema === "fueraDeCota" ? (
        // El servidor NO truncó: devolvió un estado de problema explícito. Solo lectura.
        <>
          <Breadcrumb
            items={[
              { label: "Exámenes", href: basePath },
              { label: existente!.titulo },
            ]}
          />
          <div className="mt-3">
            <PageHeader title={existente!.titulo} />
          </div>
          <Alert kind="error">
            Este examen excede las cotas del constructor (demasiados reactivos o
            secciones) y no puede abrirse para edición. Revísalo desde «Ver» en la
            biblioteca.
          </Alert>
        </>
      ) : (
        <ConstructorForm
          key={examenId ?? "nuevo"}
          basePath={basePath}
          reactivosPath={reactivosPath}
          temarioPath={temarioPath}
          temario={temario}
          banco={banco}
          examen={esEdicion ? (existente as ExamenCompleto) : null}
        />
      )}
    </>
  );
}

// ── Hidratación ──────────────────────────────────────────────────────────────

/**
 * Estructura y agrupación iniciales desde `paraConstructor` + el banco VIVO.
 *
 * Reglas deterministas:
 *  · estructura = `secciones` almacenadas; si AUSENTE (borrador legado): derivada de los
 *    items por primera aparición **∪ `tipo.seccionId` si es módulo y no está** — así
 *    «Módulo Matemáticas financieras» (VACÍO) conserva su sección y sigue siendo módulo
 *    al guardar;
 *  · un item cuya sección real ∉ declaradas (DRIFT por reclasificación): su sección se
 *    ANEXA al final, marcada, conservando el orden interno — el drift se VE, no se
 *    esconde; el siguiente guardado escribe normalizado;
 *  · los BLOQUES se reconstruyen de datos VIVOS (todas las hermanas actuales del banco,
 *    en su orden): si la lectura ganó una hermana, aparece y el guardado la incluye —
 *    coherente con el validador del servidor;
 *  · FANTASMAS (ids sin documento): fuera de las secciones, a la tarjeta «Reactivos no
 *    disponibles» — guardar se deshabilita hasta quitarlos (el servidor los rechaza).
 */
function hidratar(
  examen: ExamenCompleto,
  porLectura: Map<string, FilaBanco[]>,
): { secciones: SeccionUI[]; fantasmas: string[]; huboDrift: boolean } {
  const declaradas = examen.secciones?.map((s) => s.seccionId as string) ?? null;
  const metaDe = new Map<string, number | null>(
    (examen.secciones ?? []).map((s) => [s.seccionId, s.meta]),
  );

  const orden: string[] = [];
  const driftSet = new Set<string>();
  if (declaradas) {
    orden.push(...declaradas);
  } else {
    for (const it of examen.items) {
      if (it.faltante) continue;
      if (!orden.includes(it.seccionId)) orden.push(it.seccionId);
    }
    const tipo = examen.tipo;
    if (tipo.clase === "modulo" && !orden.includes(tipo.seccionId))
      orden.push(tipo.seccionId);
  }

  const itemsPorSeccion = new Map<string, ItemUI[]>(
    orden.map((s) => [s, []]),
  );
  const fantasmas: string[] = [];
  const bloquesPuestos = new Set<string>();

  for (const it of examen.items) {
    if (it.faltante) {
      fantasmas.push(it.id);
      continue;
    }
    if (!itemsPorSeccion.has(it.seccionId)) {
      // DRIFT: sección real no declarada → se anexa al final, marcada.
      orden.push(it.seccionId);
      driftSet.add(it.seccionId);
      itemsPorSeccion.set(it.seccionId, []);
    }
    const destino = itemsPorSeccion.get(it.seccionId)!;
    if (it.bloque) {
      if (bloquesPuestos.has(it.bloque.lecturaId)) continue; // ya entró como unidad
      bloquesPuestos.add(it.bloque.lecturaId);
      const vivas = porLectura.get(it.bloque.lecturaId) ?? [];
      destino.push({
        tipo: "bloque",
        lecturaId: it.bloque.lecturaId,
        reactivoIds:
          vivas.length > 0 ? vivas.map((r) => r.id) : [it.id], // sin filas vivas: conservar lo que hay
      });
    } else {
      destino.push({ tipo: "reactivo", id: it.id });
    }
  }

  return {
    secciones: orden.map((seccionId) => ({
      seccionId,
      meta: metaDe.get(seccionId) ?? null,
      items: itemsPorSeccion.get(seccionId) ?? [],
      drift: driftSet.has(seccionId),
    })),
    fantasmas,
    huboDrift: driftSet.size > 0,
  };
}

// ── El formulario ────────────────────────────────────────────────────────────

type ModalState =
  | { tipo: "cerrado" }
  | { tipo: "agregar"; seccionId: string }
  | { tipo: "quitarBloque"; seccionId: string; lecturaId: string }
  | { tipo: "quitarSeccion"; seccionId: string }
  | { tipo: "publicarIncompleto"; faltantes: { nombre: string; faltan: number }[] };

function ConstructorForm({
  basePath,
  reactivosPath,
  temarioPath,
  temario,
  banco,
  examen,
}: {
  basePath: string;
  reactivosPath: string;
  temarioPath?: string;
  temario: FilaTemario[];
  banco: FilaBanco[];
  examen: ExamenCompleto | null;
}) {
  const router = useRouter();
  const crear = useMutation(api.examenes.crear);
  const actualizar = useMutation(api.examenes.actualizar);
  const publicar = useMutation(api.examenes.publicar);

  const porId = useMemo(() => new Map(banco.map((r) => [r.id, r])), [banco]);
  // Hermanas VIVAS por lectura de bloque, en su orden persistido. La clave es el id
  // CRUDO del bloque (en filas consistentes coincide con `lecturaId`).
  const porLectura = useMemo(() => {
    const m = new Map<string, FilaBanco[]>();
    for (const r of banco) {
      if (!r.enBloque || r.lecturaId === null) continue;
      const lista = m.get(r.lecturaId) ?? [];
      lista.push(r);
      m.set(r.lecturaId, lista);
    }
    for (const lista of m.values())
      lista.sort((a, b) => (a.bloqueOrden ?? 0) - (b.bloqueOrden ?? 0));
    return m;
  }, [banco]);

  const nombreSeccion = useMemo(
    () =>
      new Map(
        temario.filter((f) => f.nivel === 1).map((f) => [f.id as string, f.nombre]),
      ),
    [temario],
  );

  const inicial = useMemo(
    () =>
      examen
        ? hidratar(examen, porLectura)
        : { secciones: null, fantasmas: [], huboDrift: false },
    // Solo UNA vez (guard de hidratación): el form se monta con key y no se re-inicializa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [titulo, setTitulo] = useState(examen?.titulo ?? "");
  const [horas, setHoras] = useState(
    examen ? String(Math.floor(examen.duracionMin / 60)) : "3",
  );
  const [minutos, setMinutos] = useState(
    examen ? String(examen.duracionMin % 60) : "0",
  );
  // `null` = /nuevo sin plantilla elegida todavía (el ModalPlantilla decide).
  const [secciones, setSecciones] = useState<SeccionUI[] | null>(
    inicial.secciones,
  );
  const [fantasmas, setFantasmas] = useState<string[]>(inicial.fantasmas);
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>({ tipo: "cerrado" });
  const [sucio, setSucio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El id REAL del examen tras el primer guardado desde /nuevo (router.replace no
  // desmonta el form al instante; las operaciones siguientes deben usar este id).
  const [idGuardado, setIdGuardado] = useState<string | null>(
    examen?.id ?? null,
  );
  // ¿La URL ya es /[id]/editar? El replace desde /nuevo se DIFIERE cuando la acción va a
  // pintar un resultado en este mismo montaje (publicar fallido): el replace cambia el
  // `key` del form, lo REMONTA y el error se perdería en la carrera (bug real cazado por
  // la suite). El siguiente «Guardar borrador» lo salda.
  const urlEnEditar = useRef(examen !== null);

  // El estado del examen, REACTIVO (si otra pestaña publica, el form se entera).
  const soloLectura = examen !== null && !examen.puedeEditar;
  const bloqueadoPorEstado = examen !== null && examen.estado !== "borrador";

  function tocar() {
    setSucio(true);
  }

  // ── Aviso de cambios sin guardar (alcance declarado en el docblock) ────────
  const sucioRef = useRef(sucio);
  sucioRef.current = sucio && !enviando;
  useEffect(() => {
    const alCerrar = (e: BeforeUnloadEvent) => {
      if (sucioRef.current) e.preventDefault();
    };
    // Salidas internas por CLICK en enlaces (breadcrumb, sidebar) mientras hay cambios.
    const alClick = (e: MouseEvent) => {
      if (!sucioRef.current) return;
      const ancla = (e.target as HTMLElement).closest("a[href]");
      if (!ancla) return;
      if (!window.confirm("Tienes cambios sin guardar. ¿Salir de todos modos?"))
        e.preventDefault();
      else sucioRef.current = false;
    };
    window.addEventListener("beforeunload", alCerrar);
    document.addEventListener("click", alClick, true);
    return () => {
      window.removeEventListener("beforeunload", alCerrar);
      document.removeEventListener("click", alClick, true);
    };
  }, []);

  // ── Derivados del balance ──────────────────────────────────────────────────
  const totalReactivos = useMemo(
    () => (secciones ?? []).reduce((n, s) => n + reactivosDe(s), 0),
    [secciones],
  );
  const todasConMeta =
    secciones !== null &&
    secciones.length > 0 &&
    secciones.every((s) => s.meta !== null);
  const metaTotal = todasConMeta
    ? secciones!.reduce((n, s) => n + (s.meta ?? 0), 0)
    : null;

  // ── Mutaciones de estado local ─────────────────────────────────────────────
  function actualizarSeccion(seccionId: string, fn: (s: SeccionUI) => SeccionUI) {
    setSecciones((prev) =>
      prev ? prev.map((s) => (s.seccionId === seccionId ? fn(s) : s)) : prev,
    );
    tocar();
  }

  function agregarSeleccion(
    seccionId: string,
    sel: { reactivos: string[]; lecturas: string[] },
  ) {
    actualizarSeccion(seccionId, (s) => {
      const yaIds = new Set(serializar([s]));
      const nuevos: ItemUI[] = [];
      for (const rid of sel.reactivos)
        if (!yaIds.has(rid)) nuevos.push({ tipo: "reactivo", id: rid });
      for (const lid of sel.lecturas) {
        const hermanas = porLectura.get(lid) ?? [];
        if (hermanas.length === 0) continue;
        if (s.items.some((it) => it.tipo === "bloque" && it.lecturaId === lid))
          continue;
        // La lectura entra COMPLETA, como unidad, en el orden del bloque.
        nuevos.push({
          tipo: "bloque",
          lecturaId: lid,
          reactivoIds: hermanas.map((r) => r.id),
        });
      }
      return { ...s, items: [...s.items, ...nuevos] };
    });
    setModal({ tipo: "cerrado" });
  }

  function mover(seccionId: string, indice: number, direccion: -1 | 1) {
    actualizarSeccion(seccionId, (s) => {
      const destino = indice + direccion;
      if (destino < 0 || destino >= s.items.length) return s;
      const items = [...s.items];
      [items[indice], items[destino]] = [items[destino], items[indice]];
      return { ...s, items };
    });
  }

  function quitarItem(seccionId: string, indice: number) {
    actualizarSeccion(seccionId, (s) => ({
      ...s,
      items: s.items.filter((_, i) => i !== indice),
    }));
  }

  function agregarSeccionDeclarada(seccionId: string) {
    setSecciones((prev) =>
      prev
        ? [...prev, { seccionId, meta: null, items: [], drift: false }]
        : [{ seccionId, meta: null, items: [], drift: false }],
    );
    tocar();
  }

  // ── Guardar / publicar ─────────────────────────────────────────────────────
  function duracionMin(): number {
    const h = Number(horas);
    const m = Number(minutos);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  /** Guarda el borrador; devuelve el id (creando el doc en el primer guardado desde
   *  /nuevo) o `null` si falló. `navegarAEditar=false` cuando el llamador va a navegar a
   *  OTRO destino en la misma acción (crear-directo: UNA sola navegación, sin carrera). */
  async function guardar(navegarAEditar = true): Promise<string | null> {
    if (!secciones) return null;
    setError(null);
    setEnviando(true);
    try {
      const args = {
        titulo,
        duracionMin: duracionMin(),
        // La clave `meta` solo viaja PRESENTE cuando hay meta (el validador es
        // `v.optional`): `{meta: undefined}` explícito también serializaría ausente,
        // pero construirlo condicional deja la intención a la vista.
        secciones: secciones.map((s) => ({
          seccionId: s.seccionId as Id<"secciones">,
          ...(s.meta !== null ? { meta: s.meta } : {}),
        })),
        reactivoIds: serializar(secciones) as Id<"reactivos">[],
      };
      let id = idGuardado;
      if (id) {
        await actualizar({ examenId: id as Id<"examenes">, ...args });
      } else {
        const res = await crear(args);
        id = res.id as string;
        setIdGuardado(id);
      }
      if (navegarAEditar && !urlEnEditar.current) {
        urlEnEditar.current = true;
        router.replace(`${basePath}/${id}/editar`);
      }
      setSucio(false);
      setEnviando(false);
      return id;
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
      return null;
    }
  }

  /** «Publicar» = guardar y luego publicar, secuencial. NO se pre-valida en cliente
   *  (los mensajes de las fronteras son del SERVIDOR); lo único del cliente es la
   *  CONFIRMACIÓN de metas incompletas, que enumera faltantes por sección. */
  async function alPublicar() {
    if (!secciones) return;
    const faltantes = secciones
      .filter((s) => s.meta !== null && reactivosDe(s) < s.meta)
      .map((s) => ({
        nombre: nombreSeccion.get(s.seccionId) ?? "—",
        faltan: (s.meta ?? 0) - reactivosDe(s),
      }));
    if (faltantes.length > 0) {
      setModal({ tipo: "publicarIncompleto", faltantes });
      return;
    }
    await publicarDeVerdad();
  }

  async function publicarDeVerdad() {
    setModal({ tipo: "cerrado" });
    // SIN navegar todavía: si publicar falla, el error debe pintarse en ESTE montaje
    // (el replace diferido remontaría el form y se lo tragaría).
    const id = await guardar(false);
    if (!id) return;
    setEnviando(true);
    try {
      await publicar({ examenId: id as Id<"examenes"> });
      router.push(basePath);
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  /** Crear-directo (PRD 07-07): guarda el borrador y hace UNA SOLA navegación al form de
   *  reactivo — `replace` si el examen se acaba de crear desde /nuevo (dejar `/nuevo`
   *  vivo en el historial reviviría la plantilla), `push` si ya existía. */
  async function alCrearDirecto(seccionId: string) {
    const eraNuevo = !urlEnEditar.current;
    const id = await guardar(false);
    if (!id) {
      setModal({ tipo: "cerrado" });
      return;
    }
    const destino = `${reactivosPath}/reactivos/nuevo?examen=${id}&seccion=${seccionId}`;
    if (eraNuevo) router.replace(destino);
    else router.push(destino);
  }

  // ── Plantilla (/nuevo) ─────────────────────────────────────────────────────
  if (secciones === null) {
    return (
      <ModalPlantilla
        temario={temario}
        onCancelar={() => router.push(basePath)}
        onElegir={(elegidas) => {
          setSecciones(elegidas);
          tocar();
        }}
      />
    );
  }

  const seccionesDisponiblesParaAgregar = temario.filter(
    (f) =>
      f.nivel === 1 &&
      f.disponible &&
      !secciones.some((s) => s.seccionId === f.id),
  );
  const deshabilitado =
    enviando || soloLectura || bloqueadoPorEstado || fantasmas.length > 0;

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Exámenes", href: basePath },
          { label: examen?.titulo ?? "Nuevo examen" },
        ]}
      />

      {/* Header: título inline + tiempo límite + estado + acciones (Diseño 18). */}
      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <input
          aria-label="Nombre del examen"
          className="min-w-[240px] flex-1 border-b-2 border-border bg-transparent text-h2 text-ink outline-none focus:border-unx-blue"
          placeholder="Nombre del examen"
          value={titulo}
          onChange={(e) => {
            setTitulo(e.target.value);
            tocar();
          }}
          disabled={deshabilitado && fantasmas.length === 0}
        />
        <label className="flex items-center gap-2 text-small text-muted">
          Tiempo límite
          <input
            aria-label="Horas"
            type="number"
            min={0}
            max={10}
            className="w-14 rounded-md border border-border-strong px-2 py-1 text-body text-ink"
            value={horas}
            onChange={(e) => {
              setHoras(e.target.value);
              tocar();
            }}
          />
          h
          <input
            aria-label="Minutos"
            type="number"
            min={0}
            max={59}
            className="w-14 rounded-md border border-border-strong px-2 py-1 text-body text-ink"
            value={minutos}
            onChange={(e) => {
              setMinutos(e.target.value);
              tocar();
            }}
          />
          min
        </label>
        <Badge tone={examen?.estado === "publicado" ? "green" : "neutral"}>
          {examen?.estado ?? "borrador"}
        </Badge>
        <span className="flex-1" />
        <Button
          variant="secondary"
          onClick={() => void guardar()}
          disabled={deshabilitado}
        >
          {enviando ? "Guardando…" : "Guardar borrador"}
        </Button>
        <Button onClick={() => void alPublicar()} disabled={deshabilitado}>
          Publicar
        </Button>
      </div>

      {bloqueadoPorEstado && (
        <div className="mb-4">
          <Alert kind="warning">
            Este examen ya no es un borrador (ahora está{" "}
            <strong>{examen?.estado}</strong>): quedó en solo lectura. Si nadie lo
            ha usado, puedes devolverlo a borrador desde la biblioteca.
          </Alert>
        </div>
      )}
      {soloLectura && !bloqueadoPorEstado && (
        <div className="mb-4">
          <Alert kind="warning">
            Este borrador es de otro autor; solo su autor (o un administrador)
            puede editarlo.
          </Alert>
        </div>
      )}
      {inicial.huboDrift && (
        <div className="mb-4">
          <Alert kind="warning">
            Algún reactivo fue reclasificado a una sección que no estaba en la
            estructura; su sección se anexó al final. Revisa el orden y guarda
            para normalizarlo.
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Columna izquierda: las secciones del examen. */}
        <div className="min-w-0 flex-1">
          <div className="grid gap-4">
            {secciones.map((s) => (
              <TarjetaSeccion
                key={s.seccionId}
                seccion={s}
                nombre={nombreSeccion.get(s.seccionId) ?? "—"}
                porId={porId}
                colapsada={colapsadas.has(s.seccionId)}
                deshabilitado={deshabilitado && fantasmas.length === 0}
                posicionInicial={
                  serializar(
                    secciones.slice(0, secciones.indexOf(s)),
                  ).length
                }
                onColapsar={() =>
                  setColapsadas((prev) => {
                    const n = new Set(prev);
                    if (n.has(s.seccionId)) n.delete(s.seccionId);
                    else n.add(s.seccionId);
                    return n;
                  })
                }
                onMeta={(meta) =>
                  actualizarSeccion(s.seccionId, (x) => ({ ...x, meta }))
                }
                onAgregar={() => setModal({ tipo: "agregar", seccionId: s.seccionId })}
                onQuitarSeccion={() => {
                  if (s.items.length > 0)
                    setModal({ tipo: "quitarSeccion", seccionId: s.seccionId });
                  else {
                    setSecciones((prev) =>
                      prev
                        ? prev.filter((x) => x.seccionId !== s.seccionId)
                        : prev,
                    );
                    tocar();
                  }
                }}
                onMover={(i, d) => mover(s.seccionId, i, d)}
                onQuitarItem={(i) => {
                  const it = s.items[i];
                  if (it.tipo === "bloque")
                    setModal({
                      tipo: "quitarBloque",
                      seccionId: s.seccionId,
                      lecturaId: it.lecturaId,
                    });
                  else quitarItem(s.seccionId, i);
                }}
              />
            ))}
          </div>

          {fantasmas.length > 0 && (
            <div className="mt-4 rounded-card border border-unx-error bg-unx-error-tint p-4">
              <p className="mb-2 font-semibold text-unx-error">
                Reactivos no disponibles
              </p>
              <p className="mb-3 text-small text-text">
                {fantasmas.length === 1
                  ? "Un reactivo del examen ya no existe."
                  : `${fantasmas.length} reactivos del examen ya no existen.`}{" "}
                No se puede guardar hasta quitarlos.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setFantasmas([]);
                  tocar();
                }}
              >
                Quitar no disponibles
              </Button>
            </div>
          )}

          {seccionesDisponiblesParaAgregar.length > 0 &&
            !soloLectura &&
            !bloqueadoPorEstado && (
              <div className="mt-4">
                <AgregarSeccion
                  opciones={seccionesDisponiblesParaAgregar}
                  onAgregar={agregarSeccionDeclarada}
                />
              </div>
            )}
        </div>

        {/* Columna derecha: Balance del examen. */}
        <AsideBalance
          secciones={secciones}
          porId={porId}
          nombreSeccion={nombreSeccion}
          temario={temario}
          totalReactivos={totalReactivos}
          metaTotal={metaTotal}
        />
      </div>

      {/* ── Modales ── */}
      {modal.tipo === "agregar" && (
        <ModalAgregarReactivos
          seccionId={modal.seccionId}
          seccionNombre={nombreSeccion.get(modal.seccionId) ?? "—"}
          temario={temario}
          banco={banco}
          temarioPath={temarioPath}
          yaEnExamen={new Set(serializar(secciones))}
          lecturasYaEnExamen={
            new Set(
              secciones.flatMap((s) =>
                s.items.flatMap((it) =>
                  it.tipo === "bloque" ? [it.lecturaId] : [],
                ),
              ),
            )
          }
          onAgregar={(sel) => agregarSeleccion(modal.seccionId, sel)}
          onCrearDirecto={() => void alCrearDirecto(modal.seccionId)}
          onClose={() => setModal({ tipo: "cerrado" })}
        />
      )}
      {modal.tipo === "quitarBloque" && (
        <Modal
          title="¿Quitar la lectura completa?"
          width={440}
          onClose={() => setModal({ tipo: "cerrado" })}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setModal({ tipo: "cerrado" })}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  actualizarSeccion(modal.seccionId, (s) => ({
                    ...s,
                    items: s.items.filter(
                      (it) =>
                        !(
                          it.tipo === "bloque" &&
                          it.lecturaId === modal.lecturaId
                        ),
                    ),
                  }));
                  setModal({ tipo: "cerrado" });
                }}
              >
                Quitar la lectura
              </Button>
            </>
          }
        >
          <p className="text-small text-text">
            Las preguntas de una lectura van juntas: quitar una quita el bloque
            completo, con todas sus preguntas.
          </p>
        </Modal>
      )}
      {modal.tipo === "quitarSeccion" && (
        <Modal
          title="¿Quitar la sección y sus reactivos?"
          width={440}
          onClose={() => setModal({ tipo: "cerrado" })}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setModal({ tipo: "cerrado" })}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setSecciones((prev) =>
                    prev
                      ? prev.filter((x) => x.seccionId !== modal.seccionId)
                      : prev,
                  );
                  tocar();
                  setModal({ tipo: "cerrado" });
                }}
              >
                Quitar sección
              </Button>
            </>
          }
        >
          <p className="text-small text-text">
            La sección «{nombreSeccion.get(modal.seccionId) ?? "—"}» tiene
            reactivos agregados; quitarla los saca del examen (siguen en el
            banco).
          </p>
        </Modal>
      )}
      {modal.tipo === "publicarIncompleto" && (
        <Modal
          title="Publicar con secciones incompletas"
          width={460}
          onClose={() => setModal({ tipo: "cerrado" })}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setModal({ tipo: "cerrado" })}
              >
                Seguir editando
              </Button>
              <Button onClick={() => void publicarDeVerdad()} disabled={enviando}>
                {enviando ? "Publicando…" : "Publicar de todos modos"}
              </Button>
            </>
          }
        >
          <div className="grid gap-2 text-small text-text">
            <p>El examen no alcanza la meta de reactivos en:</p>
            <ul className="ml-4 list-disc">
              {modal.faltantes.map((f) => (
                <li key={f.nombre}>
                  Faltan {f.faltan} en {f.nombre}
                </li>
              ))}
            </ul>
            <p>Puedes publicarlo así y completarlo después despublicándolo.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Plantilla de arranque (/nuevo) ───────────────────────────────────────────

/**
 * «Simulacro de núcleo» precarga las 3 secciones `nucleo` EN el orden del temario, con
 * meta 30 (la convención UNX — editable/borrable). «Examen de módulo» pide UNA sección
 * de módulo, sin meta. Después la estructura se edita libremente («no bloquea otras
 * combinaciones»); el TIPO del examen lo calcula el servidor de la estructura.
 */
function ModalPlantilla({
  temario,
  onElegir,
  onCancelar,
}: {
  temario: FilaTemario[];
  onElegir: (secciones: SeccionUI[]) => void;
  onCancelar: () => void;
}) {
  const nucleo = temario.filter((f) => f.nivel === 1 && f.tipo === "nucleo");
  const modulos = temario.filter(
    (f) => f.nivel === 1 && f.tipo === "modulo" && f.disponible,
  );
  const [moduloElegido, setModuloElegido] = useState("");

  return (
    <Modal
      title="¿Qué examen vas a armar?"
      width={520}
      onClose={onCancelar}
      actions={
        <Button variant="secondary" onClick={onCancelar}>
          Cancelar
        </Button>
      }
    >
      <div className="grid gap-4">
        <button
          type="button"
          className="rounded-card border border-border p-4 text-left transition hover:border-unx-blue"
          onClick={() =>
            onElegir(
              nucleo.map((f) => ({
                seccionId: f.id,
                meta: META_NUCLEO,
                items: [],
                drift: false,
              })),
            )
          }
        >
          <span className="block font-semibold text-ink">
            Simulacro de núcleo
          </span>
          <span className="block text-small text-muted">
            {nucleo.map((f) => f.nombre).join(" + ")} — el examen general que se
            asigna a todos, con meta de {META_NUCLEO} por sección (editable).
          </span>
        </button>
        <div className="rounded-card border border-border p-4">
          <span className="block font-semibold text-ink">Examen de módulo</span>
          <span className="mb-2 block text-small text-muted">
            Una sola sección de módulo, para grupos específicos.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Sección de módulo"
              containerClassName="min-w-[220px]"
              options={[
                { value: "", label: "Elige el módulo…" },
                ...modulos.map((m) => ({ value: m.id, label: m.nombre })),
              ]}
              value={moduloElegido}
              onChange={(e) => setModuloElegido(e.target.value)}
            />
            <Button
              disabled={moduloElegido === ""}
              onClick={() =>
                onElegir([
                  {
                    seccionId: moduloElegido,
                    meta: null,
                    items: [],
                    drift: false,
                  },
                ])
              }
            >
              Empezar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** «+ Agregar sección» — las restantes del temario (disponibles). */
function AgregarSeccion({
  opciones,
  onAgregar,
}: {
  opciones: FilaTemario[];
  onAgregar: (seccionId: string) => void;
}) {
  const [valor, setValor] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Agregar sección"
        containerClassName="min-w-[220px]"
        options={[
          { value: "", label: "+ Agregar sección…" },
          ...opciones.map((o) => ({ value: o.id as string, label: o.nombre })),
        ]}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={valor === ""}
        onClick={() => {
          onAgregar(valor);
          setValor("");
        }}
      >
        Agregar
      </Button>
    </div>
  );
}

// ── Tarjeta de sección ───────────────────────────────────────────────────────

function TarjetaSeccion({
  seccion,
  nombre,
  porId,
  colapsada,
  deshabilitado,
  posicionInicial,
  onColapsar,
  onMeta,
  onAgregar,
  onQuitarSeccion,
  onMover,
  onQuitarItem,
}: {
  seccion: SeccionUI;
  nombre: string;
  porId: Map<string, FilaBanco>;
  colapsada: boolean;
  deshabilitado: boolean;
  posicionInicial: number;
  onColapsar: () => void;
  onMeta: (meta: number | null) => void;
  onAgregar: () => void;
  onQuitarSeccion: () => void;
  onMover: (indice: number, direccion: -1 | 1) => void;
  onQuitarItem: (indice: number) => void;
}) {
  const n = reactivosDe(seccion);
  const faltan = seccion.meta !== null ? Math.max(0, seccion.meta - n) : 0;
  // Nº GLOBAL de la primera pregunta de cada item (el mock numera corrido).
  let posicion = posicionInicial;

  return (
    <section
      aria-label={`Sección ${nombre}`}
      className="rounded-card border border-border bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-label={
            colapsada ? `Expandir ${nombre}` : `Colapsar ${nombre}`
          }
          onClick={onColapsar}
          className="shrink-0 text-muted hover:text-ink"
        >
          {colapsada ? (
            <ChevronRight className="size-[18px]" aria-hidden />
          ) : (
            <ChevronDown className="size-[18px]" aria-hidden />
          )}
        </button>
        <span className="min-w-0 font-semibold text-ink">
          {nombre}{" "}
          <span className="font-normal text-muted">
            ({seccion.meta !== null ? `${n} de ${seccion.meta} reactivos` : `${n} reactivos`})
          </span>
        </span>
        {seccion.drift && <Badge tone="orange">fuera de la estructura</Badge>}
        {faltan > 0 && <Badge tone="orange">Faltan {faltan}</Badge>}
        <span className="min-w-2 flex-1" />
        {/* Grupo DERECHO indivisible: si el ancho no alcanza, se envuelve COMPLETO a la
            línea siguiente — nunca un control suelto (el ✕ huérfano del primer humo). */}
        <span className="ml-auto flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1 text-caption text-muted">
          Meta
          <input
            aria-label={`Meta de ${nombre}`}
            type="number"
            min={1}
            className="w-16 rounded-md border border-border px-2 py-0.5 text-small text-ink"
            value={seccion.meta ?? ""}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value.trim();
              onMeta(v === "" ? null : Number(v));
            }}
            disabled={deshabilitado}
          />
        </label>
        <Button variant="secondary" onClick={onAgregar} disabled={deshabilitado}>
          Agregar reactivos
        </Button>
        <button
          type="button"
          aria-label={`Quitar la sección ${nombre}`}
          onClick={onQuitarSeccion}
          disabled={deshabilitado}
          className="grid size-8 place-items-center rounded-md bg-unx-error-tint text-unx-error hover:opacity-80 disabled:opacity-40"
        >
          <X className="size-4" aria-hidden />
        </button>
        </span>
      </div>

      {!colapsada && (
        <div>
          {seccion.items.length === 0 ? (
            <p className="border-t border-border px-4 py-4 text-small text-muted">
              Sin reactivos todavía — usa «Agregar reactivos».
            </p>
          ) : (
            seccion.items.map((it, i) => {
              const desde = posicion + 1;
              const cuantos = it.tipo === "bloque" ? it.reactivoIds.length : 1;
              posicion += cuantos;
              return it.tipo === "bloque" ? (
                <BloqueLectura
                  key={it.lecturaId}
                  lecturaId={it.lecturaId}
                  reactivoIds={it.reactivoIds}
                  porId={porId}
                  desde={desde}
                  deshabilitado={deshabilitado}
                  puedeSubir={i > 0}
                  puedeBajar={i < seccion.items.length - 1}
                  onMover={(d) => onMover(i, d)}
                  onQuitar={() => onQuitarItem(i)}
                />
              ) : (
                <FilaReactivo
                  key={it.id}
                  fila={porId.get(it.id)}
                  numero={desde}
                  deshabilitado={deshabilitado}
                  puedeSubir={i > 0}
                  puedeBajar={i < seccion.items.length - 1}
                  onMover={(d) => onMover(i, d)}
                  onQuitar={() => onQuitarItem(i)}
                />
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

function ControlesFila({
  etiqueta,
  deshabilitado,
  puedeSubir,
  puedeBajar,
  onMover,
  onQuitar,
}: {
  etiqueta: string;
  deshabilitado: boolean;
  puedeSubir: boolean;
  puedeBajar: boolean;
  onMover: (direccion: -1 | 1) => void;
  onQuitar: () => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Subir ${etiqueta}`}
        onClick={() => onMover(-1)}
        disabled={deshabilitado || !puedeSubir}
        className="grid size-7 place-items-center rounded-md text-muted hover:text-ink disabled:opacity-30"
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Bajar ${etiqueta}`}
        onClick={() => onMover(1)}
        disabled={deshabilitado || !puedeBajar}
        className="grid size-7 place-items-center rounded-md text-muted hover:text-ink disabled:opacity-30"
      >
        <ArrowDown className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`Quitar ${etiqueta}`}
        onClick={onQuitar}
        disabled={deshabilitado}
        className="grid size-7 place-items-center rounded-md bg-unx-error-tint text-unx-error hover:opacity-80 disabled:opacity-40"
      >
        <X className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function FilaReactivo({
  fila,
  numero,
  deshabilitado,
  puedeSubir,
  puedeBajar,
  onMover,
  onQuitar,
}: {
  fila: FilaBanco | undefined;
  numero: number;
  deshabilitado: boolean;
  puedeSubir: boolean;
  puedeBajar: boolean;
  onMover: (direccion: -1 | 1) => void;
  onQuitar: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
      <span className="w-6 text-right text-small tabular-nums text-muted">
        {numero}
      </span>
      <span className="min-w-0 flex-1 truncate text-small text-text">
        {fila?.enunciado ?? "—"}
      </span>
      {fila && !fila.activo && <Badge tone="neutral">desactivado</Badge>}
      {fila?.presentacion !== undefined && fila.presentacion !== "directa" && (
        <Badge tone="neutral">{fila.presentacion}</Badge>
      )}
      <span className="w-[110px] truncate text-caption text-muted">
        {fila?.areaNombre ?? "—"}
      </span>
      {fila && (
        <DifficultyMeter level={fila.dificultad} size="chip" showLabel={false} />
      )}
      <ControlesFila
        etiqueta={`el reactivo ${numero}`}
        deshabilitado={deshabilitado}
        puedeSubir={puedeSubir}
        puedeBajar={puedeBajar}
        onMover={onMover}
        onQuitar={onQuitar}
      />
    </div>
  );
}

/** El bloque de lectura como UNIDAD: cabecera azul + rango de posiciones; subir/bajar y
 *  quitar operan el bloque entero («se mueve como unidad», Diseño 18). */
function BloqueLectura({
  lecturaId,
  reactivoIds,
  porId,
  desde,
  deshabilitado,
  puedeSubir,
  puedeBajar,
  onMover,
  onQuitar,
}: {
  lecturaId: string;
  reactivoIds: string[];
  porId: Map<string, FilaBanco>;
  desde: number;
  deshabilitado: boolean;
  puedeSubir: boolean;
  puedeBajar: boolean;
  onMover: (direccion: -1 | 1) => void;
  onQuitar: () => void;
}) {
  const titulo = porId.get(reactivoIds[0])?.lecturaTitulo ?? "—";
  const hasta = desde + reactivoIds.length - 1;
  return (
    <div className="border-t border-border bg-unx-blue-tint px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-semibold text-unx-blue">
          ▤ Lectura: {titulo} — {reactivoIds.length} pregunta
          {reactivoIds.length === 1 ? "" : "s"}
        </span>
        <span className="text-caption text-muted">se mueve como unidad</span>
        <ControlesFila
          etiqueta={`la lectura ${titulo}`}
          deshabilitado={deshabilitado}
          puedeSubir={puedeSubir}
          puedeBajar={puedeBajar}
          onMover={onMover}
          onQuitar={onQuitar}
        />
      </div>
      <p className="mt-0.5 text-caption text-muted">
        {desde === hasta ? `${desde}` : `${desde}–${hasta}`} ·{" "}
        {reactivoIds.length} pregunta{reactivoIds.length === 1 ? "" : "s"} de
        comprensión, contiguas y en orden
      </p>
      <span className="sr-only" data-lectura={lecturaId} />
    </div>
  );
}

// ── Balance del examen (aside) ───────────────────────────────────────────────

function BarraProgreso({
  etiqueta,
  valor,
  meta,
}: {
  etiqueta: string;
  valor: number;
  meta: number | null;
}) {
  const pct =
    meta === null || meta === 0 ? 0 : Math.min(100, (valor / meta) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-small">
        <span className="text-text">{etiqueta}</span>
        <span className="tabular-nums text-muted">
          {meta !== null ? `${valor}/${meta}` : valor}
        </span>
      </div>
      {meta !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={cn(
              "h-full rounded-full",
              valor >= meta ? "bg-unx-green" : "bg-unx-blue",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * «Balance del examen»: total, barra por sección, áreas con tags FALTAN/POCOS y leyenda
 * por dificultad (nomenclatura canónica `etiquetaDificultad` — jamás copy paralelo).
 *
 * Reglas DETERMINISTAS de los tags: `FALTAN` = área con 0 reactivos en una sección con
 * meta declarada y no alcanzada; `POCOS` = área con 1–2. El total dice «X de Y» SOLO si
 * TODAS las secciones tienen meta (con metas parciales, Σmetas subestimaría y el «de Y»
 * mentiría); si no, «X reactivos» — las barras por sección conservan su meta individual.
 */
function AsideBalance({
  secciones,
  porId,
  nombreSeccion,
  temario,
  totalReactivos,
  metaTotal,
}: {
  secciones: SeccionUI[];
  porId: Map<string, FilaBanco>;
  nombreSeccion: Map<string, string>;
  temario: FilaTemario[];
  totalReactivos: number;
  metaTotal: number | null;
}) {
  const porSeccion = secciones.map((s) => {
    const ids = serializar([s]);
    const areas = new Map<string, number>();
    // TODAS las áreas del temario de la sección arrancan en 0 (así un área vacía existe
    // y puede llevar el tag FALTAN).
    for (const f of temario)
      if (f.nivel === 2 && f.seccionId === s.seccionId && f.disponible)
        areas.set(f.nombre, 0);
    const dif: Record<"facil" | "medio" | "dificil", number> = {
      facil: 0,
      medio: 0,
      dificil: 0,
    };
    for (const id of ids) {
      const r = porId.get(id);
      if (!r) continue;
      areas.set(r.areaNombre, (areas.get(r.areaNombre) ?? 0) + 1);
      dif[r.dificultad]++;
    }
    return { seccion: s, n: ids.length, areas, dif };
  });

  return (
    <aside
      aria-label="Balance del examen"
      className="w-full shrink-0 rounded-card border border-border bg-surface p-4 shadow-card lg:w-[320px]"
    >
      <p className="font-condensed text-small font-semibold uppercase tracking-wide text-muted">
        Balance del examen
      </p>
      <p className="mt-1 text-[40px] font-bold tabular-nums leading-none text-ink">
        {totalReactivos}
      </p>
      <p className="text-small text-muted" aria-live="polite">
        {metaTotal !== null
          ? `de ${metaTotal} reactivos en total`
          : `reactivo${totalReactivos === 1 ? "" : "s"} en total`}
      </p>

      <div className="mt-4 grid gap-3">
        {porSeccion.map(({ seccion, n }) => (
          <BarraProgreso
            key={seccion.seccionId}
            etiqueta={nombreSeccion.get(seccion.seccionId) ?? "—"}
            valor={n}
            meta={seccion.meta}
          />
        ))}
      </div>

      {porSeccion.map(({ seccion, n, areas, dif }) => (
        <div key={seccion.seccionId} className="mt-5">
          <p className="font-condensed text-caption font-semibold uppercase tracking-wide text-muted">
            {nombreSeccion.get(seccion.seccionId) ?? "—"} · por área
          </p>
          <div className="mt-2 grid gap-1.5">
            {[...areas.entries()].map(([area, cuenta]) => {
              const metaNoAlcanzada =
                seccion.meta !== null && n < seccion.meta;
              const tag =
                cuenta === 0 && metaNoAlcanzada
                  ? "FALTAN"
                  : cuenta >= 1 && cuenta <= 2
                    ? "POCOS"
                    : null;
              return (
                <div key={area} className="flex items-center gap-2 text-small">
                  <span className="min-w-0 flex-1 truncate text-text">
                    {area}
                  </span>
                  {tag && (
                    <span className="rounded-pill bg-unx-orange-tint px-1.5 text-caption font-semibold text-unx-orange-text">
                      {tag}
                    </span>
                  )}
                  <span className="w-6 text-right tabular-nums text-muted">
                    {cuenta}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-caption text-muted">
            {(["facil", "medio", "dificil"] as const).map((niv, i) => (
              <span key={niv} className={i > 0 ? "ml-3" : undefined}>
                ● {etiquetaDificultad[niv]} {dif[niv]}
              </span>
            ))}
          </p>
        </div>
      ))}
    </aside>
  );
}
