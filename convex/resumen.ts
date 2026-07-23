import { type GenericId } from "convex/values";
import { fueAplicada } from "./metricas";
import {
  participacionDe,
  pctDeFraccion,
  type AlumnoId,
  type ExamenId,
  type GrupoId,
  type IntentoCrudoResultados,
  type SeccionId,
} from "./resultados";
import { MAX_HISTORIAL_ASIGNACIONES_GRUPO } from "./asignacionDestino";
import { MAX_REACTIVOS } from "./constructorExamen";

/**
 * RESUMEN DE EXÁMENES APLICADOS — vista de la administradora (LUI-32), módulo PURO.
 *
 * Misma razón de existir que `resultados.ts` y `simulacro.ts`: `npx convex run` corre sin
 * identidad (lo decidible sin BD se prueba en `scripts/test-resumen.ts` contra ESTE código)
 * y la derivación la comparten el CLIENTE (que arma los bloques, filtros y celdas) y las
 * pruebas. Solo importa `convex/values` y módulos puros hermanos.
 *
 * ══ PARIDAD CON EL INSTRUCTOR, POR CONSTRUCCIÓN ══
 *
 * Las cifras de cada fila (promedio, «A de B», aciertos por sección) salen de los MISMOS
 * helpers que Resultados del examen (LUI-30): `simulacro.primerIntentoPorAlumna` /
 * `promedioDeAsignacion`, `resultados.participacionDe` y `resultados.pctDeFraccion`. La CA
 * «cifras idénticas a las del instructor» no es disciplina: es la misma función sobre los
 * mismos rangos. La única cifra NUEVA —«PM 18/30»— se deriva de los mismos agregados y su
 * regla (`celdaSeccion`) representa exactamente `ΣA/ΣT`, el porcentaje que muestra el
 * instructor.
 *
 * ══ SUCESOR DECLARADO ══ Si el volumen exige menos lecturas que N `cifrasDe` por pantalla,
 * el paso siguiente es un read-model de resumen denormalizado por asignación (agregados
 * estampados por `finalizarIntento`), con su migración de 3 fases. Se descartó en v1 porque
 * el mantenimiento incremental depende de la dinámica del selector canónico (un envío nuevo
 * puede cambiar el intento-que-cuenta de una alumna) y porque «B» (el roster) es vivo, no
 * estampable. Deuda declarada, no olvidada.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas
// ─────────────────────────────────────────────────────────────────────────────

/** Bloques (grupos) por página del listado. El batch `bloquesDe` recibe a lo más estos ids
 *  de una vez (frontera de args de la query). */
export const PAGINA_BLOQUES = 10;

/**
 * Filas por página DENTRO del bloque expandido. Es lo que acota el fan-out PESADO: con el
 * acordeón estricto (un solo bloque expandido a la vez), a lo más `PAGINA_RESUMEN` queries
 * `cifrasDe` viven simultáneamente — el MISMO número que monta el panel del admin
 * (5 × `promedioDe`), el precedente bendecido.
 */
export const PAGINA_RESUMEN = 5;

/**
 * Codifica el ciclo de un grupo al `value` de su <option> — TOTAL, INYECTIVO y DOM-SAFE para
 * CUALQUIER string que el schema admita (`ciclo` es `v.string()` sin cota y los escritores
 * solo hacen `.trim()`, así que un legado o un alta por API puede traer controles como U+0000
 * que el parser HTML corrompería a U+FFFD en la hidratación). `encodeURIComponent` escapa TODO
 * carácter de control y no-ASCII a `%XX` — el value resultante es siempre ASCII imprimible— y
 * es reversible ⇒ inyectivo. El prefijo separa los dos espacios: los ciclos reales van
 * `"c"+encoded` (empiezan con "c") y el bucket «Sin ciclo» es exactamente `"n"`; nunca
 * colisionan. El "" del estado del cliente sigue significando «usar el default». No se
 * DECODIFICA en ningún lado: el value es identidad opaca; el ciclo crudo sale del catálogo. */
export function codificarCiclo(ciclo: string | null): string {
  return ciclo === null ? "n" : `c${encodeURIComponent(ciclo)}`;
}

/**
 * Ids DISTINTOS de sección que `cifrasDe` resuelve por fila. Derivada de `MAX_REACTIVOS`
 * (240), NO de `MAX_SECCIONES` (20): `examenes.secciones` es OPCIONAL y `validarPublicable`
 * tolera su ausencia, así que un examen legado VÁLIDO puede clasificar sus ≤240 reactivos en
 * hasta 240 secciones distintas — que el instructor SÍ procesa (Q3 admite 500 ids). Un
 * intento no puede referenciar más secciones que reactivos tiene el examen; >240 = catálogo
 * manipulado ⇒ `problema: "clasificaciones"` FAIL-CLOSED. El paro por bytes protege los
 * nombres (`CATALOGO_CLASIF_BYTES`).
 */
