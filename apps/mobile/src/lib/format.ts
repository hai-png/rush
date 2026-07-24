// L fix: mobile app was formatting money via raw cents/100 without toFixed(2),
// so 5000 cents rendered as "50 ETB" instead of "50.00 ETB". This helper
// matches the web app's formatETB from src/lib/format.ts.

export function formatETB(cents: number): string {
  return new Intl.NumberFormat('en-ET', {
    style: 'currency',
    currency: 'ETB',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
