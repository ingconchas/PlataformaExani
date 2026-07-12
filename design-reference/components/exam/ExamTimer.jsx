import React from 'react';

/**
 * Temporizador de examen UNX — chip con reloj y cuenta regresiva en Barlow Condensed (tabular-nums).
 * En alerta (últimos 5 minutos) el fondo pasa a naranja #D64801 con texto blanco.
 */
export function ExamTimer({ time = '00:00:00', alert = false }) {
  return (
    <span
      role="timer"
      aria-live={alert ? 'assertive' : 'off'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: alert ? 'var(--unx-orange)' : '#FFFFFF',
        border: alert ? 'none' : '1.5px solid var(--unx-border-strong)',
        borderRadius: 'var(--unx-radius-pill)',
        padding: '8px 16px',
        fontFamily: 'var(--unx-font-condensed)',
        fontWeight: 600,
        fontSize: 18,
        lineHeight: '22px',
        letterSpacing: '0.03em',
        color: alert ? '#FFFFFF' : 'var(--unx-ink)',
        fontVariantNumeric: 'tabular-nums',
        transition: 'background var(--unx-transition), color var(--unx-transition)',
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {time}
    </span>
  );
}