export const MAX_SECCIONES_CIFRAS = MAX_REACTIVOS;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type AsignacionId = GenericId<"asignaciones">;

/** Fila cruda de asignación tal como la lee `bloquesDe` de `by_grupo` (antes de filtrar por
 *  aplicada). Tipo estructural: las pruebas fabrican `{envioRegistradoEn: 5, ...}`. */
export type FilaCrudaResumen = {
  asignacionId: AsignacionId;
  examenId: ExamenId;
  titulo: string | null;
  abreEn: number;
  envioRegistradoEn?: number;
};

/** Fila APLICADA de un bloque (ya filtrada y ordenada); la que ve el cliente. */
export type FilaDeResumen = {
  asignacionId: AsignacionId;
  examenId: ExamenId;
  titulo: string | null;
  abreEn: number;
};

export type AgregadoSeccion = {
  sumaAciertos: number;
  sumaTotales: number;
  /** Intentos con desglose que TRAEN esta sección. */
  k: number;
  /** El total SI Y SOLO SI todos los intentos coinciden en él; `null` si difieren. */
  totalComun: number | null;
};

/** Sección agregada tal como viaja en `cifrasDe`, con su nombre resuelto. */
export type SeccionAgregadaResumen = AgregadoSeccion & {
  seccionId: SeccionId;
  nombre: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de comparación
// ─────────────────────────────────────────────────────────────────────────────

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────
// El historial de un grupo (corre en el SERVIDOR, dentro de `bloquesDe`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtra y ordena las asignaciones aplicadas de UN grupo a partir de su `take(MAX + 1)` de
 * `by_grupo`. `incompleto` = el centinela se llenó (>MAX): el grupo tiene más historial del
 * que la cota de lectura garantiza, así que el bloque va FAIL-CLOSED («Datos incompletos»)
 * y JAMÁS un prefijo. Con datos válidos es inalcanzable (frontera de escritura
 * `MAX_HISTORIAL_ASIGNACIONES_GRUPO` en `asignar`); un desborde solo puede ser legado o
 * fabricado por un seed de prueba. Orden TOTAL: `abreEn` desc → `asignacionId`.
 */
export function filasDeGrupoResumen(escaneadas: readonly FilaCrudaResumen[]): {
  filas: FilaDeResumen[];
  incompleto: boolean;
} {
  if (escaneadas.length > MAX_HISTORIAL_ASIGNACIONES_GRUPO) {
    return { filas: [], incompleto: true };
  }
  const filas = escaneadas
    .filter((f) => fueAplicada(f))
    .map((f) => ({
      asignacionId: f.asignacionId,
      examenId: f.examenId,
      titulo: f.titulo,
      abreEn: f.abreEn,
    }))
    .sort(
      (a, b) => b.abreEn - a.abreEn || cmpId(a.asignacionId, b.asignacionId),
    );
  return { filas, incompleto: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aciertos por sección
// ─────────────────────────────────────────────────────────────────────────────

/** Palabras que NO cuentan para la abreviatura (conectores comunes en español). */
const STOPWORDS_SECCION = new Set([
  "de", "del", "la", "las", "el", "los", "y", "e", "en", "por", "para", "a",
  "o", "u", "con",
]);

/**
 * Abreviatura de una sección DERIVADA de su nombre real (jamás una tabla fija: las
 * abreviaturas «PM/CL/RI» del mock no existen en los datos). Iniciales en mayúsculas de las
 * palabras significativas (≤3); una sola palabra significativa → sus primeras 3 letras. El
 * nombre COMPLETO siempre acompaña como `title`/caption, así que la abreviatura es una pista
 * visual, no la única fuente.
 *
 *   «Pensamiento matemático» → PM · «Comprensión lectora» → CL · «Biología» → BIO
 */
export function abreviaturaDeSeccion(nombre: string): string {
  const significativas = nombre
    .trim()
    .split(/\s+/)
    .filter(
      (p) => p.length > 0 && !STOPWORDS_SECCION.has(p.toLocaleLowerCase("es")),
    );
  if (significativas.length === 0) {
    // Nombre compuesto solo de conectores (patológico): las primeras 3 letras del nombre.
    return nombre.trim().slice(0, 3).toLocaleUpperCase("es");
  }
  if (significativas.length === 1) {
    return significativas[0].slice(0, 3).toLocaleUpperCase("es");
  }
  return significativas
    .slice(0, 3)
    .map((p) => p.slice(0, 1).toLocaleUpperCase("es"))
    .join("");
}

/**
 * Agrega los desgloses por SECCIÓN de los intentos-que-cuentan enviados (LUI-32).
 *
 * ELEGIBILIDAD IDÉNTICA a `resultados.agregarDesgloses` (citada): una fila entra solo si
 * tiene AMBOS arreglos —`aciertosPorSeccion` Y `aciertosPorArea`—, aunque el resumen use
 * solo secciones; si le falta cualquiera, se cuenta en `sinDesglose` y queda fuera. Así la
 * población agregada y el conteo de `sinDesglose` coinciden con los del instructor por
 * construcción. Consume EXCLUSIVAMENTE la salida deduplicada de `primerIntentoPorAlumna`
 * (doble conteo imposible).
 *
 * `totalComun` por sección: el total SI todos los intentos coinciden en él (la vía a la
 * cifra exacta «x/T»); `null` si difieren (fantasmas excluidos del desglose, reclasificación
 * entre intentos) — en ese caso `celdaSeccion` cae al porcentaje `ΣA/ΣT`.
 */
export function agregadoSeccionesResumen(
  seleccionados: Iterable<IntentoCrudoResultados>,
): { porSeccion: Map<SeccionId, AgregadoSeccion>; sinDesglose: number } {
  const acc = new Map<
    SeccionId,
    {
      sumaAciertos: number;
      sumaTotales: number;
      k: number;
      totalComun: number | null;
      dispar: boolean;
    }
  >();
  let sinDesglose = 0;
  for (const i of seleccionados) {
    if (i.estado !== "enviado") continue;
    if (!i.aciertosPorSeccion || !i.aciertosPorArea) {
      sinDesglose += 1;
      continue;
    }
    for (const c of i.aciertosPorSeccion) {
      const cur =
        acc.get(c.seccionId) ??
        {
          sumaAciertos: 0,
          sumaTotales: 0,
          k: 0,
          totalComun: null as number | null,
          dispar: false,
        };
      cur.sumaAciertos += c.aciertos;
      cur.sumaTotales += c.total;
      cur.k += 1;
      if (cur.k === 1) cur.totalComun = c.total;
      else if (cur.totalComun !== c.total) cur.dispar = true;
      acc.set(c.seccionId, cur);
    }
  }
  const porSeccion = new Map<SeccionId, AgregadoSeccion>();
  for (const [id, v] of acc) {
    porSeccion.set(id, {
      sumaAciertos: v.sumaAciertos,
      sumaTotales: v.sumaTotales,
      k: v.k,
      totalComun: v.dispar ? null : v.totalComun,
    });
  }
  return { porSeccion, sinDesglose };
}

/**
 * Texto de UNA sección para la celda «Aciertos por sección» (LUI-32, hallazgo M3 del 3er
 * dictamen). DOS ramas, sin redondear jamás el numerador:
 *   · `totalComun` T y media ΣA/k ENTERA → «{abrev} {ΣA/k}/{T}» (la fracción exacta);
 *   · cualquier otro caso → «{abrev} {pctDeFraccion(ΣA/ΣT)}%» (el MISMO % del instructor).
 * `null` = sección sin datos agregados (se omite del texto).
 */
export function celdaSeccion(entrada: {
  abreviatura: string;
  agregado: AgregadoSeccion;
}): string | null {
  const { sumaAciertos, sumaTotales, k, totalComun } = entrada.agregado;
  if (k === 0 || sumaTotales === 0) return null;
  const media = sumaAciertos / k;
  if (totalComun !== null && Number.isInteger(media)) {
    return `${entrada.abreviatura} ${media}/${totalComun}`;
  }
  return `${entrada.abreviatura} ${pctDeFraccion(sumaAciertos / sumaTotales)}%`;
}

/** Texto de la celda «Aciertos por sección» de UNA fila (solo depende de `cifras`, no del
 *  roster): `seccionesTexto` = «PM 18/30 · CL 22/30» (vacío ⇒ ""); `seccionesTitulo` =
 *  nombres COMPLETOS + cifra, para el `title`/aria. */
export function textoAciertosPorSeccion(
  secciones: readonly SeccionAgregadaResumen[],
): { seccionesTexto: string; seccionesTitulo: string } {
  const celdas: string[] = [];
  const titulos: string[] = [];
  for (const s of secciones) {
    const abrev = s.nombre !== null ? abreviaturaDeSeccion(s.nombre) : "—";
    const celda = celdaSeccion({ abreviatura: abrev, agregado: s });
    if (celda === null) continue;
    celdas.push(celda);
    titulos.push(
      s.nombre !== null
        ? `${s.nombre}: ${celda}`
        : `Sección eliminada: ${celda}`,
    );
  }
  return {
    seccionesTexto: celdas.join(" · "),
    seccionesTitulo: titulos.join(" · "),
  };
}

/** Participación «A de B» + caption `fuerasDeRoster`, secciones formateadas y `sinDesglose`
 *  de UNA fila, a partir de los payloads YA RESUELTOS de `cifrasDe` y `rosterDe`. */
export type CifrasFilaResuelta = {
  participacion: { completaron: number; deTotal: number; fuerasDeRoster: number };
  seccionesTexto: string; // «PM 18/30 · CL 22/30» (vacío ⇒ "")
  seccionesTitulo: string; // nombres COMPLETOS + cifra, para el title/aria
  sinDesglose: number;
};

export function derivarCifrasFila(
  cifras: {
    secciones: readonly SeccionAgregadaResumen[];
    sinDesglose: number;
    enviadasAlumnoIds: readonly AlumnoId[];
  },
  roster: { alumnoIds: readonly AlumnoId[]; deTotal: number },
): CifrasFilaResuelta {
  const part = participacionDe(cifras.enviadasAlumnoIds, roster.alumnoIds);
  const { seccionesTexto, seccionesTitulo } = textoAciertosPorSeccion(
    cifras.secciones,
  );
  return {
    participacion: {
      completaron: part.completaron,
      deTotal: roster.deTotal,
      fuerasDeRoster: part.fuerasDeRoster,
    },
    seccionesTexto,
    seccionesTitulo,
    sinDesglose: cifras.sinDesglose,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La estructura de la pantalla (bloques, ciclos, filtros) — corre en el CLIENTE
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETA_TURNO: Record<string, string> = {
  matutino: "Matutino",
  vespertino: "Vespertino",
  sabatino: "Sabatino",
};
const ORDEN_TURNO: Record<string, number> = {
  matutino: 0,
  vespertino: 1,
  sabatino: 2,
};

export type GrupoDeCatalogo = {
  grupoId: GrupoId;
  nombre: string;
  ciclo: string | null;
  turno: string | null;
  activo: boolean;
};

export type OpcionCiclo = { valor: string; etiqueta: string };
export type OpcionGrupo = { valor: string; etiqueta: string };
export type BloqueResumen = {
  grupoId: GrupoId;
  titulo: string;
  inactivo: boolean;
};

export type EstructuraResumen = {
  opcionesCiclo: OpcionCiclo[];
  /** El value de ciclo REALMENTE aplicado (el seleccionado si es válido, o el default). */
  cicloEfectivo: string;
  opcionesGrupo: OpcionGrupo[];
  bloques: BloqueResumen[]; // los de la página visible
  paginaBloques: number; // acotada a [1, total]
  totalPaginasBloques: number;
};

/** El value codificado de ciclo de un grupo (DOM-safe, inyectivo). */
function valorCiclo(g: GrupoDeCatalogo): string {
  return codificarCiclo(g.ciclo);
}

/**
 * Deriva TODA la estructura visible del Resumen a partir del catálogo de grupos y los
 * filtros del cliente. Puro y determinista (órdenes totales hasta el id, para el E2E).
 *
 * ══ Ciclo default = el MÁS RECIENTE, aunque esté vacío ══ (decisión de producto, 2026-07-23).
 * Los ciclos reales se ordenan DESC (`localeCompare` numérico); «Sin ciclo» va al final. El
 * default es la primera opción — un ciclo nuevo sin aplicaciones puede ser el default y
 * mostrar sus bloques vacíos honestos; la administradora cambia el Select para ver otro.
 *
 * ══ Bloques = TODOS los grupos del ciclo, activos e inactivos, vacíos incluidos ══ La
 * paginación opera sobre el conjunto FINAL determinista, así que ninguna página puede
 * quedar falsamente vacía por ocultar inactivos a posteriori (hallazgo M2 del 3er dictamen).
 *
 * ══ Etiquetas duplicadas del legado ══ Dos grupos con el mismo «{nombre} — Ciclo {ciclo}»
 * (la unicidad canónica solo rige a los escritores nuevos) se DESAMBIGUAN de forma
 * determinista: sufijo « · {turno}»; si aún idénticos, « · {sufijo del id}».
 */
export function derivarEstructura(
  catalogo: { grupos: readonly GrupoDeCatalogo[] },
  filtros: { cicloSel: string; grupoSel: string; paginaBloques: number },
): EstructuraResumen {
  // ── Opciones de ciclo (reales desc + «Sin ciclo» al final) ──────────────────
  const ciclosReales = new Set<string>();
  let haySinCiclo = false;
  for (const g of catalogo.grupos) {
    if (g.ciclo === null) haySinCiclo = true;
    else ciclosReales.add(g.ciclo);
  }
  const opcionesCiclo: OpcionCiclo[] = [...ciclosReales]
    .sort((a, b) => b.localeCompare(a, "es", { numeric: true }))
    .map((c) => ({ valor: codificarCiclo(c), etiqueta: c }));
  if (haySinCiclo) {
    opcionesCiclo.push({ valor: codificarCiclo(null), etiqueta: "Sin ciclo" });
  }

  const cicloDefault = opcionesCiclo[0]?.valor ?? "";
  const cicloEfectivo =
    filtros.cicloSel !== "" &&
    opcionesCiclo.some((o) => o.valor === filtros.cicloSel)
      ? filtros.cicloSel
      : cicloDefault;

  // ── Grupos del ciclo, ordenados (nombre → turno → id) ───────────────────────
  const gruposDelCiclo = catalogo.grupos
    .filter((g) => valorCiclo(g) === cicloEfectivo)
    .slice()
    .sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre, "es") ||
        (ORDEN_TURNO[a.turno ?? ""] ?? 9) - (ORDEN_TURNO[b.turno ?? ""] ?? 9) ||
        cmpId(a.grupoId, b.grupoId),
    );

  // ── Desambiguación determinista de etiquetas ────────────────────────────────
  const tituloBase = (g: GrupoDeCatalogo) =>
    g.ciclo === null ? g.nombre : `${g.nombre} — Ciclo ${g.ciclo}`;
  const tituloConTurno = (g: GrupoDeCatalogo) =>
    g.turno ? `${tituloBase(g)} · ${ETIQUETA_TURNO[g.turno] ?? g.turno}` : tituloBase(g);
  const conteoBase = new Map<string, number>();
  for (const g of gruposDelCiclo) {
    conteoBase.set(tituloBase(g), (conteoBase.get(tituloBase(g)) ?? 0) + 1);
  }
  const conteoConTurno = new Map<string, number>();
  for (const g of gruposDelCiclo) {
    if ((conteoBase.get(tituloBase(g)) ?? 0) > 1) {
      conteoConTurno.set(
        tituloConTurno(g),
        (conteoConTurno.get(tituloConTurno(g)) ?? 0) + 1,
      );
    }
  }
  const etiquetaDe = (g: GrupoDeCatalogo): string => {
    if ((conteoBase.get(tituloBase(g)) ?? 0) <= 1) return tituloBase(g);
    if ((conteoConTurno.get(tituloConTurno(g)) ?? 0) <= 1) return tituloConTurno(g);
    return `${tituloConTurno(g)} · ${g.grupoId.slice(-4)}`;
  };

  const opcionesGrupo: OpcionGrupo[] = [
    { valor: "", etiqueta: "Todos los grupos" },
    ...gruposDelCiclo.map((g) => ({ valor: g.grupoId, etiqueta: etiquetaDe(g) })),
  ];

  // ── Filtro de grupo + paginación de bloques ─────────────────────────────────
  const visibles =
    filtros.grupoSel !== "" &&
    gruposDelCiclo.some((g) => g.grupoId === filtros.grupoSel)
      ? gruposDelCiclo.filter((g) => g.grupoId === filtros.grupoSel)
      : gruposDelCiclo;
  const totalPaginasBloques = Math.max(
    1,
    Math.ceil(visibles.length / PAGINA_BLOQUES),
  );
  const paginaAcotada = Math.min(
    Math.max(1, filtros.paginaBloques),
    totalPaginasBloques,
  );
  const bloques: BloqueResumen[] = visibles
    .slice((paginaAcotada - 1) * PAGINA_BLOQUES, paginaAcotada * PAGINA_BLOQUES)
    .map((g) => ({
      grupoId: g.grupoId,
      titulo: etiquetaDe(g),
      inactivo: !g.activo,
    }));

  return {
    opcionesCiclo,
    cicloEfectivo,
    opcionesGrupo,
    bloques,
    paginaBloques: paginaAcotada,
    totalPaginasBloques,
  };
}
