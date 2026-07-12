import React from 'react';

/* Iconos de línea estilo Lucide (24×24, trazo 1.5) usados por la navegación de staff. */
const NAV_ICONS = {
  inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  alumnos: <><circle cx="9" cy="7.5" r="3.5" /><path d="M2.5 20.5V19a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 5.8" /><path d="M18.5 14.2a5 5 0 0 1 3 4.8v1.5" /></>,
  grupos: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  permisos: <><path d="M12 21.5S4.5 17.7 4.5 12V5.2L12 2.5l7.5 2.7V12c0 5.7-7.5 9.5-7.5 9.5z" /><path d="m9 11.5 2 2 4-4" /></>,
  temario: <><path d="M2.5 4h6A3.5 3.5 0 0 1 12 7.5V21a3 3 0 0 0-3-3H2.5z" /><path d="M21.5 4h-6A3.5 3.5 0 0 0 12 7.5V21a3 3 0 0 1 3-3h6.5z" /></>,
  resumen: <><path d="M3 3v17a1 1 0 0 0 1 1h17" /><path d="M8 16v-5" /><path d="M13 16V8" /><path d="M18 16V7.5" /></>,
  reactivos: <><ellipse cx="12" cy="5" rx="8.5" ry="3" /><path d="M3.5 5v14c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3V5" /><path d="M3.5 12c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3" /></>,
  examenes: <><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /><path d="M9 13h6" /><path d="M9 17h6" /></>,
  salir: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
};

function NavIcon({ name, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {NAV_ICONS[name] || NAV_ICONS.inicio}
    </svg>
  );
}

/**
 * Barra lateral de navegación del panel institucional (Administradora e Instructor).
 * 256 px en desktop; `collapsed` la reduce a 72 px solo iconos con menú hamburguesa (tablet).
 * Elemento activo: fondo azul suave + barra indicadora azul UNX en el borde izquierdo.
 */
export function SidebarNav({
  logoSrc = '../../assets/logo/unx-logotipo.png',
  user = { name: 'Usuaria UNX', role: 'Rol' },
  items = [],
  activeId,
  collapsed = false,
  onNavigate,
  onLogout,
}) {
  const [hoverId, setHoverId] = React.useState(null);
  const initials = (user.name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const itemStyle = (id) => ({
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 12,
    width: '100%',
    height: 44,
    padding: collapsed ? 0 : '0 12px',
    border: 'none',
    borderRadius: 'var(--unx-radius-control)',
    background: id === activeId ? 'var(--unx-blue-tint)' : id === hoverId ? '#F3F4F6' : 'transparent',
    color: id === activeId ? 'var(--unx-blue)' : 'var(--unx-text)',
    fontFamily: 'var(--unx-font-sans)',
    fontWeight: id === activeId ? 600 : 400,
    fontSize: 15,
    lineHeight: '20px',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background var(--unx-transition), color var(--unx-transition)',
  });

  return (
    <aside
      style={{
        width: collapsed ? 72 : 256,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--unx-surface)',
        borderRight: '1px solid var(--unx-border)',
        fontFamily: 'var(--unx-font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '20px 0 12px' : '20px 20px 12px',
        }}
      >
        {!collapsed && <img src={logoSrc} alt="UNX" style={{ height: 30, width: 'auto' }} />}
        {collapsed && (
          <button
            type="button"
            aria-label="Abrir menú"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              border: 'none',
              borderRadius: 'var(--unx-radius-control)',
              background: 'transparent',
              color: 'var(--unx-text)',
              cursor: 'pointer',
            }}
          >
            <NavIcon name="menu" />
          </button>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10,
          padding: collapsed ? '4px 0 12px' : '4px 20px 16px',
          borderBottom: '1px solid var(--unx-border)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--unx-blue-tint)',
            color: 'var(--unx-blue)',
            fontWeight: 600,
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {initials || '?'}
        </span>
        {!collapsed && (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--unx-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </span>
            {user.role && <span style={{ fontSize: 12, color: 'var(--unx-text-muted)' }}>{user.role}</span>}
          </span>
        )}
      </div>

      <nav style={{ flex: 1, display: 'grid', gap: 2, alignContent: 'start', padding: collapsed ? '12px 14px' : '12px' }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            title={collapsed ? item.label : undefined}
            aria-current={item.id === activeId ? 'page' : undefined}
            onClick={() => onNavigate && onNavigate(item.id)}
            onMouseEnter={() => setHoverId(item.id)}
            onMouseLeave={() => setHoverId(null)}
            style={itemStyle(item.id)}
          >
            {item.id === activeId && (
              <span
                style={{
                  position: 'absolute',
                  left: collapsed ? -14 : -12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 24,
                  borderRadius: '0 3px 3px 0',
                  background: 'var(--unx-blue)',
                }}
              />
            )}
            <NavIcon name={item.icon} />
            {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
          </button>
        ))}
      </nav>

      <div style={{ padding: collapsed ? '12px 14px' : '12px', borderTop: '1px solid var(--unx-border)' }}>
        <button
          type="button"
          title={collapsed ? 'Cerrar sesión' : undefined}
          onClick={onLogout}
          onMouseEnter={() => setHoverId('__logout')}
          onMouseLeave={() => setHoverId(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 12,
            width: '100%',
            height: 44,
            padding: collapsed ? 0 : '0 12px',
            border: 'none',
            borderRadius: 'var(--unx-radius-control)',
            background: hoverId === '__logout' ? '#F3F4F6' : 'transparent',
            color: 'var(--unx-text-muted)',
            fontFamily: 'var(--unx-font-sans)',
            fontWeight: 400,
            fontSize: 15,
            cursor: 'pointer',
            transition: 'background var(--unx-transition)',
          }}
        >
          <NavIcon name="salir" />
          {!collapsed && 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  );
}
