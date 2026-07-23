// Design tokens for the Addis Ride mobile app.
//
// Single source of truth for colors, spacing, radius, typography, and weight.
// All screens and components should import from here instead of using raw hex
// values — this makes future dark-mode / theming work a one-file change.
//
// (MOB-05c — every screen previously hardcoded hex codes like `#2563eb`,
// `#fff`, `#666`, `#f5f5f5`, making theme changes impossible.)

export const colors = {
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  secondary: '#0ea5e9',
  background: '#ffffff',
  surface: '#f5f5f5',
  text: '#1a1a1a',
  textMuted: '#666666',
  textLight: '#999999',
  border: '#e5e7eb',
  borderSubtle: '#e0e0e0',
  card: '#ffffff',
  success: '#16a34a',
  successBg: '#dcfce7',
  warning: '#f59e0b',
  error: '#dc2626',
  errorBg: '#fee2e2',
  errorText: '#991b1b',
  danger: '#dc2626',
  info: '#2563eb',
  infoBg: '#eff6ff',
  infoBorder: '#bfdbfe',
  badgeBg: '#f0f0f0',
  white: '#ffffff',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type ThemeColors = typeof colors;
