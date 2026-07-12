import React from 'react';

const VARIANTS = {
  success: {
    background: 'var(--unx-green-tint)', color: 'var(--unx-green)', border: '1px solid var(--unx-green)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  error: {
    background: 'var(--unx-error-tint)', color: 'var(--unx-error)', border: '1px solid var(--unx-error)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  info: {
    background: 'var(--unx-info-bg)', color: 'var(--unx-info)', border: '1px solid var(--unx-blue)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
};

/** Toast UNX — notificación breve con icono; variantes éxito, error e información. */
export function Toast({ variant = 'info', children, onClose }) {
  const v = VARIANTS[variant] || VARIANTS.info;
  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        background: v.background,
        border: v.border,
        borderRadius: 'var(--unx-radius-control)',
        boxShadow: 'var(--unx-shadow-md)',
        padding: '12px 16px',
        fontFamily: 'var(--unx-font-sans)',
        fontSize: 14,
        fontWeight: 600,
        lineHeight: '20px',
        color: v.color,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{v.icon}</span>
      <span>{children}</span>
      {onClose && (
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, border: 'none', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: 'pointer', marginLeft: 4, padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
