import React from 'react';

const STATES = {
  normal: { border: '1.5px solid var(--unx-border-strong)', background: '#FFFFFF', letterBg: 'var(--unx-bg)', letterColor: 'var(--unx-text)', tag: null },
  selected: { border: '2px solid var(--unx-blue)', background: 'var(--unx-blue-tint)', letterBg: 'var(--unx-blue)', letterColor: '#FFFFFF', tag: null },
  correct: { border: '2px solid var(--unx-green)', background: 'var(--unx-green-tint)', letterBg: 'var(--unx-green)', letterColor: '#FFFFFF', tag: 'Respuesta correcta', tagColor: 'var(--unx-green)' },
  incorrect: { border: '2px solid var(--unx-error)', background: 'var(--unx-error-tint)', letterBg: 'var(--unx-error)', letterColor: '#FFFFFF', tag: 'Tu respuesta', tagColor: 'var(--unx-error)' },
};

/**
 * Opción de respuesta UNX (radio card A-D) — normal, seleccionada (borde azul),
 * correcta (verde con check) e incorrecta (rojo con X) para la revisión.
 */
export function AnswerOption({ letter = 'A', children, state = 'normal', tagText, onSelect }) {
  const [hover, setHover] = React.useState(false);
  const s = STATES[state] || STATES.normal;
  const interactive = state === 'normal' || state === 'selected';
  const tag = tagText != null ? tagText : s.tag;
  return (
    <div
      role={interactive ? 'radio' : undefined}
      aria-checked={interactive ? state === 'selected' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onSelect : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        border: state === 'normal' && hover ? '1.5px solid var(--unx-blue)' : s.border,
        borderRadius: 'var(--unx-radius-card)',
        background: s.background,
        padding: '14px 16px',
        fontFamily: 'var(--unx-font-sans)',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'border-color var(--unx-transition), background var(--unx-transition)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: s.letterBg,
          color: s.letterColor,
          fontFamily: 'var(--unx-font-condensed)',
          fontWeight: 600,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        {letter}
      </span>
      <span style={{ flex: 1, fontSize: 16, lineHeight: '24px', color: 'var(--unx-text)' }}>{children}</span>
      {tag && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: s.tagColor, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {state === 'correct' && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {state === 'incorrect' && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          {tag}
        </span>
      )}
    </div>
  );
}
