import React from 'react';

/** Select UNX con label, focus con anillo azul y estado de error. */
export function Select({ label, id, options = [], value, onChange, error, disabled = false, placeholder }) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useId();
  const selectId = id || autoId;
  const borderColor = error ? 'var(--unx-error)' : focus ? 'var(--unx-blue)' : 'var(--unx-border-strong)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)' }}>
      {label && (
        <label htmlFor={selectId} style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px', color: 'var(--unx-ink)' }}>
          {label}
        </label>
      )}
      <select
        id={selectId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          height: 'var(--unx-control-h)',
          padding: '0 14px',
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
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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
