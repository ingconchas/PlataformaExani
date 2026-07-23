import { ConvexError, v, type GenericId, type Infer } from "convex/values";

/**
 * MATEMÁTICA y TIEMPO del simulacro (LUI-26 · LUI-27 · LUI-104), en un módulo PURO.
 *
 * Misma razón de existir que `examenEstado.ts` y `participacion.ts`: `npx convex run` corre
 * sin identidad (lo decidible sin BD se prueba en `scripts/test-simulacro.ts` contra ESTE
 * código) y estas reglas las comparten el SERVIDOR (que califica y cierra), el CLIENTE (que
 * pinta el cronómetro y el resumen de envío) y las pruebas. Solo importa `convex/values`;
 * los ids salen de `GenericId` —el mismo tipo nominal que produce `v.id(...)`—, jamás de
 * `_generated`.
 *
 * ══ LA PARTICIÓN SERVIDOR/CLIENTE ══
 *
 * El LÍMITE del intento es del SERVIDOR y se DERIVA, no se estampa: las queries del player
 * entregan `iniciadoEn`, `duracionMin` y `cierraEn` CRUDOS más `ahoraServidor`, y tanto el
 * servidor (al validar `responder`/`enviar`) como el cliente (al pintar la cuenta regresiva
 * con su reloj anclado) llaman a `limiteDe`. Nada derivado del reloj viaja estampado —
 * una query de Convex no se re-invalida por el paso del tiempo (contrato de
 * `examenEstado.estadoDeVentana`).
 *
 * Convex rechaza GUIONES en las rutas de módulo: de ahí el camelCase del archivo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cotas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Techo de intentos por SERIE — (asignación, alumna) para los asignados, (examen, alumna)
 * para los directos. LUI-104 dice «repasos ilimitados mientras la ventana esté abierta»:
 * eso es política de PRODUCTO, y 30 (1 diagnóstico + 29 repasos) la respeta en cualquier uso
 * real. Técnicamente es lo que hace ACOTADA la sonda de numeración de `iniciarIntento`
 * (`take(MAX + 1)`) y demostrable el conteo de repasos de «Mis exámenes» — un escritor sin
 * techo no es auditable. Techo APROBADO por el dueño del producto (2026-07-22).
 */
export const MAX_INTENTOS_POR_SERIE = 30;

/**
 * Filas de asignación que «Mis exámenes» procesa por rama de destino. El corte es
 * MONÓTONO Y SEGURO: ambas ramas leen `.order("desc")` por `cierraEn`, así que las VIVAS
 * (`cierraEn > ahora`) encabezan siempre la página; y las vivas están acotadas por las
 * fronteras de escritura de `asignar` (30 por grupo · 30 por alumna), muy por debajo de
 * estos topes ⇒ **lo omitido es SIEMPRE historial ya cerrado**, jamás un examen presentable.
 * El desborde igual se REPORTA (`historialGrupoIncompleto` / `directasIncompletas`): la
 * pantalla lo dice, nunca finge una lista completa.
 */
export const MAX_FILAS_MIS_EXAMENES_GRUPO = 120;
export const MAX_FILAS_MIS_EXAMENES_DIRECTAS = 60;

/**
 * Intentos que `panel.resumen` lee POR ASIGNACIÓN y por rango de `by_asignacion_numero`
 * (uno para los diagnósticos `numeroIntento === 1`, otro para el legado sin campo).
 *
 * Existe porque el promedio del panel NO puede coleccionar la tabla grande: con repasos, una
 * asignación acumula alumnas × intentos, y 5 asignaciones × 200 alumnas × 30 intentos
 * rebasaría los 32,000 documentos por transacción de Convex. Seleccionando por RANGO solo
 * los diagnósticos, el peor caso contractual es 5 × (400+1) × 2 ≈ 4,010 documentos.
 *
 * ⚠️ No hay frontera de escritura que limite las alumnas por asignación (`alumnasActivasDeGrupo`
 * colecciona el roster), así que el centinela ES alcanzable con datos válidos. Por eso el
 * desborde NO se promedia: ver `promedioDeAsignacion`.
 */
