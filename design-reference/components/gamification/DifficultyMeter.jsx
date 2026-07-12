import React from 'react';

const LEVELS = {
  facil: { bars: 1, color: 'var(--unx-green)', text: 'var(--unx-green)', label: 'FÁCIL' },
  medio: { bars: 2, color: 'var(--unx-yellow)', text: '#A87013', label: 'MEDIO' },
  dificil: { bars: 3, color: 'var(--unx-orange)', text: 'var(--unx-orange-text)', label: 'DIFÍCIL' },
};

/** Dificultómetro UNX — 3 barras ascendentes + etiqueta de texto (nunca solo color). Tamaños: chip (default) y card. */
export function DifficultyMeter({ level = 'facil', showLabel = true, size = 'chip' }) {
  const l = LEVELS[level] || LEVELS.facil;
  const card = size === 'card';
  const heights = card ? [12, 20, 28] : [8, 14, 20];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: card ? 12 : 10, fontFamily: 'var(--unx-font-condensed)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: card ? 4 : 3, height: card ? 28 : 20 }}>
        {heights.map((h, i) => (
          <span
            key={i}
            style={{
              width: card ? 10 : 7,
              height: h,
              background: i < l.bars ? l.color : 'var(--unx-border)',
              borderRadius: card ? 3 : 2,
              display: 'inline-block',
            }}
          ></span>
        ))}
      </span>
      {showLabel && (
        <span style={{ fontWeight: 600, fontSize: card ? 17 : 14, letterSpacing: '0.04em', color: l.text }}>{l.label}</span>
      )}
    </span>
  );
}
