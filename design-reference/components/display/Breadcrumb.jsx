import React from 'react';

/** Breadcrumb UNX — el último elemento es la página actual (texto oscuro, sin enlace). */
export function Breadcrumb({ items = [] }) {
  return (
    <nav aria-label="Ruta de navegación" style={{ fontFamily: 'var(--unx-font-sans)', fontSize: 14, lineHeight: '20px' }}>
      <ol style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {last ? (
                <span aria-current="page" style={{ fontWeight: 600, color: 'var(--unx-ink)' }}>{item.label}</span>
              ) : (
                <a
                  href={item.href || '#'}
                  onClick={(e) => { if (!item.href) e.preventDefault(); if (item.onClick) item.onClick(); }}
                  style={{ color: 'var(--unx-text-muted)', textDecoration: 'none' }}
                >
                  {item.label}
                </a>
              )}
              {!last && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--unx-border-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
