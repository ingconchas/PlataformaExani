import React from 'react';

/** Tabs UNX — pestaña activa en azul con subrayado de 2px. */
export function Tabs({ tabs = [], activeId, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--unx-border)', fontFamily: 'var(--unx-font-sans)' }}>
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            onClick={() => onChange && onChange(t.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active ? '2px solid var(--unx-blue)' : '2px solid transparent',
              marginBottom: -1,
              padding: '10px 16px',
              fontFamily: 'var(--unx-font-sans)',
              fontWeight: 600,
              fontSize: 14,
              lineHeight: '20px',
              color: active ? 'var(--unx-blue)' : 'var(--unx-text-muted)',
              cursor: 'pointer',
              transition: 'color var(--unx-transition)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
