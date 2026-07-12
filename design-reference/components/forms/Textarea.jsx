import React from 'react';

/** Área de texto UNX con label, focus con anillo azul y estado de error accesible. */
export function Textarea({ label, id, placeholder, value, onChange, rows = 4, helpText, error, disabled = false }) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useId();
  const taId = id || autoId;
  const borderColor = error ? 'var(--unx-error)' : focus ? 'var(--unx-blue)' : 'var(--unx-border-strong)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)' }}>
      {label && (
        <label htmlFor={taId} style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px', color: 'var(--unx-ink)' }}>
          {label}
        </label>
      )}
      <textarea
        id={taId}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: '10px 14px',
          border: `1.5px solid ${borderColor}`,
          borderRadius: 'var(--unx-radius-control)',
          fontFamily: 'var(--unx-font-sans)',
          fontSize: 16,
          lineHeight: '24px',
          color: 'var(--unx-text)',
          background: disabled ? 'var(--unx-disabled-bg)' : '#FFFFFF',
          outline: 'none',
          resize: 'vertical',
          boxShadow: focus && !error ? 'var(--unx-focus-ring)' : 'none',
          transition: 'border-color var(--unx-transition), box-shadow var(--unx-transition)',
        }}
      />
      {helpText && !error && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--unx-text-muted)' }}>{helpText}</span>}
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
