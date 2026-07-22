
import { NextRequest, NextResponse } from 'next/server';
import { findRoute } from '@/lib/api-routes';
import { api, csrfCheck, rateLimitCheck, tosGate, readCookie, clientIp, SESSION_COOKIE } from '@/lib/api';
import { verifySession } from '@/lib/auth';
import { NotFoundError, toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted } from '@/lib/scheduler';

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
  ensureSchedulerStarted();
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent') ?? undefined;

  try {
    // ── Auth (same as api()) ────────────────────────────────────────────
    let session: any = null;
    const cookieToken = readCookie(req, SESSION_COOKIE);
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const token = bearer ?? cookieToken;
    if (token) {
      try {
        session = await verifySession(token);
      } catch (err) {
        const { status, body } = toErrorEnvelope(err, requestId);
        return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
      }
    }

    // ── CSRF (shared with api()) ────────────────────────────────────────
    await csrfCheck(req);

    // ── Rate limit (shared with api()) ──────────────────────────────────
    // Raw routes (file uploads, ticket attachments) were previously exempt
    // from rate limiting — that let a malicious user bypass per-IP throttling
    // by hitting /contractor/documents instead of a non-raw equivalent.
    rateLimitCheck(req.nextUrl.pathname, req.method, { session, body: null, ip });

    // ── AuthZ ───────────────────────────────────────────────────────────
    if (found.entry.options.requireAuth && !session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    if (found.entry.options.requireRole && session) {
      if (!found.entry.options.requireRole.includes(session.role)) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient role', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
      }
    }

    // ── TOS gate (shared with api()) ────────────────────────────────────
    if (!found.entry.options.exemptFromTosGate) tosGate(req.nextUrl.pathname, session);

    const result = await found.entry.handler(req, session, { ...p, ...found.params }, { requestId, ipAddress: ip, userAgent: ua });
    if (result instanceof NextResponse) {
      result.headers.set('x-request-id', requestId);
      return result;
    }
    return NextResponse.json(result ?? { data: null }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    const res = NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
    return res;
  }
}

export const GET = handle('GET');
export const POST = handle('POST');
export const PUT = handle('PUT');
export const PATCH = handle('PATCH');
export const DELETE = handle('DELETE');
