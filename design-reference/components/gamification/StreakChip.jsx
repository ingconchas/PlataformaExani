import React from 'react';

/** Chip de racha UNX — flama naranja sobre tinte, texto Condensed en #A83800. */
export function StreakChip({ days = 1, label }) {
  const text = label || `${days} ${days === 1 ? 'DÍA SEGUIDO' : 'DÍAS SEGUIDOS'}`;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--unx-orange-tint)',
        borderRadius: 'var(--unx-radius-pill)',
        padding: '10px 18px',
        fontFamily: 'var(--unx-font-condensed)',
        fontWeight: 600,
        fontSize: 16,
        letterSpacing: '0.02em',
        color: 'var(--unx-orange-text)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#D64801" stroke="#D64801" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 2.5.5 5 2.5 5 6a5 5 0 0 1-10 0c0-2 1-4 2.5-5.5C7.5 11 8.5 12 8.5 14.5z" />
        <path d="M12 2c1 3 4 5 4 9" fill="none" />
      </svg>
      {text}
    </span>
  );
}
