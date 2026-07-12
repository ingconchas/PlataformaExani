import React from 'react';

/** Buscador UNX con icono de lupa. */
export function SearchInput({ placeholder = 'Buscar…', value, onChange, disabled = false, fullWidth = false }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', width: fullWidth ? '100%' : 280, fontFamily: 'var(--unx-font-sans)' }}>
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--unx-text-muted)" strokeWidth="1.5" strokeLinecap="round"
        style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        role="searchbox"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: '100%',
          height: 'var(--unx-control-h)',
          padding: '0 14px 0 42px',
          border: `1.5px solid ${focus ? 'var(--unx-blue)' : 'var(--unx-border-strong)'}`,
          borderRadius: 'var(--unx-radius-control)',
          fontFamily: 'var(--unx-font-sans)',
          fontSize: 16,
          color: 'var(--unx-text)',
          background: disabled ? 'var(--unx-disabled-bg)' : '#FFFFFF',
          outline: 'none',
          boxShadow: focus ? 'var(--unx-focus-ring)' : 'none',
          transition: 'border-color var(--unx-transition), box-shadow var(--unx-transition)',
        }}
      />
    </div>
  );
}
