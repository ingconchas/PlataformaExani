import React from 'react';

/** Insignia circular de logro — azul UNX con laurel y estrella amarillos; bloqueada en grises. */
export function AchievementBadge({ locked = false, size = 88, label }) {
  const fill = locked ? '#F3F4F6' : 'var(--unx-blue)';
  const stroke = locked ? 'var(--unx-border-strong)' : 'var(--unx-blue-hover)';
  const accent = locked ? '#D1D5DB' : 'var(--unx-yellow)';
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontFamily: 'var(--unx-font-condensed)' }}>
      <svg width={size} height={size} viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="42" fill={fill} stroke={stroke} strokeWidth="3" />
        <path d="M28 34 C20 46 21 62 32 71" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
        <path d="M68 34 C76 46 75 62 64 71" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
        <polygon points="48,28 53.5,41 67,41 56.5,49.5 60.5,63 48,55 35.5,63 39.5,49.5 29,41 42.5,41" fill={accent} />
      </svg>
      {label && (
        <span style={{ fontWeight: 600, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: locked ? 'var(--unx-disabled-text)' : 'var(--unx-blue)' }}>
          {label}
        </span>
      )}
    </div>
  );
}
