import React from 'react';

/** Campo de contraseña UNX con botón mostrar/ocultar. */
export function PasswordInput({ label = 'Contraseña', id, placeholder, value, onChange, error, disabled = false }) {
  const [focus, setFocus] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const autoId = React.useId();
  const inputId = id || autoId;
  const borderColor = error ? 'var(--unx-error)' : focus ? 'var(--unx-blue)' : 'var(--unx-border-strong)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px', color: 'var(--unx-ink)' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            height: 'var(--unx-control-h)',
            padding: '0 48px 0 14px',
            border: `1.5px solid ${borderColor}`,
            borderRadius: 'var(--unx-radius-control)',
            fontFamily: 'var(--unx-font-sans)',
            fontSize: 16,
            color: 'var(--unx-text)',
            background: disabled ? 'var(--unx-disabled-bg)' : '#FFFFFF',
            outline: 'none',
            boxShadow: focus && !error ? 'var(--unx-focus-ring)' : 'none',
            transition: 'border-color var(--unx-transition), box-shadow var(--unx-transition)',
          }}
        />
        <button
          type="button"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 36,
            height: 36,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            color: 'var(--unx-text-muted)',
          }}
        >
          {visible ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--unx-error)' }}>{error}</span>
        </div>
      )}
    </div>
  );
}
