import { NextRequest, NextResponse } from 'next/server';

function getAllowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return [...new Set([base, ...fromEnv])];
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = getAllowedOrigins();
  const isAllowed = origin && allowed.includes(origin);

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
  matcher: ['/api/:path*'],
};
