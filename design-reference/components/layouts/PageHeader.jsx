import React from 'react';

/**
 * Encabezado de página del panel institucional: título H1 + acción primaria azul (una sola por vista).
 * `children` acepta controles extra (filtros, buscador) a la izquierda del botón.
 */
export function PageHeader({ title, subtitle, actionLabel, onAction, children }) {
  const [hover, setHover] = React.useState(false);
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 'var(--unx-sp-6)',
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, font: 'var(--unx-h1)', color: 'var(--unx-ink)' }}>{title}</h1>
        {subtitle && (
          <p style={{ margin: '4px 0 0', font: 'var(--unx-small)', color: 'var(--unx-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {children}
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 'var(--unx-control-h)',
              padding: '0 24px',
              border: 'none',
              borderRadius: 'var(--unx-radius-control)',
              background: hover ? 'var(--unx-blue-hover)' : 'var(--unx-blue)',
              color: '#FFFFFF',
              fontFamily: 'var(--unx-font-sans)',
              fontWeight: 600,
              fontSize: 16,
              lineHeight: '24px',
              cursor: 'pointer',
              transition: 'background var(--unx-transition)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {actionLabel}
          </button>
        )}
      </div>
    </header>
  );
}
