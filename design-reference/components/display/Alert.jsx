import React from 'react';

const ICONS = {
  error: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0228C9" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  success: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B9944" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  warning: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D64801" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const STYLES = {
  error: { background: 'var(--unx-error-tint)', border: '1px solid var(--unx-error)', color: 'var(--unx-error)', fontWeight: 600 },
  info: { background: 'var(--unx-info-bg)', border: 'none', color: 'var(--unx-info)', fontWeight: 400 },
  success: { background: 'var(--unx-green-tint)', border: 'none', color: 'var(--unx-green)', fontWeight: 600 },
  warning: { background: 'var(--unx-orange-tint)', border: 'none', color: 'var(--unx-orange-text)', fontWeight: 600 },
};

/** Banner de aviso UNX — siempre icono + texto (el error nunca depende solo del color). */
export function Alert({ variant = 'info', children }) {
  const s = STYLES[variant] || STYLES.info;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: s.background,
        border: s.border,
        borderRadius: 'var(--unx-radius-control)',
        padding: '12px 16px',
        fontFamily: 'var(--unx-font-sans)',
        fontSize: 14,
        lineHeight: '20px',
        color: s.color,
        fontWeight: s.fontWeight,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{ICONS[variant] || ICONS.info}</span>
      <span>{children}</span>
    </div>
  );
}
