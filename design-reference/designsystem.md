# UNX Simuladores — Design System

**Versión 1.0 · Julio 2026 · Modo claro**
Plataforma web de UNX (unx.mx) para simulacros del EXANI II (CENEVAL, México).
Marca alentadora y profesional. Lema: *"Transformar aspirantes en admitidos"*.

Archivos del sistema:
- `unx-tokens.css` — variables CSS `:root` + bloque `@theme` para Tailwind v4
- `UNX Design System.dc.html` — stickersheet visual de referencia

---

## 1. Paleta

### Marca

| Token | Valor | Uso |
|---|---|---|
| Azul UNX (primario) | `#0228C9` | CTAs, navegación, elementos activos. Texto encima: **siempre blanco** |
| Azul hover | `#021E9E` | Hover/pressed del primario |
| Azul tinte | `#E9EDFC` | Fondo activo suave, banners de información, anillo de focus |
| Amarillo UNX (acento) | `#FFBF54` | Logros, destacados y celebraciones. Texto encima: **siempre `#1F2937`** |
| Amarillo tinte | `#FFF6E5` | Fondos suaves de celebración |
| Verde UNX (éxito) | `#0B9944` | Éxito, aciertos, nivel fácil |
| Verde tinte | `#E7F5EC` | Banners y chips de éxito |
| Naranja UNX (advertencia) | `#D64801` | Áreas a reforzar — **solo iconos y rellenos** |
| Naranja texto | `#A83800` | Naranja para texto (AA sobre blanco y tinte) |
| Naranja tinte | `#FBEDE6` | Fondos suaves de advertencia |
| Morado UNX (repaso) | `#600B67` | Modo repaso e insignias especiales |
| Morado tinte | `#F4EAF5` | Fondos suaves de repaso |

### Semánticos

| Token | Valor | Uso |
|---|---|---|
| Error | `#DC2626` | **Siempre con icono + mensaje**, nunca solo color |
| Error tinte | `#FDECEC` | Fondo de banners de error |
| Información | `#0228C9` sobre `#E9EDFC` | Avisos informativos |

### Neutros (escala fría, 7 pasos)

| Valor | Uso |
|---|---|
| `#F9FAFB` | Fondo de página |
| `#FFFFFF` | Superficie de tarjetas y modales |
| `#E5E7EB` | Bordes y divisores |
| `#D1D5DB` | Borde de inputs y controles |
| `#6B7280` | Texto secundario |
| `#374151` | Texto de cuerpo |
| `#1F2937` | Títulos y texto sobre amarillo |

Disabled: fondo `#F3F4F6`, texto `#9CA3AF` (sin opacidad).

**Reglas de uso:** el azul es el color de la acción — un solo CTA primario por vista. El amarillo celebra, nunca acciona; es un token único compartido con el nivel "medio" del dificultómetro.

---

## 2. Tipografía

Familias (Google Fonts):
- **Barlow SemiBold (600)** — encabezados
- **Barlow Regular (400)** — cuerpo
- **Barlow Condensed SemiBold (600)** — cifras grandes, badges, temporizadores y tablas densas, siempre con `font-variant-numeric: tabular-nums`

Escala única (tamaño/interlínea en px):

| Nivel | Tamaño | Peso |
|---|---|---|
| Display | 32/40 | 600 |
| H1 | 24/32 | 600 |
| H2 | 20/28 | 600 |
| H3 | 18/26 | 600 |
| Cuerpo | 16/24 | 400 |
| Secundario | 14/20 | 400 |
| Caption | 12/16 | 400 |

Badges y etiquetas pequeñas: MAYÚSCULAS, Condensed 600, 12 px, `letter-spacing: 0.06em`, radio pill.

---

## 3. Espaciado y forma

- **Retícula base de 8 px** con medios pasos de 4 px.
  Escala: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96
