import { NextRequest, NextResponse } from 'next/server';

// P1-54 / API-033 / OPS-021: CORS middleware.
//
// Previously there was no middleware.ts and no Access-Control-Allow-* headers
// anywhere. Same-origin requests (web app calling /api/v1/*) work fine without
// CORS, but any cross-origin caller (marketing site, partner integration,
// browser-based admin tool) was blocked by the browser.
//
// Behavior:
//   1. For OPTIONS preflight: respond with CORS headers + 204.
//   2. For actual requests: add CORS headers to the response.
//   3. Allowlist of origins (CORS_ORIGINS env var, comma-separated, falls
//      back to APP_BASE_URL). For credentialed requests (cookies), the
//      origin must be echoed exactly — '*' is not allowed.
//   4. Credentials allowed (cookies + Authorization header).
//   5. Expose x-request-id so clients can correlate errors.

function getAllowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return [...new Set([base, ...fromEnv])];
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = getAllowedOrigins();
  const isAllowed = origin && allowed.includes(origin);

  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    const res = NextResponse.json(null, { status: 204 });
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key');
      res.headers.set('Access-Control-Max-Age', '86400');
      res.headers.set('Access-Control-Expose-Headers', 'x-request-id, retry-after');
    }
    return res;
  }

  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Expose-Headers', 'x-request-id, retry-after');
  }
  return res;
}

export const config = {
  // Only run middleware on API routes — pages don't need CORS.
  matcher: ['/api/:path*'],
};
