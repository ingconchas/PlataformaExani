import React from 'react';

const STATUS = {
  pendiente: { label: 'PENDIENTE', color: 'var(--unx-ink)', background: 'var(--unx-yellow)' },
  completado: { label: 'COMPLETADO', color: 'var(--unx-green)', background: 'var(--unx-green-tint)' },
  repaso: { label: 'REPASO', color: 'var(--unx-purple)', background: 'var(--unx-purple-tint)' },
  cerrado: { label: 'CERRADO', color: 'var(--unx-text-muted)', background: 'var(--unx-disabled-bg)' },
};

/** Tarjeta de examen UNX — nombre, meta (duración/preguntas), fecha límite, badge de estado y CTA. */
export function ExamCard({ name, meta, deadline, deadlineUrgent = false, status = 'pendiente', ctaText, onCta, score }) {
  const s = STATUS[status] || STATUS.pendiente;
  return (
    <div
      style={{
        background: 'var(--unx-surface)',
        border: '1px solid var(--unx-border)',
        borderRadius: 'var(--unx-radius-modal)',
        boxShadow: 'var(--unx-shadow-sm)',
        padding: 20,
        fontFamily: 'var(--unx-font-sans)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 18, lineHeight: '26px', color: 'var(--unx-ink)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontSize: 12, lineHeight: '16px', letterSpacing: 'var(--unx-badge-tracking)', textTransform: 'uppercase', color: s.color, background: s.background, borderRadius: 'var(--unx-radius-pill)', padding: '6px 14px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {s.label}
        </span>
      </div>
      {meta && <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--unx-text-muted)' }}>{meta}</span>}
      {score != null && (
        <span style={{ fontFamily: 'var(--unx-font-condensed)', fontWeight: 600, fontSize: 32, lineHeight: '36px', color: 'var(--unx-ink)', fontVariantNumeric: 'tabular-nums' }}>{score}</span>
      )}
      {deadline && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, lineHeight: '20px', color: deadlineUrgent ? 'var(--unx-error)' : 'var(--unx-orange-text)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          {deadline}
        </span>
      )}
      {ctaText && (
        <button
          type="button"
          onClick={onCta}
          style={{
            height: 'var(--unx-control-h)',
            border: 'none',
            borderRadius: 'var(--unx-radius-control)',
            background: 'var(--unx-blue)',
            color: '#FFFFFF',
            fontFamily: 'var(--unx-font-sans)',
            fontWeight: 600,
            fontSize: 16,
            cursor: 'pointer',
          }}
        >
          {ctaText}
        </button>
      )}
    </div>
  );
}
