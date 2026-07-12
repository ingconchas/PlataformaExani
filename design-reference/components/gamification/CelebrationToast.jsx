import React from 'react';

const STICKERS = {
  estrella: (
    <svg width="40" height="40" viewBox="0 0 120 120">
      <g stroke="#1F2937" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M24 28 h72 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-40 l-16 16 v-16 h-16 a8 8 0 0 1 -8 -8 v-40 a8 8 0 0 1 8 -8 z" fill="#0228C9" />
        <polygon points="60,38 65,50 78,50 68,58 71.5,71 60,63.5 48.5,71 52,58 42,50 55,50" fill="#FFBF54" strokeWidth="4" />
      </g>
    </svg>
  ),
  corazon: (
    <svg width="40" height="40" viewBox="0 0 120 120">
      <g stroke="#1F2937" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
        <path d="M24 28 h72 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-16 v16 l-16 -16 h-40 a8 8 0 0 1 -8 -8 v-40 a8 8 0 0 1 8 -8 z" fill="#FFBF54" />
        <path d="M60 72 C48 62 42 54 42 47 C42 40 47 36 52 36 C56 36 59 39 60 42 C61 39 64 36 68 36 C73 36 78 40 78 47 C78 54 72 62 60 72 z" fill="#D64801" strokeWidth="4" />
      </g>
    </svg>
  ),
  cursor: (
    <svg width="40" height="40" viewBox="0 0 120 120">
      <g stroke="#1F2937" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
        <polygon points="38,18 38,88 56,72 66,96 78,90 68,67 90,64" fill="#F4EAF5" />
        <circle cx="52" cy="42" r="2.5" fill="#1F2937" stroke="none" />
        <circle cx="63" cy="40" r="2.5" fill="#1F2937" stroke="none" />
        <path d="M52 52 C55 56 60 55 62 51" fill="none" strokeWidth="4" />
      </g>
    </svg>
  ),
};

/** Toast de celebración UNX — sticker del manual (estrella, corazón o cursor) + mensaje de logro. */
export function CelebrationToast({ sticker = 'estrella', title, children, onClose }) {
  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--unx-yellow-tint)',
        border: '1px solid var(--unx-yellow)',
        borderRadius: 'var(--unx-radius-modal)',
        boxShadow: 'var(--unx-shadow-md)',
        padding: '14px 18px',
        fontFamily: 'var(--unx-font-sans)',
        maxWidth: 420,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{STICKERS[sticker] || STICKERS.estrella}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {title && <span style={{ fontWeight: 600, fontSize: 16, lineHeight: '24px', color: 'var(--unx-ink)' }}>{title}</span>}
        {children && <span style={{ fontSize: 14, lineHeight: '20px', color: 'var(--unx-text)' }}>{children}</span>}
      </span>
      {onClose && (
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--unx-text-muted)', cursor: 'pointer', flexShrink: 0, padding: 0 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
