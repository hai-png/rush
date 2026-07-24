
import { NextRequest, NextResponse } from 'next/server';
import { findRoute } from '@/lib/api-routes';
import { api, csrfCheck, rateLimitCheck, tosGate, readCookie, clientIp, SESSION_COOKIE } from '@/lib/api';
import { verifyAccessToken, verifySession } from '@/lib/auth';
import { NotFoundError, BadRequestError, toErrorEnvelope } from '@/lib/errors';
import { ensureSchedulerStarted } from '@/lib/scheduler';

type Ctx = { params: Promise<{ route?: string[] }> };

const MAX_PATH_PARAM_LENGTH = 200;
const PATH_PARAM_PATTERN = /^[a-zA-Z0-9_\-:.+=@%]+$/;
function validatePathParam(value: string, name: string): void {
  if (value.length > MAX_PATH_PARAM_LENGTH) {
    throw new BadRequestError(`Path parameter ${name} exceeds maximum length of ${MAX_PATH_PARAM_LENGTH}`);
  }
  if (!PATH_PARAM_PATTERN.test(value)) {
    throw new BadRequestError(`Path parameter ${name} contains invalid characters`);
  }
}

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

    const mergedParams = { ...p, ...found.params };
    for (const [key, val] of Object.entries(mergedParams)) {
      if (typeof val === 'string') validatePathParam(val, key);
    }

    const wrapped = api(found.entry.options, async (innerCtx) => {
      return found.entry.handler({
        ...innerCtx,
        params: mergedParams,
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
    let session: any = null;
    const cookieToken = readCookie(req, SESSION_COOKIE);
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const token = bearer ?? cookieToken;
    if (token) {
      if (bearer) {
        try { session = await verifyAccessToken(token); } catch { }
      }
      if (!session) {
        try { session = await verifySession(token); } catch (err) {
          const { status, body } = toErrorEnvelope(err, requestId);
          return NextResponse.json(body, { status, headers: { 'x-request-id': requestId } });
        }
      }
    }

    await csrfCheck(req);

    await rateLimitCheck(req.nextUrl.pathname, req.method, { session, body: null, ip });

    if (found.entry.options.requireAuth && !session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    if (found.entry.options.requireRole && session) {
      if (!found.entry.options.requireRole.includes(session.role)) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient role', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
      }
    }

    if (!found.entry.options.exemptFromTosGate) tosGate(req.nextUrl.pathname, session);

    const mergedParams = { ...p, ...found.params };
    for (const [key, val] of Object.entries(mergedParams)) {
      if (typeof val === 'string') validatePathParam(val, key);
    }

    const result = await found.entry.handler(req, session, mergedParams, { requestId, ipAddress: ip, userAgent: ua });
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
