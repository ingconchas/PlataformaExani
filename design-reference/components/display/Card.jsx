import React from 'react';

/** Tarjeta UNX — superficie blanca, borde + sombra sm, radio 10px, padding 24px. */
export function Card({ title, children, padding = 24, style }) {
  return (
    <div
      style={{
        background: 'var(--unx-surface)',
        border: '1px solid var(--unx-border)',
        borderRadius: 'var(--unx-radius-card)',
        boxShadow: 'var(--unx-shadow-sm)',
        padding,
        fontFamily: 'var(--unx-font-sans)',
        ...style,
      }}
    >
      {title && (
        <div style={{ fontWeight: 600, fontSize: 18, lineHeight: '26px', color: 'var(--unx-ink)', marginBottom: 12 }}>{title}</div>
      )}
      {children}
    </div>
  );
}
