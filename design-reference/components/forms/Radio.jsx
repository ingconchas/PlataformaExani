import React from 'react';

/** Radio UNX — círculo 20px con punto azul cuando está activo. */
export function Radio({ label, name, value, checked = false, onChange, disabled = false }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--unx-font-sans)' }}>
      <span style={{ position: 'relative', display: 'inline-flex', width: 20, height: 20 }}>
        <input
          type="radio"
          name={name}
          value={value}
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
            borderRadius: '50%',
            border: checked ? '6px solid var(--unx-blue)' : '1.5px solid var(--unx-border-strong)',
            background: disabled ? 'var(--unx-disabled-bg)' : '#FFFFFF',
            boxShadow: focus ? 'var(--unx-focus-ring)' : 'none',
            transition: 'border var(--unx-transition)',
            boxSizing: 'border-box',
          }}
        ></span>
      </span>
      {label && <span style={{ fontSize: 16, lineHeight: '24px', color: disabled ? 'var(--unx-disabled-text)' : 'var(--unx-text)' }}>{label}</span>}
    </label>
  );
}
