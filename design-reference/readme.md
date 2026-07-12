# UNX Simuladores — Design System

**v1.2 · Julio 2026 · Modo claro** *(v1.1 agrega layouts y navegación por rol; v1.2 agrega las 27 pantallas Diseño 04–30 compuestas con componentes)*

Sistema de diseño para «UNX Simuladores», la plataforma web de UNX (unx.mx) donde instituciones de preparación universitaria aplican simulacros del EXANI II (examen de admisión CENEVAL, México). Dos audiencias: el **panel institucional** (docentes/coordinadores: grupos, alumnos, resultados, tablas densas) y la **app de la alumna** (práctica, repaso, logros, celebraciones).

**Marca:** alentadora y profesional. Lema: *"Transformar aspirantes en admitidos"*.

Fuentes de este sistema: especificación provista por el usuario en conversación (no se recibió manual de identidad, Figma ni codebase). Las ilustraciones y stickers son **recreaciones aproximadas** del estilo descrito del manual UNX — sustituir por los originales cuando estén disponibles.

**Logotipo oficial integrado (2026-07-06)** en `assets/logo/`: `unx-logotipo.png` (UN·X solo, para sidebar y encabezados compactos), `unx-logo-completo.png` (con eslogan "Preparación para tu Examen de Admisión", para login/onboarding) y sus versiones `-blanco.png` para fondos azules u oscuros. Nunca recolorear ni deformar; no dibujar logotipos alternativos. Origen vectorial para producción: `Identidad UN-X/2. Diseños Arantza Meneses/Logos LC-UNX.ai` (pedir exportación SVG).

---

## FUNDAMENTOS DE CONTENIDO

- **Idioma:** español de México, siempre.
- **Tono:** alentador y profesional. Celebra el progreso ("¡5 días seguidos!", "Nuevo logro") sin infantilizar. Las áreas débiles se nombran "áreas a reforzar", nunca "fallos".
- **Trato:** tuteo ("tu puntaje", "revisa tu conexión"). La voz del producto habla a la alumna de tú; el panel institucional es más neutro y descriptivo.
- **Casing:** sentence case en todo, salvo badges y etiquetas pequeñas en MAYÚSCULAS (Condensed, tracking 0.06em).
- **Emoji:** no se usan. La celebración se expresa con stickers e ilustraciones de marca.
- **Errores:** mensaje claro y accionable, en primera persona del usuario nunca culpable: "Escribe un correo válido", "Tu respuesta no se guardó. Revisa tu conexión."
- **Cifras:** los puntajes EXANI (ej. 1082) son protagonistas — grandes, en Barlow Condensed.

## FUNDAMENTOS VISUALES

