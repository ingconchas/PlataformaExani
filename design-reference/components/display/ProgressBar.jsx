import React from 'react';

/** Barra de progreso UNX — lineal con etiqueta "X de Y" o %, y variante con marcador de meta amarillo. */
export function ProgressBar({ value = 0, max = 100, label, showPercent = false, goal, goalLabel = 'Meta', color = 'var(--unx-blue)', height = 10 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const goalPct = goal != null ? Math.max(0, Math.min(100, (goal / max) * 100)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)', width: '100%' }}>
      {(label || showPercent) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, lineHeight: '20px', color: 'var(--unx-text)' }}>
          <span>{label}</span>
          {showPercent && (
            <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--unx-ink)' }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div style={{ position: 'relative', paddingTop: goalPct != null ? 14 : 0 }}>
        {goalPct != null && (
          <span
            style={{
              position: 'absolute',
              left: `${goalPct}%`,
              top: 0,
              transform: 'translateX(-50%)',
              fontFamily: 'var(--unx-font-condensed)',
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#A87013',
              whiteSpace: 'nowrap',
            }}
          >
            {goalLabel}
          </span>
        )}
        <div style={{ position: 'relative', height, background: 'var(--unx-border)', borderRadius: 'var(--unx-radius-pill)', overflow: 'visible' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: color, borderRadius: 'var(--unx-radius-pill)', transition: 'width var(--unx-transition)' }}></div>
          {goalPct != null && (
            <span
              style={{
                position: 'absolute',
                left: `${goalPct}%`,
                top: -3,
                bottom: -3,
                width: 4,
                transform: 'translateX(-50%)',
                background: 'var(--unx-yellow)',
                border: '1px solid #A87013',
                borderRadius: 2,
              }}
            ></span>
          )}
        </div>
      </div>
    </div>
  );
}