- **Densidad cómoda:** controles de 44–48 px de alto, padding de tarjeta 24 px.
- **Radios:** 8 px inputs y botones · 10 px tarjetas · 12 px modales · pill (999px) badges y chips.
- **Sombras** (neutras, suaves):
  - `shadow-sm` — tarjetas (siempre con borde `#E5E7EB`):
    `0 1px 2px rgba(31,41,55,.05), 0 1px 3px rgba(31,41,55,.06)`
  - `shadow-md` — modales y menús elevados:
    `0 4px 6px rgba(31,41,55,.04), 0 10px 24px rgba(31,41,55,.08)`

---

## 4. Estados interactivos

Transición: `150ms ease` en hover/focus.
Focus siempre visible: anillo exterior sólido de 3 px — `box-shadow: 0 0 0 3px #E9EDFC` (en inputs, además borde azul `#0228C9`).

### Botones (44 px de alto, radio 8 px, Barlow 600 16 px)

| Variante | Default | Hover | Disabled |
|---|---|---|---|
| Primario | fondo `#0228C9`, texto blanco | fondo `#021E9E` | fondo `#F3F4F6`, texto `#9CA3AF` |
| Secundario | borde 1.5px `#0228C9`, texto azul, fondo blanco | fondo `#E9EDFC` | borde `#E5E7EB`, texto `#9CA3AF` |
| Terciario (ghost) | texto azul, sin fondo | fondo `#E9EDFC` | texto `#9CA3AF` |

### Inputs (44 px, radio 8 px)

- Default: borde 1.5 px `#D1D5DB`
- Focus: borde `#0228C9` + anillo 3 px `#E9EDFC`
- Error: borde `#DC2626` + icono + mensaje en `#DC2626` (12/16)

---

## 5. Accesibilidad

Reglas fijas del sistema (todos los pares cumplen WCAG AA):

1. Sobre azul UNX `#0228C9`, el texto **siempre es blanco** (9.8:1).
2. Sobre amarillo `#FFBF54`, el texto **siempre es oscuro `#1F2937`** (9.0:1).
3. El naranja `#D64801` no se usa como texto; para texto usar `#A83800` (6.5:1 sobre blanco).
4. Los errores **nunca dependen solo del color**: siempre icono + texto.
5. Focus visible en todos los controles interactivos.

---

## 6. Logotipo

Oficial, en `assets/logo/` (PNG con transparencia; origen vectorial: `Logos LC-UNX.ai`):

| Archivo | Uso |
|---|---|
| `unx-logotipo.png` | UN·X solo — sidebar, encabezados compactos, favicon |
| `unx-logo-completo.png` | Con eslogan — login, onboarding, presentación de marca |
| `unx-logotipo-blanco.png` | UN·X blanco — sobre azul UNX u oscuros |
| `unx-logo-completo-blanco.png` | Con eslogan, blanco — banda azul de correos |

Reglas: sobre claro va la versión a color, sobre azul/oscuro la blanca; nunca recolorear, deformar ni redibujar.

---

## 7. Iconografía e ilustración (sistema híbrido)

### Iconos funcionales de UI
Estilo de línea (outline), trazo **1.5 px**, retícula 24×24, estilo Lucide.
Color `#374151`; azul UNX `#0228C9` cuando están activos.
Set base: inicio, examen, alumnos, grupos, gráfica, reloj, check, alerta.

### Ilustraciones de marca UNX
Para la app de la alumna: onboarding, estados vacíos, logros y celebraciones.
Estilo del manual de identidad: **trazo negro `#1F2937` grueso (~5 px), esquinas redondeadas, rellenos planos y vivos** (azul, amarillo, verde, naranja, morado). Amigable sin ser infantil.
Ejemplos del sistema: caja de exámenes, laurel con estrella (cuadro de honor), dificultómetro.

---

## 8. Gamificación (tokens)

