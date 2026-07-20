// FE-003: shared checkout-URL allowlist. Used by checkout/page.tsx and
// open-seats/page.tsx (was duplicated in both, with `localhost` allowed
// unconditionally — an SSRF vector in production).

const PROD_ALLOWED_HOSTS = new Set([
  'superapp.ethiomobilemoney.et',
  'developerportal.ethiotelebirr.et',
  'developerportal.ethiotelecom.et',
]);

const DEV_ALLOWED_HOSTS = new Set([
  ...PROD_ALLOWED_HOSTS,
  'localhost',
  '127.0.0.1',
]);

export function isAllowedCheckoutUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const isDev = process.env.NODE_ENV === 'development'
      || process.env.NEXT_PUBLIC_TELEBIRR_ENV !== 'production';
    const allowed = isDev ? DEV_ALLOWED_HOSTS : PROD_ALLOWED_HOSTS;
    return allowed.has(u.hostname);
  } catch {
    return false;
  }
}
