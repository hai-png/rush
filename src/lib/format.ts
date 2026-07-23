// Shared formatting helpers for ETB currency and dates. Used across app pages
// and components so amounts are rendered consistently with Intl (en-ET / en-GB).
// Standalone (no other project imports) so it can be imported from both client
// components and server code.

const ETB_FORMATTER = new Intl.NumberFormat('en-ET', {
  style: 'currency',
  currency: 'ETB',
  minimumFractionDigits: 2,
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
});

/**
 * Format an amount in ETB given the cents value (smallest currency unit).
 * Example: formatETB(150000) → "ETB 1,500.00"
 */
export function formatETB(cents: number): string {
  return ETB_FORMATTER.format(cents / 100);
}

/** Format a date with both date and time (medium date, short time). */
export function formatDateTime(date: Date | string): string {
  return DATETIME_FORMATTER.format(new Date(date));
}

/** Format a date with only the date part (medium date). */
export function formatDate(date: Date | string): string {
  return DATE_FORMATTER.format(new Date(date));
}
