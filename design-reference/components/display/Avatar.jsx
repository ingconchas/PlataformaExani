import React from 'react';

/** Avatar UNX de iniciales, con variante de menú de usuario (nombre + rol + chevron). */
export function Avatar({ name = '', role, size = 36, showMenu = false, onClick }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const circle = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--unx-blue-tint)',
        color: 'var(--unx-blue)',
        fontFamily: 'var(--unx-font-sans)',
        fontWeight: 600,
        fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >
      {initials || '?'}
    </span>
  );
  if (!showMenu) return circle;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        background: 'transparent',
        border: 'none',
        padding: '6px 8px',
        borderRadius: 'var(--unx-radius-control)',
        cursor: 'pointer',
        fontFamily: 'var(--unx-font-sans)',
        textAlign: 'left',
      }}
    >
      {circle}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--unx-ink)' }}>{name}</span>
        {role && <span style={{ fontSize: 12, color: 'var(--unx-text-muted)' }}>{role}</span>}
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--unx-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
