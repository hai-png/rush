import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js middleware. Runs on every request except static assets.
 *
 * Responsibilities:
 *   1. Generate a per-request CSP nonce and propagate it into the request headers
 *      so Next.js can nonce its own bootstrap/hydration <script> tags.
 *   2. Set the full security header stack (CSP, HSTS, X-Frame-Options,
 *      X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
 *   3. Detect locale from cookie or Accept-Language, fixing the operator-precedence
 *      bug that previously always resolved to 'am'.
 *
 * Why these headers are set here (not in Caddy): CI/CD deploys to Vercel where
 * Caddy is never in the request path. middleware.ts is the only place that
 * runs on every request in both the self-hosted (Caddy) and Vercel deployments.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self' https://superapp.ethiomobilemoney.et https://*.sentry.io ${process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? ''}`,
    `img-src 'self' data: https:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `report-uri /api/v1/csp-report`,
  ].join('; ');

  // CRITICAL: propagate the nonce into the REQUEST headers, not just the response.
  // Without NextResponse.next({ request: { headers } }), Next.js cannot nonce its
  // own bootstrap/hydration <script> tags, and the CSP (script-src 'nonce-...'
  // 'strict-dynamic') blocks ALL of Next.js's own scripts — the app fails to
  // hydrate in production. This is the documented Next.js CSP pattern.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Security headers — must be set here because Vercel deployments don't go
  // through Caddy (which sets these in the self-hosted deployment).
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.headers.set('x-nonce', nonce);

  // Locale detection — fixed operator-precedence bug.
  // Previously: `cookie ?? accept-language-check ? 'am' : 'en'`
  // `??` binds looser than `?:`, so this parsed as
  // `(cookie ?? accept-language-check) ? 'am' : 'en'` — any truthy cookie
  // (e.g. "en") made the whole expression truthy → always 'am'.
  // Now: explicit precedence with parens.
  const cookieLocale = req.cookies.get('addis-ride-locale')?.value;
  const acceptsAmharic = req.headers.get('accept-language')?.startsWith('am') ?? false;
  const locale = cookieLocale === 'am' || cookieLocale === 'en'
    ? cookieLocale
    : acceptsAmharic ? 'am' : 'en';
  res.cookies.set('addis-ride-locale', locale, { path: '/', maxAge: 365 * 24 * 3600 });

  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