export const MAX_INTENTOS_PANEL_POR_ASIGNACION = 400;

// ─────────────────────────────────────────────────────────────────────────────
// Puntaje (LUI-27)
// ─────────────────────────────────────────────────────────────────────────────

/** Escala EXANI del PRD: 700–1300. `calcularPuntaje` interpola el rango completo. */
export const PUNTAJE_BASE = 700;
export const PUNTAJE_RANGO = 600;
export const PUNTAJE_MAX = PUNTAJE_BASE + PUNTAJE_RANGO;

/**
 * `puntaje = 700 + (aciertos × 600 ÷ N)`, **EXACTO** (regla de negocio del PRD: «se almacena
 * exacto y se muestra redondeado»). N es el número de reactivos VIVOS del examen; las
 * preguntas sin responder no suman aciertos, así que cuentan como incorrectas por
 * construcción — no hace falta contarlas aparte.
 *
 * El double resultante casi nunca es entero (600/90 = 6.666…): se PERSISTE tal cual y el
 * único redondeo del sistema es `redondearPuntaje`, en el borde de presentación. Guardar el
 * redondeo destruiría información que LUI-28 (desglose y comparativas) necesita.
 *
 * LANZA con `n <= 0`: un puntaje «sobre cero preguntas» no existe. El llamador debe
 * ramificar ANTES (ver `finalizarIntento`, que cierra sin calificación en ese caso
 * patológico en vez de dejar a la alumna atrapada en un intento que no puede enviarse).
 */
export function calcularPuntaje(aciertos: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConvexError("No se puede calificar un examen sin reactivos.");
  }
  return PUNTAJE_BASE + (aciertos * PUNTAJE_RANGO) / n;
}

/** El ÚNICO redondeo del sistema (presentación). Compartido servidor/cliente/pruebas para
 *  que la card de «Mis exámenes», la pantalla de resultado y el oráculo del E2E no puedan
 *  discrepar en un punto. */
