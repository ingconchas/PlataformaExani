import React from 'react';

/** Multiselect UNX con chips removibles y lista desplegable de opciones. */
export function MultiSelect({ label, options = [], value = [], onChange, placeholder = 'Selecciona…', error, disabled = false, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useId();
  const selected = options.filter((o) => value.includes(o.value));
  const borderColor = error ? 'var(--unx-error)' : focus || open ? 'var(--unx-blue)' : 'var(--unx-border-strong)';
  const toggle = (v) => {
    if (!onChange) return;
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)', position: 'relative' }}>
      {label && (
        <label htmlFor={autoId} style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px', color: 'var(--unx-ink)' }}>
          {label}
        </label>
      )}
      <div
        id={autoId}
        role="combobox"
        aria-expanded={open}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen(!open)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          minHeight: 'var(--unx-control-h)',
          padding: '6px 40px 6px 8px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
          border: `1.5px solid ${borderColor}`,
          borderRadius: 'var(--unx-radius-control)',
          background: disabled ? 'var(--unx-disabled-bg)' : '#FFFFFF',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: (focus || open) && !error ? 'var(--unx-focus-ring)' : 'none',
          transition: 'border-color var(--unx-transition), box-shadow var(--unx-transition)',
          position: 'relative',
        }}
      >
        {selected.length === 0 && <span style={{ fontSize: 16, color: 'var(--unx-text-muted)', padding: '0 6px' }}>{placeholder}</span>}
        {selected.map((o) => (
          <span
            key={o.value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--unx-blue-tint)',
              color: 'var(--unx-blue)',
              borderRadius: 'var(--unx-radius-pill)',
              padding: '4px 6px 4px 12px',
              fontSize: 14,
              fontWeight: 600,
              lineHeight: '20px',
            }}
          >
            {o.label}
            <button
              type="button"
              aria-label={`Quitar ${o.label}`}
              onClick={(e) => { e.stopPropagation(); toggle(o.value); }}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, border: 'none', borderRadius: '50%', background: 'transparent', color: 'var(--unx-blue)', cursor: 'pointer', padding: 0 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--unx-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: 'absolute', right: 14, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`, transition: 'transform var(--unx-transition)' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {open && !disabled && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#FFFFFF',
            border: '1px solid var(--unx-border)',
            borderRadius: 'var(--unx-radius-control)',
            boxShadow: 'var(--unx-shadow-md)',
            zIndex: 10,
            overflow: 'hidden',
          }}
        >
          {options.map((o) => {
            const active = value.includes(o.value);
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={active}
                onClick={(e) => { e.stopPropagation(); toggle(o.value); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  fontSize: 15,
                  color: 'var(--unx-text)',
                  background: active ? 'var(--unx-blue-tint)' : '#FFFFFF',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 18, height: 18, borderRadius: 4, boxSizing: 'border-box',
                    border: active ? 'none' : '1.5px solid var(--unx-border-strong)',
                    background: active ? 'var(--unx-blue)' : '#FFFFFF',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                >
                  {active && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                {o.label}
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--unx-error)' }}>{error}</span>
        </div>
      )}
    </div>
  );
}
