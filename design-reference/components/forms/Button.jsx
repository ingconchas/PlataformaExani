import React from 'react';

/** Botón UNX — primario (azul), secundario (outline), terciario (ghost) o destructivo (danger). */
export function Button({ variant = 'primary', size = 'md', disabled = false, fullWidth = false, type = 'button', icon, onClick, children }) {
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const styles = {
    primary: {
      background: disabled ? 'var(--unx-disabled-bg)' : hover ? 'var(--unx-blue-hover)' : 'var(--unx-blue)',
      color: disabled ? 'var(--unx-disabled-text)' : '#FFFFFF',
      border: 'none',
    },
    secondary: {
      background: disabled ? '#FFFFFF' : hover ? 'var(--unx-blue-tint)' : '#FFFFFF',
      color: disabled ? 'var(--unx-disabled-text)' : 'var(--unx-blue)',
      border: disabled ? '1.5px solid var(--unx-border)' : '1.5px solid var(--unx-blue)',
    },
    ghost: {
      background: disabled ? 'transparent' : hover ? 'var(--unx-blue-tint)' : 'transparent',
      color: disabled ? 'var(--unx-disabled-text)' : 'var(--unx-blue)',
      border: 'none',
    },
    danger: {
      background: disabled ? 'var(--unx-disabled-bg)' : hover ? '#B91C1C' : 'var(--unx-error)',
      color: disabled ? 'var(--unx-disabled-text)' : '#FFFFFF',
      border: 'none',
    },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: size === 'lg' ? 'var(--unx-control-h-lg)' : size === 'sm' ? '36px' : 'var(--unx-control-h)',
        padding: size === 'sm' ? '0 16px' : '0 24px',
        borderRadius: 'var(--unx-radius-control)',
        fontFamily: 'var(--unx-font-sans)',
        fontWeight: 600,
        fontSize: size === 'sm' ? 14 : 16,
        lineHeight: '24px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background var(--unx-transition), color var(--unx-transition)',
        width: fullWidth ? '100%' : undefined,
        boxShadow: focus && !disabled
          ? (variant === 'danger'
              ? '0 0 0 3px var(--unx-error-tint), 0 0 0 4px var(--unx-error)'
              : '0 0 0 3px var(--unx-blue-tint), 0 0 0 4px var(--unx-blue)')
          : 'none',
        outline: 'none',
        ...styles[variant],
      }}
    >
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
      {children}
    </button>
  );
}
