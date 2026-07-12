import React from 'react';

/** Tarjeta de métrica UNX — número grande en Barlow Condensed + etiqueta + icono. */
export function MetricCard({ value, label, icon, accent = 'var(--unx-blue)', tint = 'var(--unx-blue-tint)' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: 'var(--unx-surface)',
        border: '1px solid var(--unx-border)',
        borderRadius: 'var(--unx-radius-card)',
        boxShadow: 'var(--unx-shadow-sm)',
        padding: 20,
        fontFamily: 'var(--unx-font-sans)',
        minWidth: 200,
      }}
    >
      {icon && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 10,
            background: tint,
            color: accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontSize: 32, lineHeight: '36px', color: 'var(--unx-ink)', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--unx-text-muted)' }}>{label}</span>
      </div>
    </div>
  );
}
