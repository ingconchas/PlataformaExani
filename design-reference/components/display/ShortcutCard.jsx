import React from 'react';

/** Tarjeta de acceso directo UNX — icono, título, descripción y flecha; toda la tarjeta es clicable. */
export function ShortcutCard({ title, description, icon, onClick, accent = 'var(--unx-blue)', tint = 'var(--unx-blue-tint)' }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        background: 'var(--unx-surface)',
        border: `1px solid ${hover ? 'var(--unx-blue)' : 'var(--unx-border)'}`,
        borderRadius: 'var(--unx-radius-card)',
        boxShadow: hover ? 'var(--unx-shadow-md)' : 'var(--unx-shadow-sm)',
        padding: 20,
        fontFamily: 'var(--unx-font-sans)',
        cursor: 'pointer',
        transition: 'border-color var(--unx-transition), box-shadow var(--unx-transition)',
      }}
    >
      {icon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 10, background: tint, color: accent, flexShrink: 0 }}>
          {icon}
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 16, lineHeight: '24px', color: 'var(--unx-ink)' }}>{title}</span>
        {description && <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--unx-text-muted)' }}>{description}</span>}
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={hover ? 'var(--unx-blue)' : 'var(--unx-text-muted)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'stroke var(--unx-transition)' }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
