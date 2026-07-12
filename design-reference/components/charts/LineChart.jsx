import React from 'react';

/**
 * Gráfica de línea UNX (SVG puro) — una o varias series, línea punteada de meta en amarillo,
 * leyenda interactiva (clic para aislar una serie) y tooltip de ejemplo "X de Y".
 */
export function LineChart({ series = [], xLabels = [], yMin = 0, yMax = 100, goal, goalLabel = 'Tu meta', width = 520, height = 220, tooltip }) {
  const [activeSeries, setActiveSeries] = React.useState(null);
  const pad = { top: 16, right: 16, bottom: 28, left: 44 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const n = Math.max(...series.map((s) => s.points.length), 2);
  const x = (i) => pad.left + (i * iw) / (n - 1);
  const y = (v) => pad.top + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  return (
    <div style={{ fontFamily: 'var(--unx-font-sans)', display: 'inline-flex', flexDirection: 'column', gap: 10 }}>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {series.map((s, si) => {
            const active = activeSeries == null || activeSeries === si;
            return (
              <button
                key={si}
                type="button"
                onClick={() => setActiveSeries(activeSeries === si ? null : si)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  border: `1.5px solid ${active ? s.color : 'var(--unx-border)'}`,
                  borderRadius: 'var(--unx-radius-pill)',
                  background: active ? '#FFFFFF' : 'var(--unx-disabled-bg)',
                  padding: '4px 12px',
                  fontFamily: 'var(--unx-font-sans)',
                  fontWeight: 600,
                  fontSize: 13,
                  color: active ? 'var(--unx-text)' : 'var(--unx-disabled-text)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: active ? s.color : 'var(--unx-border-strong)' }}></span>
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--unx-border)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fontFamily="var(--unx-font-condensed)" fontWeight="600" fill="var(--unx-text-muted)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {goal != null && (
          <g>
            <line x1={pad.left} x2={width - pad.right} y1={y(goal)} y2={y(goal)} stroke="var(--unx-yellow)" strokeWidth="2.5" strokeDasharray="6 5" />
            <text x={width - pad.right} y={y(goal) - 6} textAnchor="end" fontSize="11" fontFamily="var(--unx-font-condensed)" fontWeight="600" letterSpacing="0.05em" fill="#A87013">
              {goalLabel.toUpperCase()} · {goal}
            </text>
          </g>
        )}
        {series.map((s, si) => {
          const dim = activeSeries != null && activeSeries !== si;
          const pts = s.points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={si} opacity={dim ? 0.18 : 1} style={{ transition: 'opacity 150ms ease' }}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={i === s.points.length - 1 ? 5 : 3.5} fill="#FFFFFF" stroke={s.color} strokeWidth="2.5" />
              ))}
            </g>
          );
        })}
        {xLabels.map((l, i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fontFamily="var(--unx-font-sans)" fill="var(--unx-text-muted)">
            {l}
          </text>
        ))}
        {tooltip && series[tooltip.series] && (
          <g transform={`translate(${x(tooltip.index)}, ${y(series[tooltip.series].points[tooltip.index]) - 14})`}>
            <rect x="-38" y="-26" width="76" height="24" rx="6" fill="var(--unx-ink)" />
            <path d="M -5 -2 L 0 4 L 5 -2 Z" fill="var(--unx-ink)" />
            <text x="0" y="-9" textAnchor="middle" fontSize="12" fontFamily="var(--unx-font-condensed)" fontWeight="600" fill="#FFFFFF">
              {tooltip.text}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
