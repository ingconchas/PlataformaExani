import React from 'react';

/** Modal de confirmación UNX — overlay + tarjeta radio 12px con título, contenido y acciones. */
export function Modal({ title, children, actions, onClose, width = 440, contained = false }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: contained ? 'absolute' : 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(31,41,55,0.45)',
        padding: 20,
        zIndex: 50,
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: width,
          background: 'var(--unx-surface)',
          borderRadius: 'var(--unx-radius-modal)',
          boxShadow: 'var(--unx-shadow-md)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 20, lineHeight: '28px', color: 'var(--unx-ink)' }}>{title}</span>
          {onClose && (
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--unx-text-muted)', cursor: 'pointer', flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div style={{ fontSize: 15, lineHeight: '22px', color: 'var(--unx-text)' }}>{children}</div>
        {actions && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>{actions}</div>}
      </div>
    </div>
  );
}
