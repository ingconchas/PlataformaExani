import React from 'react';

/**
 * Encabezado mínimo del modo examen: nombre de la sección, contador "12 de 90"
 * y temporizador en Barlow Condensed. Sin navegación, gamificación ni forma de
 * salir accidentalmente — es el único chrome visible durante el simulacro.
 * En alerta (últimos 5 minutos) el temporizador pasa a naranja con texto blanco.
 */
export function ExamHeader({ section = 'Sección', current = 1, total = 90, time = '00:00:00', alert = false }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxSizing: 'border-box',
        width: '100%',
        padding: '10px 14px',
        background: 'var(--unx-surface)',
        borderBottom: '1px solid var(--unx-border)',
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontWeight: 600,
          fontSize: 14,
          lineHeight: '20px',
          color: 'var(--unx-ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {section}
      </span>
      <span
        style={{
          fontFamily: 'var(--unx-font-condensed)',
          fontWeight: 600,
          fontSize: 18,
          letterSpacing: '0.03em',
          color: 'var(--unx-text)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {current} de {total}
      </span>
      <span
        role="timer"
        aria-live={alert ? 'assertive' : 'off'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: alert ? 'var(--unx-orange)' : 'var(--unx-surface)',
          border: alert ? 'none' : '1.5px solid var(--unx-border-strong)',
          borderRadius: 'var(--unx-radius-pill)',
          padding: '5px 10px',
          fontFamily: 'var(--unx-font-condensed)',
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: '0.03em',
          color: alert ? '#FFFFFF' : 'var(--unx-ink)',
          fontVariantNumeric: 'tabular-nums',
          transition: 'background var(--unx-transition), color var(--unx-transition)',
          flexShrink: 0,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {time}
      </span>
    </header>
  );
}
