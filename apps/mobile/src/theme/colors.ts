// P2-33 / FE-037: shared color tokens for the mobile app.
export const colors = {
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

export type ColorKey = keyof typeof colors;
