import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {

  if (req.nextUrl.pathname === '/telebirr-stub' &&
      (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_TELEBIRR_ENV === 'production')) {
    return new NextResponse(null, { status: 404 });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,

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
