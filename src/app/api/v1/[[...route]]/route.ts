
import { NextRequest, NextResponse } from 'next/server';
import { findRoute } from '@/lib/api-routes';
import { api } from '@/lib/api';
import { verifySession } from '@/lib/auth';
import { NotFoundError, ForbiddenError, toErrorEnvelope } from '@/lib/errors';
import { createHash, timingSafeEqual } from 'node:crypto';

type Ctx = { params: Promise<{ route?: string[] }> };

function handle(method: string) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const p = await ctx.params;
    const segments: string[] = p.route ?? [];
    const path = '/' + segments.join('/');

    const found = findRoute(method, path);
    if (!found) {
      const requestId = crypto.randomUUID();
      const { status, body } = toErrorEnvelope(new NotFoundError(`No route for ${method} ${path}`), requestId);
      return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
    }

    if (found.entry.raw) {
      return handleRaw(req, ctx, found);
    }

    const wrapped = api(found.entry.options, async (innerCtx) => {
      return found.entry.handler({
        ...innerCtx,
        params: { ...p, ...found.params },
      });
    });

    // Cast ctx to any: api()'s ctx type expects Promise<Record<string,string>>,
    // but Next's catch-all gives Promise<{ route?: string[] }>. The wrapper only
    // uses ctx.params inside its own handler, and we override params above.
    return wrapped(req, ctx as any);
  };
}

async function handleRaw(
  req: NextRequest,
  ctx: Ctx,
  found: { entry: any; params: Record<string, string> },
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const p = await ctx.params;

  try {
    // Lightweight auth: read session from cookie or bearer.
    const cookieHeader = req.headers.get('cookie') ?? '';
    let cookieToken: string | undefined;
    for (const part of cookieHeader.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'addis-session') { cookieToken = v.join('='); break; }
    }
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const token = bearer ?? cookieToken;

    let session: any = null;
    if (token) {
      try {
        session = await verifySession(token);
      } catch (err) {
        const { status, body } = toErrorEnvelope(err, requestId);
        return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
      }
    }

    if (found.entry.options.requireAuth && !session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    if (found.entry.options.requireRole && session) {
      if (!found.entry.options.requireRole.includes(session.role)) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient role', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
      }
    }

    // CSRF check for raw POST routes. Webhooks and cron are exempt (they
    // don't come from browsers and use their own auth: signature / secret).
    const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
    const CSRF_EXEMPT_RAW = [/^\/api\/v1\/webhooks\//, /^\/api\/v1\/cron\//];
    if (!SAFE_METHODS.has(req.method) && !CSRF_EXEMPT_RAW.some((re) => re.test(req.nextUrl.pathname))) {
      const cookieHeader = req.headers.get('cookie') ?? '';
      const readCookie = (name: string): string | undefined => {
        for (const part of cookieHeader.split(';')) {
          const [k, ...v] = part.trim().split('=');
          if (k === name) return v.join('=');
        }
        return undefined;
      };
      const sessionToken = readCookie('addis-session');
      // Browser-like requests (session cookie present) must pass the
      // double-submit CSRF check. Bearer-only and anonymous requests are
      // not subject to CSRF (handled by the api() wrapper for non-raw routes).
      if (sessionToken) {
        const csrfCookie = readCookie('addis-csrf');
        const csrfHeader = req.headers.get('x-csrf-token');
        if (!csrfCookie || !csrfHeader) {
          return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'CSRF token missing', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
        }
        const a = createHash('sha256').update(csrfCookie).digest();
        const b = createHash('sha256').update(csrfHeader).digest();
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'CSRF token mismatch', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
        }
      }
    }

    const result = await found.entry.handler(req, session, found.params, { requestId });
    if (result instanceof NextResponse) {
      result.headers.set('x-request-id', requestId);
      return result;
    }
    return NextResponse.json(result ?? { data: null }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
  }
}

export const GET = handle('GET');
export const POST = handle('POST');
export const PUT = handle('PUT');
export const PATCH = handle('PATCH');
export const DELETE = handle('DELETE');
