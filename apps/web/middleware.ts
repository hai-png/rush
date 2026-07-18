import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self' https://superapp.ethiomobilemoney.et https://*.sentry.io ${process.env.NEXT_PUBLIC_TILE_SERVER_URL ?? ''}`,
    `img-src 'self' data: https:`,
    `report-uri /api/v1/csp-report`,
  ].join('; ');

  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('x-nonce', nonce);

  const locale = req.cookies.get('addis-ride-locale')?.value ?? req.headers.get('accept-language')?.startsWith('am') ? 'am' : 'en';
  res.cookies.set('addis-ride-locale', locale as string);
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
