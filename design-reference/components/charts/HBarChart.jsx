import React from 'react';

/**
 * Barras horizontales UNX por área temática — porcentaje de aciertos por barra;
 * las áreas a reforzar se resaltan en naranja con etiqueta.
 */
export function HBarChart({ data = [], highlightTag = 'Reforzar en repaso', width = 520 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width, fontFamily: 'var(--unx-font-sans)' }}>
      {data.map((d, i) => {
        const color = d.highlight ? 'var(--unx-orange)' : 'var(--unx-blue)';
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '20px', color: 'var(--unx-text)' }}>
                {d.label}
                {d.highlight && (
                  <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontSize: 11, lineHeight: '14px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--unx-orange-text)', background: 'var(--unx-orange-tint)', borderRadius: 'var(--unx-radius-pill)', padding: '3px 10px' }}>
                    {highlightTag}
                  </span>
                )}
              </span>
              <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontSize: 14, color: 'var(--unx-ink)', fontVariantNumeric: 'tabular-nums' }}>
                {d.display != null ? d.display : `${d.value}%`}
              </span>
            </div>
            <div style={{ height: 12, background: 'var(--unx-border)', borderRadius: 'var(--unx-radius-pill)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, d.value))}%`, background: color, borderRadius: 'var(--unx-radius-pill)', transition: 'width var(--unx-transition)' }}></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
