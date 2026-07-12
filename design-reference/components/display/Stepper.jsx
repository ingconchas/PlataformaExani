import React from 'react';

/** Stepper UNX — pasos completados con check azul, paso actual azul sólido, futuros en gris. */
export function Stepper({ steps = [], current = 0 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', fontFamily: 'var(--unx-font-sans)' }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', flex: i === steps.length - 1 ? '0 0 auto' : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 72 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  background: done || active ? 'var(--unx-blue)' : '#FFFFFF',
                  border: done || active ? 'none' : '1.5px solid var(--unx-border-strong)',
                  color: done || active ? '#FFFFFF' : 'var(--unx-text-muted)',
                  fontFamily: 'var(--unx-font-condensed)',
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span style={{ fontSize: 13, lineHeight: '18px', fontWeight: active ? 600 : 400, color: active ? 'var(--unx-ink)' : 'var(--unx-text-muted)', textAlign: 'center' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span style={{ flex: 1, height: 2, background: done ? 'var(--unx-blue)' : 'var(--unx-border)', marginTop: 15, borderRadius: 1 }}></span>
            )}
          </div>
        );
      })}
    </div>
  );
}
