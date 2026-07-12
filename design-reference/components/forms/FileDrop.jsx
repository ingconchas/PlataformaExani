import React from 'react';

/** Zona de carga de archivo UNX (arrastrar y soltar), pensada para el CSV de alumnos. */
export function FileDrop({ label, accept = '.csv', hint = 'Arrastra tu archivo CSV aquí o', buttonText = 'Elegir archivo', fileName, onFile, disabled = false }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef(null);
  const handleFiles = (files) => {
    if (files && files[0] && onFile) onFile(files[0]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--unx-font-sans)' }}>
      {label && <span style={{ fontWeight: 600, fontSize: 14, lineHeight: '20px', color: 'var(--unx-ink)' }}>{label}</span>}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handleFiles(e.dataTransfer.files); }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          padding: '28px 20px',
          border: `2px dashed ${dragging ? 'var(--unx-blue)' : 'var(--unx-border-strong)'}`,
          borderRadius: 'var(--unx-radius-card)',
          background: dragging ? 'var(--unx-blue-tint)' : disabled ? 'var(--unx-disabled-bg)' : 'var(--unx-bg)',
          transition: 'border-color var(--unx-transition), background var(--unx-transition)',
          textAlign: 'center',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={dragging ? 'var(--unx-blue)' : 'var(--unx-text-muted)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <polyline points="9 15 12 12 15 15" />
        </svg>
        {fileName ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--unx-green)' }}>✓ {fileName}</span>
        ) : (
          <span style={{ fontSize: 14, color: 'var(--unx-text-muted)' }}>{hint}</span>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current && inputRef.current.click()}
          style={{
            height: 36,
            padding: '0 16px',
            border: '1.5px solid var(--unx-blue)',
            borderRadius: 'var(--unx-radius-control)',
            background: '#FFFFFF',
            color: 'var(--unx-blue)',
            fontFamily: 'var(--unx-font-sans)',
            fontWeight: 600,
            fontSize: 14,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {buttonText}
        </button>
        <input ref={inputRef} type="file" accept={accept} onChange={(e) => handleFiles(e.target.files)} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
