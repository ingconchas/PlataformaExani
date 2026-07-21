import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { materialValidator } from "./material";
import { estadoExamenValidator, tipoExamenValidator } from "./examenEstado";
import { seccionDeExamenValidator } from "./constructorExamen";

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
  // cualquier reactivo) y reventaría el tope de 8 MiB por query a ~4 000 reactivos
  // (el tope de 16384 docs solo muerde bajo 512 B/doc; un reactivo pesa 1–4 KB).
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
  // ⚠️ Sin índice `by_alumno`: en LUI-22 no tiene un solo consumidor (`cancelar` va por
  // `ctx.db.get`, la pantalla por `by_examen*`, el panel por `by_abre`) y un índice
  // estampado sin lector es exactamente lo que este repo no hace. «Mis exámenes» (portal
  // de la alumna) lo añadirá junto con su primer lector.
  asignaciones: defineTable({
    examenId: v.id("examenes"),
    grupoId: v.optional(v.id("grupos")), // destino grupo (filas legadas: siempre presente)
    alumnoId: v.optional(v.id("users")), // destino alumno individual (LUI-22)
    abreEn: v.number(), // epoch ms
    cierraEn: v.number(),
    creadoPor: v.id("users"),
  })
    .index("by_grupo", ["grupoId"])
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
  intentos: defineTable({
    examenId: v.id("examenes"),
    alumnoId: v.id("users"),
    asignacionId: v.optional(v.id("asignaciones")),
    estado: v.union(v.literal("en_curso"), v.literal("enviado")),
    iniciadoEn: v.number(),
    enviadoEn: v.optional(v.number()),
    puntaje: v.optional(v.number()), // puntaje EXANI (protagonista de resultados)
  })
    .index("by_alumno", ["alumnoId"])
    .index("by_examen", ["examenId"])
    .index("by_asignacion", ["asignacionId"])
    // «¿Este examen tiene resultados?» (LUI-20) en UNA lectura por examen: una sonda
    // `.first()` sobre (examenId, "enviado"). `by_examen` a secas no sirve — no distingue un
    // intento `en_curso` de uno `enviado`, y «tiene resultados» significa enviado.
    // `intentos` es la tabla GRANDE (alumnas × exámenes): jamás se hace `.collect()`.
    .index("by_examen_estado", ["examenId", "estado"]),

  // Respuesta por reactivo dentro de un intento.
  respuestas: defineTable({
    intentoId: v.id("intentos"),
    reactivoId: v.id("reactivos"),
    opcionElegida: v.optional(v.string()),
    correcta: v.optional(v.boolean()),
    segundos: v.optional(v.number()),
  }).index("by_intento", ["intentoId"]),
});
