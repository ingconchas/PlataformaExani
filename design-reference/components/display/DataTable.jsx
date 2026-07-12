import React from 'react';

/** Tabla de datos UNX — encabezado ordenable, hover por fila, acciones, paginación y estado vacío. */
export function DataTable({ columns = [], rows = [], sortBy, sortDir = 'asc', onSort, page = 1, pageCount = 1, onPageChange, emptyTitle = 'Sin resultados', emptyText, emptyAction }) {
  const [hoverRow, setHoverRow] = React.useState(-1);
  const th = {
    padding: '12px 16px',
    fontFamily: 'var(--unx-font-condensed)',
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--unx-text-muted)',
    borderBottom: '1px solid var(--unx-border)',
    whiteSpace: 'nowrap',
  };
  const td = {
    padding: '14px 16px',
    fontFamily: 'var(--unx-font-sans)',
    fontSize: 15,
    lineHeight: '22px',
    color: 'var(--unx-text)',
    borderBottom: '1px solid var(--unx-border)',
  };
  const alignOf = (c) => c.align || 'left';
  if (rows.length === 0) {
    return (
      <div style={{ background: 'var(--unx-surface)', border: '1px solid var(--unx-border)', borderRadius: 'var(--unx-radius-card)', boxShadow: 'var(--unx-shadow-sm)', padding: 40, textAlign: 'center', fontFamily: 'var(--unx-font-sans)' }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--unx-border-strong)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--unx-ink)', marginBottom: 4 }}>{emptyTitle}</div>
        {emptyText && <div style={{ fontSize: 14, color: 'var(--unx-text-muted)', marginBottom: emptyAction ? 16 : 0 }}>{emptyText}</div>}
        {emptyAction}
      </div>
    );
  }
  return (
    <div style={{ background: 'var(--unx-surface)', border: '1px solid var(--unx-border)', borderRadius: 'var(--unx-radius-card)', boxShadow: 'var(--unx-shadow-sm)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ ...th, textAlign: alignOf(c) }}>
                {c.sortable ? (
                  <button
                    type="button"
                    onClick={() => onSort && onSort(c.key)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: sortBy === c.key ? 'var(--unx-blue)' : 'inherit', cursor: 'pointer' }}
                  >
                    {c.label}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transform: sortBy === c.key && sortDir === 'desc' ? 'rotate(180deg)' : 'none', opacity: sortBy === c.key ? 1 : 0.4 }}>
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onMouseEnter={() => setHoverRow(i)}
              onMouseLeave={() => setHoverRow(-1)}
              style={{ background: hoverRow === i ? 'var(--unx-bg)' : 'transparent', transition: 'background var(--unx-transition)' }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ ...td, textAlign: alignOf(c), borderBottom: i === rows.length - 1 ? 'none' : td.borderBottom }}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, padding: '10px 16px', borderTop: '1px solid var(--unx-border)', fontFamily: 'var(--unx-font-sans)' }}>
          <PageBtn label="‹" disabled={page <= 1} onClick={() => onPageChange && onPageChange(page - 1)} />
          {pageList(page, pageCount).map((p, i) =>
            p === '…'
              ? <span key={'e' + i} style={{ minWidth: 24, textAlign: 'center', color: 'var(--unx-text-muted)', fontSize: 14 }}>…</span>
              : <PageBtn key={p} label={String(p)} active={p === page} onClick={() => onPageChange && onPageChange(p)} />
          )}
          <PageBtn label="›" disabled={page >= pageCount} onClick={() => onPageChange && onPageChange(page + 1)} />
        </div>
      )}
    </div>
  );
}

function pageList(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = [1, 2, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount);
  const uniq = [...new Set(keep)].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of uniq) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

function PageBtn({ label, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 32,
        height: 32,
        padding: '0 6px',
        border: 'none',
        borderRadius: 6,
        background: active ? 'var(--unx-blue)' : 'transparent',
        color: disabled ? 'var(--unx-disabled-text)' : active ? '#FFFFFF' : 'var(--unx-text)',
        fontFamily: 'var(--unx-font-sans)',
        fontWeight: 600,
        fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
