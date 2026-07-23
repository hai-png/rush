import { NextRequest, NextResponse } from 'next/server';

// CORS middleware for cross-origin API callers. Echoes the request origin
// exactly (CORS_ORIGINS allowlist) so credentialed requests work; OPTIONS
// preflight gets a 204 with headers, all other methods add headers to the
// response.

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
      res.headers.set('Access-Control-Expose-Headers', 'x-request-id, retry-after, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
    }
    return res;
  }

  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Expose-Headers', 'x-request-id, retry-after, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
  }
  return res;
}

export const config = {
  // Only run middleware on API routes — pages don't need CORS.
  matcher: ['/api/:path*'],
};
