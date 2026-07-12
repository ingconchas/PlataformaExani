import React from 'react';

/**
 * Encabezado de la app de la alumna: saludo, chip de racha de práctica (flama)
 * y avatar de perfil arriba a la derecha. Tono cercano, sin infantilizar.
 */
export function StudentHeader({ name = 'Fernanda', message, streakDays = 0, onProfile }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '20px 20px 16px',
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, font: 'var(--unx-h2)', color: 'var(--unx-ink)' }}>¡Hola, {name}!</h2>
        {message && (
          <p style={{ margin: '2px 0 0', font: 'var(--unx-small)', color: 'var(--unx-text-muted)' }}>{message}</p>
        )}
        {streakDays > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 10,
              background: 'var(--unx-orange-tint)',
              borderRadius: 'var(--unx-radius-pill)',
              padding: '5px 12px',
              fontFamily: 'var(--unx-font-condensed)',
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: '0.03em',
              color: 'var(--unx-orange-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#D64801" stroke="#D64801" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 2.5.5 5 2.5 5 6a5 5 0 0 1-10 0c0-2 1-4 2.5-5.5C7.5 11 8.5 12 8.5 14.5z" />
              <path d="M12 2c1 3 4 5 4 9" fill="none" />
            </svg>
            {streakDays} {streakDays === 1 ? 'DÍA' : 'DÍAS'}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Tu perfil"
        onClick={onProfile}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          border: 'none',
          borderRadius: '50%',
          background: 'var(--unx-blue-tint)',
          color: 'var(--unx-blue)',
          fontFamily: 'var(--unx-font-sans)',
          fontWeight: 600,
          fontSize: 15,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {initials || '?'}
      </button>
    </header>
  );
}