export function redondearPuntaje(puntaje: number): number {
  return Math.round(puntaje);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiempo del intento (LUI-26 · LUI-27)
// ─────────────────────────────────────────────────────────────────────────────

/** Umbral de la ALERTA visual del cronómetro (Diseño 25: banner «Quedan 5 minutos» + chip
 *  naranja). Es también una FRONTERA del reloj anclado del cliente: el timer despierta
 *  exactamente ahí, sin sondear. */
export const ALERTA_TIEMPO_MS = 5 * 60_000;

/**
 * Código del rechazo por vencimiento (LUI-27). El CLIENTE ramifica por él —no por el
 * texto— para saltar a la pantalla terminal.
 *
 * Vive en este módulo PURO y no junto a la mutation que lo lanza: `convex/player.ts`
 * define funciones de Convex, e importarlo desde el navegador arrastraría código de
 * servidor al bundle (el propio cliente de Convex lo advierte y anuncia que fallará).
 */
export const CODIGO_TIEMPO_AGOTADO = "TIEMPO_AGOTADO";

/**
 * Instante en que el intento VENCE. Es una CONSTANTE del intento desde que se crea —lo que
 * hace válido agendar su cierre durable en ese mismo momento (`player.cerrarVencido`)—
 * porque la cadena del candado de LUI-20 congela sus dos insumos:
 *
 *   · `duracionMin` solo se edita en BORRADOR (`examenes.actualizar`) y un examen con
 *     asignación o intento no puede volver a borrador (`despublicar` → `compromisosDe`);
 *   · `cierraEn` solo desaparece por `asignaciones.cancelar`, que exige ventana PROGRAMADA
 *     y sin intentos — con un intento vivo la fila es inmutable.
 *
 * **RECORTE al cierre de la ventana** (decisión de producto, 2026-07-22): quien inicia a 20
 * minutos del cierre dispone de esos 20, no de la duración completa. Así nada vive después
 * de `cierraEn` — coherente con las «vivas» del panel del instructor y con «Mis exámenes»,
 * donde una ventana cerrada jamás ofrece continuar. Los intentos DIRECTOS (sin asignación,
 * «práctica libre») no tienen ventana: `cierraEn = null` ⇒ sin recorte.
 */
export function limiteDe(
  iniciadoEn: number,
  duracionMin: number,
  cierraEn?: number | null,
): number {
  const porDuracion = iniciadoEn + duracionMin * 60_000;
  return cierraEn == null ? porDuracion : Math.min(porDuracion, cierraEn);
}

/**
 * ¿El intento sigue vigente? Intervalo SEMIABIERTO `[iniciadoEn, limite)`: en
 * `ahora === limite` YA venció — misma convención que `estadoDeVentana`, así que todo
 * instante cae en exactamente un estado y las dos fronteras del sistema (ventana y
 * cronómetro) no pueden discrepar en el borde.
 *
 * Sin tolerancia del lado del servidor: el margen de red es responsabilidad del cliente
 * (que dispara el envío con su reloj anclado antes del límite), igual que
 * `MIN_VIGENCIA_RESTANTE_MS` reparte ese trabajo en `asignar`.
 */
export function dentroDeTiempo(ahora: number, limite: number): boolean {
  return ahora < limite;
}

/** Cuenta regresiva «HH:MM:SS» del chip del `ExamHeader`. Se redondea hacia ARRIBA (a 999 ms
 *  del final aún se lee «00:00:01»: el cronómetro llega a cero cuando el tiempo se acabó de
 *  verdad) y nunca baja de cero — un restante negativo es «00:00:00», no «-1». */
export function formatearHms(restanteMs: number): string {
  const total = Math.max(0, Math.ceil(restanteMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  return `${dd(h)}:${dd(m)}:${dd(s)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Forma de cierre (LUI-27)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CÓMO terminó un intento. Es un campo APARTE de `estado`, no un tercer literal de
 * `intentos.estado`: `participacion.ESTADOS_INTENTO` declara que las DOS sondas del panel
 * del instructor son la enumeración exhaustiva de ese campo, y un tercer estado obligaría a
 * revisarlas (y a `examenes.listar`, que asume `enviado ∨ en_curso ≡ cualquier intento`).
 * Aquí no se toca nada de eso: `enviado` sigue siendo `enviado`, con una etiqueta de cómo.
 *
 * La forma la DERIVA el servidor comparando su reloj congelado contra `limiteDe` — jamás
 * llega como argumento del cliente: sería dejar que el navegador elija la etiqueta.
 *
 * ⚠️ **FUENTE ÚNICA**: `schema.ts` usa ESTE validador (precedente `estadoExamenValidator`).
 * Con la unión duplicada allá, una forma nueva no rompería `normalizarFormaCierre` ni las
 * pantallas que ramifican sobre ella, y el caso quedaría sin copy en silencio.
 */
export const formaCierreValidator = v.union(
  v.literal("manual"),
  v.literal("tiempo_agotado"),
);

export type FormaCierre = Infer<typeof formaCierreValidator>;

/** AUSENTE = `"manual"`: un intento `enviado` anterior a LUI-27 se entregó a mano (el único
 *  camino que existía). Mismo contrato que `normalizarTipo` y `contenidoFormato` ausente. */
export function normalizarFormaCierre(
  forma: FormaCierre | undefined,
): FormaCierre {
  return forma ?? "manual";
}

// ─────────────────────────────────────────────────────────────────────────────
// Techo de la serie (LUI-104)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda del techo de repasos. `iniciarIntento` le pasa el conteo ACOTADO
 * `take(MAX_INTENTOS_POR_SERIE + 1).length` de los intentos ENVIADOS de la serie, y el
 * siguiente número es `enviados + 1`.
 *
 * ⚠️ La comparación es `>=`, no `>`: con 30 enviados el siguiente sería el 31 y NO debe
 * nacer. La frontera exacta (28 pasa, 29 pasa, 30 rechaza) la fija `test-simulacro.ts`.
 */
export function validarTechoSerie(tituloExamen: string, enviados: number): void {
  if (enviados >= MAX_INTENTOS_POR_SERIE) {
    throw new ConvexError(
      `Alcanzaste el máximo de intentos de «${tituloExamen}» ` +
        `(${MAX_INTENTOS_POR_SERIE}, contando el diagnóstico y los repasos).`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estructura de la pantalla del player
// ─────────────────────────────────────────────────────────────────────────────

export type SeccionId = GenericId<"secciones">;
export type AreaId = GenericId<"areasTematicas">;
export type ReactivoId = GenericId<"reactivos">;
export type AlumnoId = GenericId<"users">;

/** Tramo CONTIGUO de preguntas de una misma sección, con su rango 1-based inclusivo
 *  (lo que pinta el encabezado del mapa: «Pensamiento matemático · 1–30»). */
export type RachaDeSeccion = {
  seccionId: SeccionId | null; // `null` = pregunta fantasma (reactivo borrado)
  desde: number;
  hasta: number;
};

/**
 * Las rachas del examen, derivadas de la SECUENCIA real de items (no de la estructura
 * declarada): agrupa posiciones consecutivas con la misma sección. Para un examen con
 * estructura (LUI-21) coincide exactamente con sus secciones declaradas —el invariante del
 * constructor garantiza a lo más una racha por sección, en orden—; para un examen legado sin
 * estructura describe lo que realmente hay, sin inventar.
 *
 * Una pregunta fantasma (`seccionId: null`) CORTA la racha en vez de heredar la sección
 * anterior: fingir continuidad sobre un hueco es exactamente la clase de dato fabricado que
 * este repo no produce.
 */
export function rachasDeSecciones(
  items: readonly { seccionId: SeccionId | null }[],
): RachaDeSeccion[] {
  const rachas: RachaDeSeccion[] = [];
  items.forEach((item, i) => {
    const ultima = rachas[rachas.length - 1];
    if (
      ultima &&
      ultima.seccionId !== null &&
      ultima.seccionId === item.seccionId
    ) {
      ultima.hasta = i + 1;
      return;
    }
    rachas.push({ seccionId: item.seccionId, desde: i + 1, hasta: i + 1 });
  });
  return rachas;
}

/**
 * El detalle de la confirmación de envío (Diseño 25). Vive aquí y no en el JSX para que el
 * singular/plural sea PROBABLE sin montar la pantalla: el copy del mock («Las 3 sin responder
 * cuentan como incorrectas») es plural y la rama de una sola pendiente necesita otra frase.
 */
export function resumenConfirmacion(
  contestadas: number,
  total: number,
): string {
  const faltantes = Math.max(0, total - contestadas);
  const base = `${contestadas} de ${total} contestadas.`;
  if (faltantes === 0) return `${base} Ya respondiste todas.`;
  if (faltantes === 1) return `${base} La que falta cuenta como incorrecta.`;
  return `${base} Las ${faltantes} sin responder cuentan como incorrectas.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Desglose del cierre (LUI-27 · contrato de datos de LUI-6)
// ─────────────────────────────────────────────────────────────────────────────

/** Validadores del desglose PERSISTIDO en `intentos` — el schema usa estos (fuente única,
 *  igual que `formaCierreValidator`), así que cambiar la forma del conteo no puede olvidarse
 *  en uno de los dos lados. */
export const conteoPorSeccionValidator = v.object({
  seccionId: v.id("secciones"),
  aciertos: v.number(),
  total: v.number(),
});
export const conteoPorAreaValidator = v.object({
  areaId: v.id("areasTematicas"),
  aciertos: v.number(),
  total: v.number(),
});

export type ConteoPorSeccion = Infer<typeof conteoPorSeccionValidator>;
export type ConteoPorArea = Infer<typeof conteoPorAreaValidator>;

/**
 * Aciertos por SECCIÓN y por ÁREA temática, calculados en el cierre con los reactivos y las
 * respuestas que `finalizarIntento` ya tiene en memoria (cero lecturas extra).
 *
 * Se persisten CONTEOS, no porcentajes: el porcentaje es presentación (LUI-28 lo pinta) y
 * guardar el cociente perdería el denominador, que es justo lo que hace comparables dos
 * intentos de exámenes distintos. Cada reactivo cae en EXACTAMENTE una sección y un área
 * (clasificación obligatoria del schema), así que `Σ total = N` — invariante que la prueba
 * pura verifica.
 *
 * Los fantasmas (reactivos borrados) NO entran: no están en la lista que recibe. Coherente
 * con `N` de `calcularPuntaje`, que también los excluye.
 */
export function desglosePorClasificacion(
  reactivos: readonly {
    id: ReactivoId;
    seccionId: SeccionId;
    areaId: AreaId;
  }[],
  correctas: ReadonlySet<string>,
): { porSeccion: ConteoPorSeccion[]; porArea: ConteoPorArea[] } {
  const secciones = new Map<string, ConteoPorSeccion>();
  const areas = new Map<string, ConteoPorArea>();
  for (const r of reactivos) {
    const acierto = correctas.has(r.id) ? 1 : 0;
    const s = secciones.get(r.seccionId);
    if (s) {
      s.aciertos += acierto;
      s.total += 1;
    } else {
      secciones.set(r.seccionId, {
        seccionId: r.seccionId,
        aciertos: acierto,
        total: 1,
      });
    }
    const a = areas.get(r.areaId);
    if (a) {
      a.aciertos += acierto;
      a.total += 1;
    } else {
      areas.set(r.areaId, { areaId: r.areaId, aciertos: acierto, total: 1 });
    }
  }
  return { porSeccion: [...secciones.values()], porArea: [...areas.values()] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analítica del PRIMER intento (LUI-104) — la regla transversal, en un solo sitio
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo que la analítica necesita de un intento. Deliberadamente NO es `Doc<"intentos">`:
 *  el módulo es puro y la forma exacta del documento no le incumbe. */
export type IntentoAnalitico = {
  alumnoId: AlumnoId;
  estado: "en_curso" | "enviado";
  iniciadoEn: number;
  puntaje?: number;
};

/**
 * SELECTOR CANÓNICO del «intento-que-cuenta» de cada alumna (LUI-104 · LUI-30). Es LA
 * respuesta única a «¿qué intento representa a esta alumna en la analítica?»: lo consumen
 * `promedioDeAsignacion` (abajo), la tabla por alumna y la participación de Resultados del
 * examen (LUI-30) y la agregación de desgloses — si cada consumidor eligiera por su cuenta,
 * la fila podría mostrar «En curso» mientras el promedio cuenta un legado enviado de la
 * misma alumna: la clase de incoherencia que la auditoría del plan (v4→v5) prohibió.
 *
 * Recibe los DOS conjuntos que los lectores seleccionan por RANGO sobre
 * `intentos.by_asignacion_numero`: `diagnosticos` (`numeroIntento === 1`) y `legado`
 * (filas SIN el campo, pre-LUI-104; el proxy muere en la Fase C).
 *
 * TABLA DE PRECEDENCIA (cerrada en el plan v5; CALIFICADO-primero, y por eso el promedio
 * reimplementado encima es EQUIVALENTE al histórico — `test:simulacro` lo certifica):
 *   ① diagnóstico enviado CALIFICADO   ② legado enviado CALIFICADO (el más antiguo)
 *   ③ diagnóstico enviado SIN puntaje  ④ legado enviado SIN puntaje (el más antiguo)
 *   ⑤ diagnóstico `en_curso`           ⑥ legado `en_curso` (el más antiguo)
 * Dentro de un mismo rango gana el `iniciadoEn` más antiguo (empate imposible por
 * construcción en ①/③/⑤ — una alumna tiene UN intento 1 por serie—; el desempate mantiene
 * la función TOTAL ante datos manipulados a mano). Un enviado sin puntaje existe legalmente
 * (`N === 0` cierra sin calificar): cuenta como «Completado» para fila y participación,
 * pero JAMÁS aporta al promedio.
 *
 * Genérica sobre `T`: `panel` la usa con `IntentoAnalitico` pelado y LUI-30 con la
 * proyección completa (que trae el desglose) — misma selección, un solo código.
 */
export function primerIntentoPorAlumna<T extends IntentoAnalitico>(
  diagnosticos: readonly T[],
  legado: readonly T[],
): Map<AlumnoId, T> {
  const rango = (esDiagnostico: boolean, i: IntentoAnalitico): number => {
    if (i.estado === "enviado" && i.puntaje !== undefined)
      return esDiagnostico ? 1 : 2;
    if (i.estado === "enviado") return esDiagnostico ? 3 : 4;
    return esDiagnostico ? 5 : 6;
  };
  const eleccion = new Map<AlumnoId, { rango: number; intento: T }>();
  const considerar = (esDiagnostico: boolean, i: T) => {
    const r = rango(esDiagnostico, i);
    const previo = eleccion.get(i.alumnoId);
    if (
      !previo ||
      r < previo.rango ||
      (r === previo.rango && i.iniciadoEn < previo.intento.iniciadoEn)
    ) {
      eleccion.set(i.alumnoId, { rango: r, intento: i });
    }
  };
  for (const i of diagnosticos) considerar(true, i);
  for (const i of legado) considerar(false, i);
  return new Map([...eleccion].map(([alumna, e]) => [alumna, e.intento]));
}

/**
 * Promedio del DIAGNÓSTICO (intento 1) de cada alumna en una asignación — la regla
 * transversal de LUI-104: «solo el primer intento alimenta la analítica». Los repasos no
 * mueven un número, sin importar cuántos sean.
 *
 * REIMPLEMENTADO sobre `primerIntentoPorAlumna` (LUI-30, plan v5): la media corre sobre los
 * seleccionados de rango ①–② —enviados Y calificados—, que es EXACTAMENTE la población del
 * promedio histórico (diagnóstico calificado primero; si no existe, el legado calificado
 * más antiguo como proxy; los rangos ③–⑥ nunca son calificados, así que el filtro los
 * excluye igual que antes). La equivalencia no es un deseo: `test:simulacro` conserva sus
 * 53 checks IDÉNTICOS sobre esta función.
 *
 * ⚠️ `desbordado` (el centinela `take(MAX + 1)` se llenó) devuelve `{valor: null,
 * incompleto: true}` y **jamás promedia el prefijo**: un promedio calculado sobre las
 * primeras 400 filas es preciso y FALSO a la vez. `null` con `incompleto: false` significa
 * otra cosa —«sin intentos calificados»— y la pantalla las distingue: «—» vs «Datos
 * incompletos». Nunca se devuelve `0`: sería un puntaje imposible en la escala 700–1300.
 */
export function promedioDeAsignacion(entrada: {
  diagnosticos: readonly IntentoAnalitico[];
  legado: readonly IntentoAnalitico[];
  desbordado: boolean;
}): { valor: number | null; incompleto: boolean } {
  if (entrada.desbordado) return { valor: null, incompleto: true };

  const seleccion = primerIntentoPorAlumna(entrada.diagnosticos, entrada.legado);
  const puntajes = [...seleccion.values()]
    .filter((i) => i.estado === "enviado" && i.puntaje !== undefined)
    .map((i) => i.puntaje as number);
  if (puntajes.length === 0) return { valor: null, incompleto: false };
  return {
    valor: redondearPuntaje(
      puntajes.reduce((s, p) => s + p, 0) / puntajes.length,
    ),
    incompleto: false,
  };
}
