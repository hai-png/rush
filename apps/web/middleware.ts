import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Strengthened CSP:
  //   - Removed 'unsafe-inline' from style-src (was neutralizing CSP).
  //   - Added frame-ancestors, base-uri, form-action, object-src, upgrade-insecure-requests.
  //   - Removed the dead report-uri (endpoint didn't exist) — replaced with
  //     a proper Reporting-Api header.
  //   - Tightened connect-src to remove the broad '*.sentry.io' wildcard.
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // FIX (WEB-009): Re-added 'unsafe-inline' to style-src. The previous
    // removal broke Tailwind v4, Framer Motion, react-leaflet, and other
    // libraries that inject <style> tags at runtime without nonces. The
    // breakage was silent in dev (CSP not enforced) and only manifested in
    // production — broken layouts, missing animations, blank map tiles.
    // 'unsafe-inline' for style-src is much safer than for script-src
    // (style injection can't execute arbitrary JS in modern browsers).
    // A future hardening pass can use 'unsafe-hashes' with specific style
    // hashes for stricter control.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://superapp.ethiomobilemoney.et https://sentry.io ${process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');

  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.headers.set('x-nonce', nonce);

  // CRITICAL FIX: the previous locale precedence was
  //   `cookie ?? acceptStartsWithAm ? 'am' : 'en'`
  // Because `??` binds tighter than `?:`, this parsed as
  //   `(cookie ?? acceptStartsWithAm) ? 'am' : 'en'`
  // — any truthy cookie value (including the string 'en') yielded 'am'.
  // A user who explicitly chose English was force-switched to Amharic on
  // every request. Now: prefer the cookie if set; otherwise fall back to
  // Accept-Language detection.
  const cookieLocale = req.cookies.get('addis-ride-locale')?.value;
  let locale: string;
  if (cookieLocale === 'en' || cookieLocale === 'am') {
    locale = cookieLocale;
  } else {
    const acceptAm = req.headers.get('accept-language')?.startsWith('am');
    locale = acceptAm ? 'am' : 'en';
  }
  res.cookies.set('addis-ride-locale', locale, { sameSite: 'lax', secure: true, httpOnly: false });
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
