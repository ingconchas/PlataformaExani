import React from 'react';

/* Iconos de línea estilo Lucide (24×24, trazo 1.5) para las pestañas de la app de la alumna. */
const TAB_ICONS = {
  inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  examenes: <><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
  historial: <><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>,
  progreso: <><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>,
};

/**
 * Navegación inferior fija de la app de la alumna: 4 pestañas con icono y etiqueta.
 * Pestaña activa en azul UNX. No se muestra nunca dentro del modo examen.
 */
export function BottomNav({ items = [], activeId, onNavigate }) {
  return (
    <nav
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length || 1}, 1fr)`,
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 4px 10px',
        background: 'var(--unx-surface)',
        borderTop: '1px solid var(--unx-border)',
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate && onNavigate(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '6px 2px',
              border: 'none',
              background: 'transparent',
              color: active ? 'var(--unx-blue)' : 'var(--unx-text-muted)',
              fontFamily: 'var(--unx-font-sans)',
              fontWeight: active ? 600 : 400,
              fontSize: 11,
              lineHeight: '14px',
              cursor: 'pointer',
              transition: 'color var(--unx-transition)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={active ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {TAB_ICONS[item.icon] || TAB_ICONS.inicio}
            </svg>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
