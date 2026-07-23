// / P2-38: shared color tokens for the mobile app with dark mode.
// Use useTheme() hook to get the current palette based on the system preference.
export const lightColors = {
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  background: '#f5f5f5',
  card: '#ffffff',
  text: '#1a1a1a',
  textMuted: '#666666',
  textLight: '#999999',
  border: '#e0e0e0',
  error: '#dc2626',
  errorBg: '#fee2e2',
  errorText: '#991b1b',
  success: '#16a34a',
  warning: '#f59e0b',
  white: '#ffffff',
} as const;

export const darkColors = {
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  background: '#121212',
  card: '#1e1e1e',
  text: '#e5e5e5',
  textMuted: '#a3a3a3',
  textLight: '#6b7280',
  border: '#333333',
  error: '#ef4444',
  errorBg: '#450a0a',
  errorText: '#fca5a5',
  success: '#22c55e',
  warning: '#fbbf24',
  white: '#ffffff',
} as const;

export type ThemeColors = typeof lightColors;

// Backward compat — default export is the light palette.
export const colors = lightColors;
export type ColorKey = keyof typeof lightColors;
