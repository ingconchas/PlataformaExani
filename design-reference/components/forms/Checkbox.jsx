import React from 'react';

/** Checkbox UNX — cuadro 20px, marca blanca sobre azul cuando está activo. */
export function Checkbox({ label, checked = false, onChange, disabled = false }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--unx-font-sans)' }}>
      <span style={{ position: 'relative', display: 'inline-flex', width: 20, height: 20 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'inherit' }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            border: checked ? 'none' : '1.5px solid var(--unx-border-strong)',
            background: disabled ? 'var(--unx-disabled-bg)' : checked ? 'var(--unx-blue)' : '#FFFFFF',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: focus ? 'var(--unx-focus-ring)' : 'none',
            transition: 'background var(--unx-transition)',
            boxSizing: 'border-box',
          }}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={disabled ? 'var(--unx-disabled-text)' : '#FFFFFF'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </span>
      {label && <span style={{ fontSize: 16, lineHeight: '24px', color: disabled ? 'var(--unx-disabled-text)' : 'var(--unx-text)' }}>{label}</span>}
    </label>
  );
}