- **Color:** azul UNX #0228C9 es el color de la acción — un solo CTA primario por vista; hover #021E9E; activo suave #E9EDFC. El amarillo #FFBF54 celebra, nunca acciona (token único, también nivel "medio" de dificultad). Verde #0B9944 éxito; naranja #D64801 advertencia (texto en #A83800); morado #600B67 modo repaso. Error #DC2626 siempre con icono. Neutros fríos de #F9FAFB a #1F2937.
- **Tipografía:** Barlow 600 encabezados, Barlow 400 cuerpo, Barlow Condensed 600 para cifras grandes, badges, temporizadores y tablas densas (siempre `tabular-nums`). Escala: 32/40, 24/32, 20/28, 18/26, 16/24, 14/20, 12/16.
- **Fondos:** planos, sin gradientes ni texturas. Página #F9FAFB, superficies blancas.
- **Tarjetas:** blancas, borde 1px #E5E7EB **y** sombra sm, radio 10px, padding 24px.
- **Sombras:** dos niveles neutros muy suaves (sm tarjetas, md modales/menús). Sin sombras internas.
- **Radios:** 8px controles, 10px tarjetas, 12px modales, pill en badges/chips.
- **Espaciado:** retícula 8px con medios pasos de 4px; escala 4–96. Densidad cómoda: controles 44–48px.
- **Hover:** oscurecer (primario → #021E9E) o rellenar con tinte (#E9EDFC en secundario/ghost). **Press:** igual que hover; sin encoger.
- **Focus:** anillo exterior sólido 3px #E9EDFC (+ borde azul en inputs). Siempre visible.
- **Motion:** transiciones 150ms ease en hover/focus; sin rebotes ni animaciones decorativas.
- **Transparencia/blur:** no se usan.
- **Bordes:** 1px divisores (#E5E7EB), 1.5px inputs y botón secundario.
- **Accesibilidad (reglas fijas):** blanco sobre azul UNX (9.8:1); #1F2937 sobre amarillo (9.0:1); naranja de texto #A83800 (6.5:1); errores nunca solo con color; todos los pares AA.

## ICONOGRAFÍA

- **Iconos funcionales de UI:** estilo línea (outline), trazo 1.5px, retícula 24×24, estilo **Lucide** (usar Lucide desde CDN o copiar SVGs; no hay icon font propio). Color #374151; azul UNX cuando activos. Set base: inicio, examen, alumnos, grupos, gráfica, reloj, check, alerta.
- **Ilustraciones de marca** (onboarding, estados vacíos, logros): trazo negro #1F2937 grueso ~5px, esquinas redondeadas, rellenos planos vivos (paleta UNX). Amigable sin ser infantil. Ver `assets/illustrations/`.
- **Stickers de celebración:** mismo lenguaje; ver `assets/stickers/`.
- Ni emoji ni caracteres unicode como iconos.

## GAMIFICACIÓN

- **Chip de racha:** flama #D64801 sobre tinte #FBEDE6, texto #A83800 Condensed 600, pill.
- **Insignia de logro:** circular azul UNX con laurel y estrella amarillos; bloqueada en grises.
- **Dificultómetro:** 3 niveles — fácil verde, medio amarillo, difícil naranja — barras ascendentes + etiqueta de texto siempre.

## LAYOUTS Y NAVEGACIÓN POR ROL

- **Panel institucional (staff, desktop 1440):** barra lateral izquierda fija de 256 px, fondo blanco — logo UNX arriba, nombre y rol de la usuaria, menú con iconos de línea, "Cerrar sesión" abajo. Elemento activo: fondo #E9EDFC + barra indicadora azul de 3 px en el borde. Menú de la Administradora: Inicio, Alumnos, Grupos, Usuarios y permisos, Temario, Resumen de exámenes. Menú del Instructor: Inicio, Banco de reactivos, Exámenes. El contenido abre con `PageHeader` (título + una sola acción primaria azul).
- **App de la alumna (móvil 390):** encabezado con saludo, chip de racha y avatar arriba a la derecha; navegación inferior fija de 4 pestañas (Inicio, Mis exámenes, Historial, Progreso), activa en azul UNX.
- **Modo examen (móvil):** sin ninguna navegación — solo `ExamHeader` (sección + contador "12 de 90" + temporizador Condensed) y el área de la pregunta; botones Anterior/Siguiente al pie. Sin gamificación ni forma de salir accidentalmente.
- **Responsive:** en tablet (768–1279) la sidebar colapsa a 72 px solo iconos con menú hamburguesa; la app de la alumna en desktop (≥1024) usa barra superior y centra el contenido a máx. 720 px. El modo examen nunca muestra navegación.

## Intentional additions

Sin fuente de componentes (no hubo Figma/codebase), se creó un set estándar dimensionado a la plataforma: formularios, display y tokens de gamificación propios del producto.

## ÍNDICE

- `styles.css` — punto de entrada global (importa `tokens/*.css`)
- `tokens/` — colors, typography, spacing, effects, fonts
- `designsystem.md` — especificación completa en tablas
- `unx-tokens.css` — versión autónoma de tokens + `@theme` Tailwind v4
- `UNX Design System.dc.html` — stickersheet visual completo
- `guidelines/` — tarjetas de especimen (color, tipo, espaciado, marca)
- `components/forms/` — Button, Input, PasswordInput, Select, MultiSelect, Checkbox, Radio, Textarea, SearchInput, FileDrop
- `components/display/` — Card, Badge, Alert, Tabs, DataTable, MetricCard, ShortcutCard, ExamCard, ProgressBar, Modal, Toast, Breadcrumb, Avatar, Stepper
- `components/charts/` — LineChart (meta y multilínea), HBarChart
- `components/exam/` — ExamTimer, AnswerOption
- `components/gamification/` — StreakChip, AchievementBadge, DifficultyMeter, CelebrationToast
- `components/layouts/` — SidebarNav, PageHeader, BottomNav, StudentHeader, ExamHeader + 5 plantillas de layout por rol (`layout-*.card.html`)
- `screens/` — las 27 pantallas Diseño 04–30 (`NN-slug.html`) compuestas con los componentes reales; `_load.js` (cargador de componentes por nombre) e `index.html` (visor navegable con barra lateral por rol). Diseño 04 (correos) es HTML estático a propósito. Requieren servidor local (`python3 -m http.server` desde la raíz del design system). Cada pantalla lleva su marcador `@dsCard group="Pantallas"`.
- `assets/logo/` — logotipo oficial UNX (color y blanco, con y sin eslogan)
- `assets/illustrations/`, `assets/stickers/` — SVGs de marca (recreaciones)
- `SKILL.md` — skill para Claude Code
