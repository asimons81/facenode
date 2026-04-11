// @facenode/ui
// Shared UI components, design tokens, and theme.
// STUB — full implementation in Phase 3/5.

// Design tokens — exported early so apps can reference them in CSS-in-JS or inline styles.
export const tokens = {
  color: {
    accent: '#4FB7A0',
    bg: '#0a0a0a',
    bgSurface: '#141414',
    bgElevated: '#1e1e1e',
    border: '#2a2a2a',
    textPrimary: '#e0e0e0',
    textMuted: '#888888',
    error: '#e05c5c',
    warning: '#e0a85c',
  },
  font: {
    mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    sans: "'Inter', system-ui, sans-serif",
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
} as const;

export type Tokens = typeof tokens;
