import { NextRequest, NextResponse } from 'next/server';

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (and the `middleware`
// export to `proxy`). The file runs on the Edge Runtime, which does NOT
// have Node.js globals like `Buffer` or `node:crypto`. Use Web APIs
// (`btoa`, `crypto.getRandomValues`) instead.

export function proxy(req: NextRequest) {

  if (req.nextUrl.pathname === '/telebirr-stub' &&
      (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_TELEBIRR_ENV === 'production')) {
    return new NextResponse(null, { status: 404 });
  }

  // Edge-runtime-safe nonce: `crypto.randomUUID()` returns a UUID string;
  // base64-encode it with `btoa` (Web API) instead of `Buffer.from(...).toString('base64')`
  // (Node.js, not available on Edge).
  const nonce = btoa(crypto.randomUUID());

  // FE-001: build CSP connect-src from env vars instead of hardcoding Telebirr
  // prod URL (which broke testbed checkout) and Sentry root URL (which is
  // wrong — Sentry ingest uses <org>.ingest.sentry.io).
  const telebirrHost = process.env.NEXT_PUBLIC_TELEBIRR_ENV === 'production'
    ? 'https://superapp.ethiomobilemoney.et'
    : 'https://developerportal.ethiotelebirr.et';
  // Parse the Sentry DSN to extract the ingest host (e.g. https://<key>@o<org>.ingest.sentry.io/<project>).
  let sentryHost = '';
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      const u = new URL(process.env.NEXT_PUBLIC_SENTRY_DSN);
      sentryHost = `${u.protocol}//${u.host}`;
    } catch { /* invalid DSN — skip */ }
  } else if (process.env.SENTRY_DSN) {
    try {
      const u = new URL(process.env.SENTRY_DSN);
      sentryHost = `${u.protocol}//${u.host}`;
    } catch { /* invalid DSN — skip */ }
  }
  const tileServer = process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? '';
  const carto = process.env.NEXT_PUBLIC_CARTO_API_KEY ? 'https://*.cartocdn.com https://gcp.carto.com' : '';
  const mapbox = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ? 'https://*.mapbox.com' : '';

  const connectSrc = ['\'self\'', telebirrHost, sentryHost, tileServer, carto, mapbox]
    .filter(Boolean).join(' ');

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,

    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc}`,
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
