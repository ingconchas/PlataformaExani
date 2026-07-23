import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { materialValidator } from "./material";
import { estadoExamenValidator, tipoExamenValidator } from "./examenEstado";
import { seccionDeExamenValidator } from "./constructorExamen";
import {
  conteoPorAreaValidator,
  conteoPorSeccionValidator,
  formaCierreValidator,
} from "./simulacro";

/**
 * Modelo de datos inicial — Plataforma Exani II (UNX Simuladores).
 *
 * Punto de partida derivado del PRD v2 y del UNX Design System v1.2. Refínalo
 * conforme construyas cada pantalla (añade/ajusta campos e índices).
 *
 * Incluye `authTables` de Convex Auth (acceso por correo + contraseña —
 * LUI-8 login, LUI-103 invitación y recuperación). authTables aporta las
 * tablas `users`, `authAccounts`, `authSessions`, etc.
 *
 * Roles: `admin` e `instructor` usan el panel institucional; `alumno` usa la
 * app de la alumna. El rol vive en `perfiles`, ligado a `users`.
 */
export default defineSchema({
  // ── Autenticación (Convex Auth) ──────────────────────────────────────────
  ...authTables,

  // Perfil y rol de cada usuario. Extiende la tabla `users` de authTables.
  perfiles: defineTable({
    userId: v.id("users"),
    rol: v.union(
      v.literal("admin"),
      v.literal("instructor"),
      v.literal("alumno"),
    ),
    nombre: v.string(),
    apellidos: v.optional(v.string()),
    telefono: v.optional(v.string()),
    grupoId: v.optional(v.id("grupos")), // alumno: grupo al que pertenece
    materia: v.optional(v.string()), // instructor: materia que imparte (etiqueta, LUI-12)
    activo: v.boolean(),
    // Último acceso (LUI-6 `ultimo_acceso_en`). El login lo actualiza en cada
    // ingreso (Convex Auth · `beforeSessionCreation`, Entrega 2 de authz).
    ultimoAccesoEn: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_rol", ["rol"])
    .index("by_grupo", ["grupoId"]),

  // Tokens de un solo uso para establecer/restablecer contraseña por correo
  // (LUI-103). La URL del correo lleva el token en claro; aquí SOLO se guarda su
  // hash SHA-256 (una fuga de BD no permite usar los enlaces). `tipo` separa la
  // invitación (72 h) de la recuperación (60 min). Se consume marcando `usadoEn`.
  tokensAcceso: defineTable({
    userId: v.id("users"),
    tipo: v.union(v.literal("invitacion"), v.literal("recuperacion")),
    tokenHash: v.string(), // SHA-256 (hex) del token que viaja en la URL
    expiraEn: v.number(), // epoch ms
    usadoEn: v.optional(v.number()), // epoch ms del consumo (uso único)
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // Cubetas de tokens del rate limiting propio (LUI-103, Entrega 2). Una fila por
  // `clave`; la AUSENCIA de fila significa «cubeta llena» — por eso el cron puede
  // borrar filas vencidas sin alterar la semántica. `tokens` es float: la recarga
  // es fraccionaria y proporcional al tiempo desde `recargadoEn`. `expiraEn` es el
  // instante en que la cubeta vuelve a estar llena: a partir de ahí la fila ya no
  // tiene efecto y es basura borrable.
  //
  // La clave NUNCA contiene un correo: se usa el `userId` (ver `cuotas.ts`), así
  // que un atacante que inventa direcciones no crea filas ni deja rastro de PII.
  cuotas: defineTable({
    clave: v.string(), // "recuperacion:global" | "recuperacion:usuario:<userId>" | "reenvio:perfil:<perfilId>"
    tokens: v.number(),
    recargadoEn: v.number(), // epoch ms del último consumo (base de la recarga)
    expiraEn: v.number(), // epoch ms en que la cubeta vuelve a estar llena
  })
    .index("by_clave", ["clave"])
    .index("by_expira", ["expiraEn"]),

  // Bitácora de correos enviados (LUI-103, Entrega 2). Forense para los caminos
  // ASÍNCRONOS (`alumnos.crear` / `usuarios.crear` agendan el envío y no pueden
  // reportar un fallo posterior al admin). Se escribe en TODOS los desenlaces:
  // éxito, fallo de configuración, timeout, 4xx/5xx y transporte desconocido.
  //
  // NUNCA guarda el enlace, el cuerpo del correo ni la API key: el enlace es una
  // credencial viva. `error` lleva solo `name`/`message` del proveedor.
  enviosCorreo: defineTable({
    para: v.string(),
    asunto: v.string(),
    estado: v.union(
      v.literal("enviado"),
      v.literal("fallido"),
      v.literal("dev"), // transporte dev: no salió correo real
    ),
    resendId: v.optional(v.string()),
    error: v.optional(v.string()),
    creadoEn: v.number(),
  }).index("by_creado", ["creadoEn"]),

  // Grupos de la institución. Los instructores (uno o varios, típicamente por
  // materia) se ligan vía la tabla de unión `grupoInstructores` (LUI-12 / PRD v2).
  grupos: defineTable({
    nombre: v.string(),
    // Texto libre (p. ej. "2026-B"). La identidad del grupo es (nombre + ciclo).
    ciclo: v.optional(v.string()),
    // Opcional por migración: los grupos existentes no lo traían. El formulario y
    // las mutations lo exigen para altas/ediciones nuevas (endurecer a requerido
    // es un follow-up cuando el dato sea uniforme).
    turno: v.optional(
      v.union(
        v.literal("matutino"),
        v.literal("vespertino"),
        v.literal("sabatino"),
      ),
    ),
    activo: v.boolean(),
  }),

  // Unión grupo↔instructor (la «GrupoInstructor» del PRD): un grupo tiene 1+
  // instructores; un instructor puede estar en varios grupos. `instructorId` es
  // el userId del instructor (consistente con el resto del modelo).
  grupoInstructores: defineTable({
    grupoId: v.id("grupos"),
    instructorId: v.id("users"),
  })
    .index("by_grupo", ["grupoId"])
    .index("by_instructor", ["instructorId"]),

  // ── Temario institucional (LUI-18) ───────────────────────────────────────
  // Jerarquía de TRES niveles: Sección → Área temática → Subtema. Es el contrato
  // de LUI-6, y son tres tablas y no un árbol auto-referente por una razón dura:
  // `reactivos` lleva las tres referencias a la vez, y con una tabla única las
  // tres serían `v.id("temas")` — el mismo tipo — así que intercambiarlas
  // compilaría sin una queja. Aquí `Id<"secciones">` e `Id<"subtemas">` son
  // disjuntos y ese error es imposible de escribir. Además la profundidad es fija
  // (Diseño 14 tiene 3 columnas; Diseño 15, 3 selects) y `tipo` solo existe en el
  // nivel 1.
  //
  // `reactivosCount` va DENORMALIZADO: Convex no tiene `count()` que evite leer
  // los documentos, así que contar leyendo `reactivos` haría que esta pantalla se
  // suscribiera a la tabla entera (megabytes re-leídos en cada escritura de
  // cualquier reactivo) y reventaría el tope de 16 MiB por transacción a ~8 000
  // reactivos (el tope de 32 000 docs solo muerde bajo 512 B/doc; un reactivo
  // pesa 1–4 KB).
  // Se impone AHORA porque hoy hay cero escritores de reactivos que retrofitear.
  // La deriva es cosmética: el gate de borrado usa una sonda `.first()`, no el
  // contador, y `temario:recalcularContadores` lo repara.
  //
  // El `estado` de LUI-6 se implementa como `activo`, siguiendo a `grupos.activo`
  // y `perfiles.activo`. Desviación de nombre, no de semántica.
  secciones: defineTable({
    nombre: v.string(),
    tipo: v.union(v.literal("nucleo"), v.literal("modulo")),
    activo: v.boolean(),
    orden: v.number(),
    reactivosCount: v.number(),
  }).index("by_tipo_orden", ["tipo", "orden"]),

  areasTematicas: defineTable({
    seccionId: v.id("secciones"),
    nombre: v.string(),
    activo: v.boolean(),
    orden: v.number(),
    reactivosCount: v.number(),
  }).index("by_seccion_orden", ["seccionId", "orden"]),

  subtemas: defineTable({
    areaId: v.id("areasTematicas"),
    nombre: v.string(),
    activo: v.boolean(),
    orden: v.number(),
    reactivosCount: v.number(),
  }).index("by_area_orden", ["areaId", "orden"]),

  // Lecturas: pasajes que agrupan varios reactivos.
  // Lecturas: pasajes que agrupan un BLOQUE de reactivos contiguo y ordenado (LUI-17).
  //
  // ⚠️ FASE A (capa de compatibilidad forward-only). Los campos nuevos entran como
  // OPCIONALES y `reactivos.lecturaId` sigue vivo, para que este schema sea un SUPERSET
  // del anterior: así, si hubiera que revertir el comportamiento de LUI-17 después de que
  // alguien creara lecturas, el schema desplegado sigue aceptando los datos escritos. Las
  // mutations son la autoridad de obligatoriedad mientras tanto. La Fase C (entrega
  // posterior, tras rodaje en prod) los pasa a requeridos y retira `lecturaId`/`by_lectura`.
  lecturas: defineTable({
    titulo: v.string(), // TEXTO PLANO, nunca HTML
    contenido: v.string(), // texto base, HTML saneado
    // Mismo contrato que `reactivos.contenidoFormato`: AUSENTE = texto plano LEGADO.
    contenidoFormato: v.optional(v.literal("html")),
    // Clasificación DERIVADA de `subtemaId` con `temario.resolverClasificacion`; NUNCA se
    // acepta la terna del cliente (misma razón que en `reactivos`, más abajo). Es la ÚNICA
    // fuente de la clasificación de TODO el bloque: sus preguntas la copian, no la eligen.
    seccionId: v.optional(v.id("secciones")),
    areaId: v.optional(v.id("areasTematicas")),
    subtemaId: v.optional(v.id("subtemas")),
    // DEFAULT que prellena el drawer; cada pregunta conserva la suya y puede ajustarla.
    dificultad: v.optional(
      v.union(v.literal("facil"), v.literal("medio"), v.literal("dificil")),
    ),
    // Autoridad de permisos TAMBIÉN de sus preguntas: una pregunta de bloque hereda el
    // autor de su lectura, para que `esEditable` no pueda discrepar entre las dos.
    autorId: v.id("users"),
    activo: v.optional(v.boolean()),
  })
    .index("by_autor", ["autorId"])
    // Los TRES niveles: el gate de borrado de `temario.eliminar` sondea por subtema, área
    // Y sección. Con solo `by_subtema`, borrar un área o una sección dejaría colgando una
    // lectura SIN preguntas (invisible a la sonda de `reactivos`).
    .index("by_subtema", ["subtemaId"])
    .index("by_area", ["areaId"])
    .index("by_seccion", ["seccionId"]),

  // Banco de reactivos (preguntas de opción múltiple).
  reactivos: defineTable({
    enunciado: v.string(),
    opciones: v.array(v.object({ id: v.string(), texto: v.string() })),
    opcionCorrecta: v.string(), // id de la opción correcta
    // Clasificación denormalizada en los TRES niveles (contrato de LUI-6). Los
    // tres son REQUERIDOS: LUI-15 exige «clasificación completa», y en el Diseño
    // 14 hasta los reactivos de un módulo traen los tres llenos (ninguna fila
    // tiene «—»). «Los módulos son planos HASTA que se les den de alta áreas»
    // describe un estado transitorio del temario, no una clasificación parcial:
    // un módulo plano todavía no admite reactivos.
    //
    // Que sean obligatorios también salva la aritmética del contador: cada
    // reactivo cae en EXACTAMENTE una hoja, así que `count(sección) = Σ
    // count(áreas)` — la invariante «32 = 14+10+8» del Diseño 11.
    //
    // ⚠️ NUNCA los escribas desde el cliente: la API acepta solo `subtemaId` y
    // deriva los otros dos con `temario.resolverClasificacion`. Aceptar la terna
    // permitiría un reactivo cuya sección no es la de su subtema → el contador del
    // árbol y el filtro del banco darían números distintos con la misma etiqueta.
    seccionId: v.id("secciones"),
    areaId: v.id("areasTematicas"),
    subtemaId: v.id("subtemas"),
    dificultad: v.union(
      v.literal("facil"),
      v.literal("medio"),
      v.literal("dificil"),
    ),
    // ⚠️ DEPRECADO (LUI-17 Fase A): lo sustituye `bloque`, que lleva la pertenencia Y el
    // orden juntos. Se conserva sin escritor durante esta fase para que el schema sea un
    // superset revertible; la Fase C lo retira junto con `by_lectura`.
    lecturaId: v.optional(v.id("lecturas")),
    // Pertenencia a un BLOQUE de lectura (LUI-17). El campo ES la pertenencia y el orden:
    // no hay un `lecturaId` suelto ni un `orden` suelto. Dos campos admitirían «orden zombi
    // sin lectura» y «pregunta en un bloque sin posición» — el mismo estado ilegal que se
    // eliminó en LUI-16 al hacer que `material` FUERA la presentación. AUSENTE = reactivo
    // LIBRE del banco.
    //
    // `orden` es 0..n-1 y se RENUMERA densamente en cada escritura: un `.index()` de Convex
    // NO es constraint único, así que empates y huecos son representables y solo la
    // disciplina de escritura (más el desempate estable al leer) los mantiene fuera.
    bloque: v.optional(
      v.object({ lecturaId: v.id("lecturas"), orden: v.number() }),
    ),
    imagenId: v.optional(v.id("_storage")), // imagen opcional (Convex file storage)
    retroalimentacion: v.optional(v.string()),
    // Formato del enunciado/explicación (LUI-15 E2): "html" = HTML saneado; AUSENTE =
    // texto plano LEGADO (E1/seed). `obtener` convierte el legado a HTML para el editor.
    contenidoFormato: v.optional(v.literal("html")),
    // Presentación del reactivo (LUI-16). El campo ES la unión discriminada: su presencia
    // y su `tipo` SON la presentación (`material?.tipo ?? "directa"`). AUSENTE = «pregunta
    // directa» — mismo contrato que `contenidoFormato` ausente = legado, así que no hay
    // migración ni backfill. Dos campos (`presentacion` + `material`) admitirían estados
    // ilegales: «columnas» sin material, o «directa» con material zombi.
    //
    // ⚠️ La bifurcación de `contenidoFormato` NO aplica al material: sus renglones son
    // SIEMPRE HTML saneado (`convex/material.ts`), sin importar `contenidoFormato`, que
    // describe exclusivamente `enunciado` y `retroalimentacion`. No existe material legado.
    //
    // ⚠️ Las etiquetas (1,2,3… / a,b,c…) son POSICIONALES: se derivan del índice al pintar,
    // NO se persiste un id por renglón (sería una segunda fuente de verdad que puede
    // contradecir la posición). Consecuencia asumida: quitar un renglón desplaza la
    // numeración y las opciones que la referencian («1b, 2c, 3a») quedan descuadradas —
    // el servidor no puede detectarlo porque las opciones son texto libre. El formulario
    // pide confirmación al quitar; el candado de edición protege lo ya asignado.
    material: v.optional(materialValidator),
    autorId: v.id("users"),
    activo: v.boolean(),
  })
    // Los tres índices existen para los filtros EN CASCADA de LUI-14: filtrar por
    // sección con solo `subtemaId` obligaría a resolver todos los subtemas y hacer
    // un OR. También sirven de sonda O(1) para el gate de borrado del temario.
    .index("by_seccion", ["seccionId"])
    .index("by_area", ["areaId"])
    .index("by_subtema", ["subtemaId"])
    .index("by_lectura", ["lecturaId"]) // DEPRECADO con `lecturaId`; se retira en la Fase C
    // El bloque de una lectura, YA ORDENADO, en una sola consulta indexada.
    .index("by_bloque", ["bloque.lecturaId", "bloque.orden"])
    .index("by_autor", ["autorId"])
    // Exclusividad 1 blob ↔ 1 reactivo + sonda del sweeper «¿este blob sigue
    // referenciado?» en O(1), sin escanear la tabla (LUI-15 E3).
    .index("by_imagen", ["imagenId"]),

  // Exámenes armados con el constructor (conjunto ordenado de reactivos).
  //
  // ⚠️ FASE A de LUI-20 (superset forward-only, misma disciplina que LUI-17 y `DEPLOY.md`).
  // `estado` ENSANCHA su unión y `tipo` entra OPCIONAL: el schema desplegado acepta todo lo
  // que aceptaba antes, así que sigue siendo revertible MIENTRAS ningún documento lleve
  // datos nuevos — y en la Fase A ninguna mutation los escribe. La Fase C lo endurece
  // (`tipo` requerido, tras backfill).
  //
  // ⚠️ FASE A de LUI-21, misma disciplina: `secciones` entra OPCIONAL y ningún escritor
  // existe todavía; los de la Entrega B (crear/actualizar/crear-directo) la escriben
  // siempre. AUSENTE = examen legado sin estructura declarada. El invariante completo
  // (rachas contiguas por sección, en el orden declarado) vive en `constructorExamen.ts`.
  examenes: defineTable({
    titulo: v.string(),
    descripcion: v.optional(v.string()),
    reactivoIds: v.array(v.id("reactivos")),
    // Estructura DECLARADA del examen: orden de secciones + meta opcional por sección.
    // La PERTENENCIA de cada reactivo se deriva de su clasificación, no se almacena aquí.
    secciones: v.optional(v.array(seccionDeExamenValidator)),
    duracionMin: v.number(),
    // La unión NO se declara aquí: es `examenEstado.estadoExamenValidator`. Duplicarla haría
    // que añadir un cuarto estado en este archivo no rompiera el `Record<EstadoExamen,…>` de
    // `CONGELA`, y el candado se olvidaría en silencio — el bug que LUI-20 vino a corregir.
    estado: estadoExamenValidator,
    // Simulacro general vs examen de módulo. AUSENTE = «general» (legado). Ver el docblock
    // de `tipoExamenValidator` para por qué es almacenado, discriminado y por id.
    tipo: v.optional(tipoExamenValidator),
    autorId: v.id("users"),
  })
    .index("by_autor", ["autorId"])
    .index("by_estado", ["estado"])
    // Sonda O(1) de `temario.eliminar`: «¿algún examen es de ESTA sección?». Sin ella, borrar
    // una sección de módulo sin reactivos ni lecturas dejaría el chip apuntando a un
    // fantasma. Campo ANIDADO y opcional, igual que `reactivos.by_bloque`; los documentos sin
    // `tipo` o de clase `general` se indexan como `undefined` y jamás se consultan.
    .index("by_tipo_seccion", ["tipo.seccionId"]),

  // Asignación de un examen a su DESTINO —un grupo XOR un alumno individual— con ventana
  // de aplicación (LUI-22 ensanchó el destino; antes solo grupos).
  //
  // INVARIANTE «exactamente uno»: toda fila tiene `grupoId` o `alumnoId`, jamás ambos ni
  // ninguno. El schema no puede expresar ese XOR entre opcionales, así que lo sostienen las
  // dos fronteras de `convex/asignacionDestino.ts`: los escritores solo pueden esparcir el
  // fragmento de `camposDestino` (una clave exacta) y los lectores que interpretan el
  // destino normalizan con `destinoDeFila` (ambos/ninguno → lanza). Forward-only limpio:
  // las filas pre-LUI-22 traen `grupoId` y son válidas bajo el superset sin migración.
  // `alumnoId` es `v.id("users")` por consistencia con `intentos.alumnoId` y `creadoPor`.
  //
  // Las filas son BORRABLES: `cancelar` (LUI-22) elimina una asignación SOLO si su ventana
  // sigue programada y no tiene intentos. El acumulado por examen tiene techo
  // (`MAX_ASIGNACIONES_POR_EXAMEN`, política de producto) — que REDUCE LA PENDIENTE de los
  // lectores acumulativos (`examenes.listar`, `grupos.obtener`), no los acota: ver el
  // docblock de la constante.
  //
  // El índice por alumna llegó con sus lectores, como estaba anunciado: `by_alumno_cierra`
  // lo estrenan «Mis exámenes» (LUI-25) y la frontera de vivas por alumna de `asignar`.
  asignaciones: defineTable({
    examenId: v.id("examenes"),
    grupoId: v.optional(v.id("grupos")), // destino grupo (filas legadas: siempre presente)
    alumnoId: v.optional(v.id("users")), // destino alumno individual (LUI-22)
    abreEn: v.number(), // epoch ms
    cierraEn: v.number(),
    creadoPor: v.id("users"),
    // READ-MODEL del panel del instructor (LUI-19): el título del examen,
    // estampado por `asignar` al crear la fila, para que el panel NO lea docs de
    // `examenes` (un examen legado puede cargar miles de `reactivoIds` — ver
    // `examenes.ts` — y 600 gets sin cota de bytes no caben en su presupuesto).
    // INMUTABLE por el candado de LUI-20: `asignar` exige PUBLICADO y
    // `calcularBloqueo` congela un publicado con compromiso (asignación o
    // intento) — desde la primera asignación el título ya no puede cambiar, así
    // que este espejo jamás queda rancio. ≤160 chars (cota del constructor,
    // revalidada al publicar). Opcional SOLO por el legado hipotético
    // pre-LUI-19: una fila sin el campo se OMITE del panel con el flag
    // `asignacionesLegadasOmitidas` (prod tenía 0 asignaciones al desplegarse).
    tituloExamen: v.optional(v.string()),
    // READ-MODELS de «Mis exámenes» (LUI-25), hermanos de `tituloExamen` y con EL MISMO
    // candado citado arriba: `asignar` los estampa (`reactivoIds.length` y `duracionMin` del
    // examen) y desde esa fila el examen queda comprometido, así que `examenes.actualizar`
    // —que exige BORRADOR— ya no puede moverlos. Sin ellos, la pantalla de la alumna haría
    // hasta 180 `ctx.db.get` de `examenes` (1 MiB/doc de límite duro) solo para pintar
    // «3 h · 90 preguntas»: presupuesto indefendible, la misma razón por la que nació
    // `tituloExamen`. Una fila legada sin los tres campos se OMITE de la lista (con flag) y
    // `player.iniciarIntento` la RECHAZA con mensaje propio — omitirla de la lista no
    // impediría llamar la mutation con su id.
    numReactivos: v.optional(v.number()),
    duracionMin: v.optional(v.number()),
    // El TIPO del examen (chip «Simulacro general» / «Módulo: X»), mismo candado. Se copia
    // la unión discriminada CON EL ID de la sección, jamás su nombre: las secciones se
    // renombran desde el temario (LUI-18) y un nombre copiado haría mentir al chip en
    // silencio — la razón por la que `tipoExamenValidator` almacena el id. «Mis exámenes»
    // resuelve el nombre por sección DISTINTA (docs diminutos), no por fila.
    tipoExamen: v.optional(tipoExamenValidator),
    // READ-MODEL de «aplicada» (LUI-30): instante de ALGÚN cierre registrado de esta
    // asignación. ⚠️ Contrato de LECTURA: SOLO existencia — `presente ⟺ ∃ intento
    // enviado`; el valor exacto NO alimenta ninguna cifra (un repaso que auto-repare una
    // fila estampa SU fecha, y por eso el nombre no promete «primer»). Escritores:
    // `player.finalizarIntento` (estampa si ausente en CADA cierre — auto-reparación) y
    // `migracionesMetricas.reconciliarEnvioRegistrado` (backfill idempotente por cursor,
    // corrido y VERIFICADO en dev y prod antes de que el PR B migre los lectores de
    // `metricas.fueAplicada` a este campo). La carrera de dos primeras alumnas la
    // serializa OCC: el reintento ve el campo puesto y no escribe. Invariante temporal
    // (testigo en el verificador; garantizado por la guarda 5 de `iniciarIntento`):
    // `envioRegistradoEn ≥ abreEn`.
    envioRegistradoEn: v.optional(v.number()),
  })
    .index("by_grupo", ["grupoId"])
    // «Asignaciones NO CERRADAS de un grupo» (LUI-19): selección MONÓTONA — una
    // cerrada jamás reabre, así que `eq(grupoId).gt("cierraEn", ahora)` acota la
    // lectura al conjunto VIVO y el historial crece sin costo para el panel.
    // Techo DURO del conjunto: `MAX_ASIGNACIONES_VIVAS_POR_GRUPO` (frontera en
    // el escritor `asignar`) ⇒ la sonda lee ≤ 30+1 filas por grupo. Lectores:
    // `panelInstructor.resumen`/`participacionDeGrupo` y la propia sonda de
    // capacidad de `asignar` — nace con sus lectores (regla de la casa, abajo).
    .index("by_grupo_cierra", ["grupoId", "cierraEn"])
    // El GEMELO por alumna del anterior, para las asignaciones INDIVIDUALES (LUI-22). Nace
    // con sus DOS lectores (regla de la casa): la frontera de vivas por alumna de `asignar`
    // (`MAX_ASIGNACIONES_VIVAS_POR_ALUMNA`) y «Mis exámenes», que lee `.order("desc")` y por
    // eso ve SIEMPRE las vivas primero — su corte solo puede dejar fuera historial cerrado.
    // Las filas-grupo (`alumnoId` ausente) jamás matchean `eq("alumnoId", <id>)`.
    .index("by_alumno_cierra", ["alumnoId", "cierraEn"])
    .index("by_examen", ["examenId"])
    // «Asignaciones existentes de este examen» en orden de APERTURA (Diseño 19). Sobre
    // `by_examen` a secas, `.order("desc")` ordenaría por el desempate implícito
    // `_creationTime` — el contrato de la pantalla es `abreEn` desc y la paginación
    // (`existentesDe`, LUI-22-B) necesita que el índice lo encodee.
    .index("by_examen_abre", ["examenId", "abreEn"])
    // Orden y rango temporal de «aplicación» (LUI-9). Sin él, «los 5 exámenes más
    // recientes» exige `.collect()` de toda la tabla + sort en JS, y «los del mes
    // en curso» escanea todo el historial. Con él, el panel lee EXACTAMENTE 5
    // documentos y la métrica solo los del mes.
    // Además ENCODEA la decisión de que `abreEn` —no `cierraEn`— es la marca
    // canónica de aplicación: ver `convex/metricas.ts`. Indexa TAMBIÉN las
    // filas-alumno (LUI-22): una asignación individual aplicada CUENTA como
    // aplicación en el panel — decisión documentada en `metricas.ts`.
    .index("by_abre", ["abreEn"]),

  // Intento / simulacro de una alumna sobre un examen.
  //
  // ⚠️ FASE A del paquete player (LUI-25/26/27/104), misma disciplina de superset
  // forward-only que LUI-17 y LUI-20: los campos nuevos entran OPCIONALES porque el schema
  // valida los documentos EXISTENTES al desplegarse (dev tiene intentos sembrados sin
  // ellos), y **las mutations son la autoridad de obligatoriedad**: todo intento que nace
  // por `player.iniciarIntento` lleva `numeroIntento`, y todo cierre estampa `formaCierre`
  // y el desglose. La Fase C los endurece cuando el dato sea uniforme.
  intentos: defineTable({
    examenId: v.id("examenes"),
    alumnoId: v.id("users"),
    asignacionId: v.optional(v.id("asignaciones")),
    estado: v.union(v.literal("en_curso"), v.literal("enviado")),
    iniciadoEn: v.number(),
    enviadoEn: v.optional(v.number()),
    puntaje: v.optional(v.number()), // puntaje EXANI (protagonista de resultados)
    // Posición 1-based del intento dentro de su SERIE — (asignación, alumna) para los
    // asignados, (examen, alumna) para los directos. El 1 es el DIAGNÓSTICO y es el ÚNICO
    // que alimenta la analítica (regla transversal de LUI-104, implementada en
    // `simulacro.promedioDeAsignacion`). AUSENTE = fila anterior a este ciclo: los lectores
    // la tratan como legado y le aplican el proxy histórico, jamás la excluyen en silencio.
    numeroIntento: v.optional(v.number()),
    // CÓMO se cerró (LUI-27), derivado por el servidor al finalizar. Campo APARTE de
    // `estado` a propósito: un tercer literal en `estado` obligaría a revisar las dos sondas
    // del panel del instructor (`participacion.ESTADOS_INTENTO`) y `examenes.listar`.
    // AUSENTE en un `enviado` = «manual» (único camino que existía) — `normalizarFormaCierre`.
    formaCierre: v.optional(formaCierreValidator),
    // Desglose CRUDO del cierre (contrato de datos de LUI-27/LUI-6): conteos, no porcentajes
    // — el cociente es presentación y perdería el denominador que hace comparables dos
    // exámenes. Se estampa una sola vez, con los reactivos y respuestas que el cierre ya
    // tiene en memoria. Consumidor declarado: los resultados del alumno (LUI-28).
    aciertosPorSeccion: v.optional(v.array(conteoPorSeccionValidator)),
    aciertosPorArea: v.optional(v.array(conteoPorAreaValidator)),
    // Job del cierre DURABLE (LUI-27): `iniciarIntento` agenda `player.cerrarVencido` para el
    // límite del intento y guarda su id aquí para poder CANCELARLO si el límite se mueve
    // (solo ocurre en dev: re-anclaje del seed y helper `envejecerIntento`). Sin esta
    // cancelación, cada re-anclaje dejaría un job viejo que dispara antes de tiempo y
    // re-agenda: una cadena creciente de trabajo pendiente. Con ella la cota es dura:
    // ≤1 job pendiente por intento vivo.
    cierreJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_alumno", ["alumnoId"])
    .index("by_examen", ["examenId"])
    .index("by_asignacion", ["asignacionId"])
    // «¿Este examen tiene resultados?» (LUI-20) en UNA lectura por examen: una sonda
    // `.first()` sobre (examenId, "enviado"). `by_examen` a secas no sirve — no distingue un
    // intento `en_curso` de uno `enviado`, y «tiene resultados» significa enviado.
    // `intentos` es la tabla GRANDE (alumnas × exámenes): jamás se hace `.collect()`.
    .index("by_examen_estado", ["examenId", "estado"])
    // Sondas del panel del instructor (LUI-19): DOS `.first()` por (asignación,
    // alumna) — «¿ya envió?» y, solo si no, «¿trae en curso?» — la enumeración
    // EXHAUSTIVA de `ESTADOS_INTENTO` (participacion.ts; un tercer estado obliga
    // a revisarlas). ≤2 rangos y ≤2 docs por pareja SIN IMPORTAR reintentos: la
    // regla de arriba se mantiene — el panel jamás colecciona esta tabla.
    .index("by_asignacion_alumno_estado", ["asignacionId", "alumnoId", "estado"])
    // DIAGNÓSTICOS de una asignación por RANGO (LUI-104). `panel.resumen` promedia solo el
    // intento 1 de cada alumna: sin este índice tendría que coleccionar todos los intentos
    // de la asignación y filtrar en memoria — con repasos eso es alumnas × intentos, y
    // 5 asignaciones × 200 alumnas × 30 intentos rebasa los 32,000 documentos por
    // transacción de Convex. El segundo rango, `eq("numeroIntento", undefined)`, selecciona
    // el LEGADO sin campo (semántica de Convex: un `eq` contra `undefined` casa los
    // documentos que no lo tienen), acotado por el mismo centinela.
    .index("by_asignacion_numero", ["asignacionId", "numeroIntento"])
    // «¿Esta asignación tiene ALGÚN enviado?» en una sonda `.first()` O(1) (LUI-30).
    // Lector: la reconciliación/verificación del read-model `asignaciones.envioRegistradoEn`
    // (`migracionesMetricas.ts`) — nace con su lector, regla de la casa. Cualquier enviado
    // sirve (no necesita `numeroIntento`): por el invariante `numeroIntento > 1 ⟹ ∃ enviado
    // previo`, «∃ enviado» ⟺ «el intento 1 está enviado». Las queries de pantalla de LUI-30
    // NO lo usan (sus rangos son `by_asignacion_numero` y `by_grupo`).
    .index("by_asignacion_estado", ["asignacionId", "estado"]),

  // Respuesta por reactivo dentro de un intento (LUI-26).
  //
  // Reescritura LIMPIA, no un superset: la tabla nació vacía y sin escritores (verificado en
  // dev y en producción antes de este ciclo), así que los opcionales solo habrían admitido
  // estados ilegales —«respuesta sin opción elegida», «respuesta sin calificar»— sin
  // proteger ninguna fila existente. `segundos` se retiró por lo mismo que nunca se llenó:
  // cero consumidores; `respondidoEn` (timestamp del guardado, exigido por LUI-26) lo supera
  // y permite derivar cualquier delta que las estadísticas de tiempo de la V2 quieran.
  //
  // `correcta` la estampa el SERVIDOR al recibir la respuesta (`player.responder` compara
  // contra `reactivos.opcionCorrecta`, que jamás viaja al cliente). El cierre solo suma.
  respuestas: defineTable({
    intentoId: v.id("intentos"),
    reactivoId: v.id("reactivos"),
    opcionElegida: v.string(),
    correcta: v.boolean(),
    respondidoEn: v.number(), // epoch ms
  })
    // Sirve las DOS lecturas: el prefijo `intentoId` da las respuestas del intento (player y
    // cierre) y el par completo es la sonda del upsert de `responder`. Un índice de Convex
    // NO es constraint único: la unicidad (una fila por reactivo) la sostiene la disciplina
    // sonda+`patch|insert` DENTRO de la misma transacción — dos clics simultáneos leen y
    // escriben el mismo rango, así que la serialización de Convex hace reintentar a uno y
    // el reintento encuentra la fila y la parchea.
    .index("by_intento_reactivo", ["intentoId", "reactivoId"]),

  // CURSOR de navegación del player (LUI-26): en qué pregunta se quedó la alumna.
  //
  // ⚠️ Tabla propia y no un campo de `intentos` — es una decisión de RENDIMIENTO, no de
  // estilo. Convex re-ejecuta las queries que leyeron un documento modificado: escribir el
  // cursor en la fila del intento invalidaría, en CADA navegación, `player.intento` (que
  // resuelve hasta 240 reactivos con su HTML), `panel.resumen` y las sondas de participación
  // del panel del instructor — decenas de reevaluaciones caras por examen, además de
  // competir por OCC con `responder`, `enviar` y el cierre durable. Aislado aquí, la única
  // query que se invalida es `player.posicionDe`, que lee un documento.
  //
  // El cliente la escribe INMEDIATAMENTE al cambiar de pregunta (sin debounce: el costo ya
  // es trivial) y expone la confirmación observable; la fila se borra al finalizar el
  // intento. Es UX, no dato académico: perderla solo devuelve a la alumna a la primera
  // pregunta sin responder.
  posiciones: defineTable({
    intentoId: v.id("intentos"),
    posicion: v.number(), // índice 0-based en `examenes.reactivoIds` (congelado por el candado)
  }).index("by_intento", ["intentoId"]),
});