- **Chip de racha:** flama `#D64801` sobre tinte `#FBEDE6`, texto `#A83800` en Condensed 600, radio pill. Ej. "5 DÍAS SEGUIDOS".
- **Insignia de logro:** circular, azul UNX con laurel y estrella amarillos; versión bloqueada en grises (`#F3F4F6` / `#D1D5DB`).
- **Dificultómetro (3 niveles):** fácil verde `#0B9944` · medio amarillo `#FFBF54` · difícil naranja `#D64801`. Barras ascendentes; nivel siempre acompañado de etiqueta de texto.
- **Stickers de celebración:** burbuja de diálogo con estrella, burbuja con corazón, cursor sonriente — mismo lenguaje que las ilustraciones de marca (trazo negro grueso + rellenos planos UNX).

---

## 9. Layouts y navegación por rol

### Sidebar de staff (`SidebarNav`)
Desktop ≥1280: **256 px** fijos, fondo blanco, borde derecho 1 px `#E5E7EB`.
De arriba abajo: logotipo UNX (30 px de alto), avatar de iniciales + nombre y rol, menú, "Cerrar sesión" al pie tras un divisor.
Ítem de menú: 44 px de alto, radio 8 px, icono Lucide 22 px + etiqueta 15 px.
**Activo:** fondo `#E9EDFC`, texto y icono azul UNX, peso 600, barra indicadora azul de 3×24 px pegada al borde izquierdo. **Hover:** fondo `#F3F4F6`.
Menú por rol — Administradora: Inicio · Alumnos · Grupos · Usuarios y permisos · Temario · Resumen de exámenes. Instructor: Inicio · Banco de reactivos · Exámenes.
Tablet 768–1279 (`collapsed`): **72 px** solo iconos, menú hamburguesa arriba, etiquetas como tooltip.

### Encabezado de página (`PageHeader`)
Título H1 (24/32) + subtítulo opcional a la izquierda; **una sola acción primaria azul** (44 px, icono +) a la derecha. Margen inferior 24 px.

### App de la alumna (`StudentHeader` + `BottomNav`)
Móvil 390: encabezado con saludo H2 ("¡Hola, Fer!"), línea secundaria opcional, chip de racha compacto (flama + "5 DÍAS") y avatar-botón de 40 px arriba a la derecha.
Navegación inferior fija: 4 pestañas de icono 24 px + etiqueta 11 px — Inicio · Mis exámenes · Historial · Progreso. Activa: azul UNX, peso 600, trazo 2 px; inactiva `#6B7280`.
Desktop ≥1024: la navegación pasa a barra superior (mismas 4 secciones, píldora activa `#E9EDFC`) y el contenido se centra a **máx. 720 px**.

### Modo examen (`ExamHeader`)
**Sin ninguna navegación** — no hay tabs, menú ni gamificación; no existe forma de salir accidentalmente.
Encabezado mínimo de 52 px: nombre de la sección (14 px, 600, elipsis), contador "12 de 90" (Condensed 600 18, tabular) y temporizador en chip pill (Condensed; en los últimos 5 minutos fondo naranja `#D64801` con texto blanco).
Área de pregunta sobre fondo `#F9FAFB`; pie fijo blanco con Anterior (secundario) y Siguiente (primario), 48 px.

---

## 10. Pantallas (Diseño 04–30)

Las 27 pantallas del MVP viven en `screens/NN-slug.html`, **compuestas con los componentes de este sistema** (no HTML suelto), listas como especificación viva para desarrollo. `screens/index.html` es el visor navegable por rol. Convenciones: staff en desktop con `SidebarNav` + `PageHeader` + componentes de datos; alumna (Fernanda) en marco móvil 390 con `StudentHeader`/`BottomNav`/`ExamHeader`. Diseño 04 (correos transaccionales) se mantiene como HTML estático con estilos en línea, porque los correos no se renderizan con React. Sin emojis (regla de marca); la celebración usa `CelebrationToast` con sticker.

---

*UNX Simuladores · Design System v1.2*
