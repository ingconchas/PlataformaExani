import React from 'react';

const VARIANTS = {
  info: { color: '#FFFFFF', background: 'var(--unx-blue)' },
  'info-soft': { color: 'var(--unx-blue)', background: 'var(--unx-blue-tint)' },
  success: { color: 'var(--unx-green)', background: 'var(--unx-green-tint)' },
  warning: { color: 'var(--unx-orange-text)', background: 'var(--unx-orange-tint)' },
  review: { color: 'var(--unx-purple)', background: 'var(--unx-purple-tint)' },
  achievement: { color: 'var(--unx-ink)', background: 'var(--unx-yellow)' },
  neutral: { color: 'var(--unx-text-muted)', background: 'var(--unx-disabled-bg)' },
};

/** Badge UNX — pill, MAYÚSCULAS, Barlow Condensed 600 12px, tracking 0.06em. */
export function Badge({ variant = 'neutral', children }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--unx-font-condensed)',
        fontWeight: 600,
        fontSize: 12,
        lineHeight: '16px',
        letterSpacing: 'var(--unx-badge-tracking)',
        textTransform: 'uppercase',
        color: v.color,
        background: v.background,
        borderRadius: 'var(--unx-radius-pill)',
        padding: '6px 14px',
      }}
    >
      {children}
    </span>
  );
}
