/** Design tokens — single source of truth for color and spacing. */
export const tokens = {
  bg: {
    base: '#0e0e10',
    surface: '#18181b',
    raised: '#1f1f23',
    overlay: 'rgba(0,0,0,0.72)',
  },
  border: {
    subtle: '#26262c',
    default: '#3a3a3d',
    strong: '#4a4a52',
  },
  text: {
    primary: '#efeff1',
    secondary: '#adadb8',
    muted: '#6a6a73',
    inverse: '#0e0e10',
  },
  brand: '#9147ff',
  brandHover: '#a060ff',
  brandActive: '#7239d4',
  status: {
    good: '#5ac95a',
    warn: '#daa520',
    bad: '#cc6666',
  },
  category: {
    exciting: '#ff5a5a',
    funny: '#5ac95a',
    surprising: '#ffb84d',
    other: '#9147ff',
  } as Record<string, string>,
};

export const radius = {
  sm: '4px',
  md: '6px',
  lg: '10px',
};

export const transition = {
  fast: '120ms ease',
  med: '180ms ease',
  slow: '320ms ease',
};
