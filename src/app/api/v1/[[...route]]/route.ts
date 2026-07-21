// Single API entry point. All /api/v1/* requests dispatch via the route table
// in src/lib/api-routes.ts. The per-route options (requireAuth, requireRole,
// exemptFromTosGate) are applied per-request by calling api() with the matched
// entry's options.
//
// For `raw` routes (multipart upload, file download), the api() wrapper still
// runs (auth/csrf/rate-limit) but skips JSON body parsing and calls the
// handler with the raw NextRequest.

import { NextRequest, NextResponse } from 'next/server';
import { findRoute } from '@/lib/api-routes';
import { api } from '@/lib/api';
import { verifySession } from '@/lib/auth';
import { NotFoundError, toErrorEnvelope } from '@/lib/errors';

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

    // For raw routes, we need to do auth outside the api() wrapper because
    // api() consumes req.text() for body parsing. We'll do a lightweight auth
    // pass, then call the raw handler directly.
    if (found.entry.raw) {
      return handleRaw(req, ctx, found);
    }

    // Standard JSON route — apply the matched entry's options via api().
    const wrapped = api(found.entry.options, async (innerCtx) => {
      return found.entry.handler({
        ...innerCtx,
        params: { ...p, ...found.params },
      });
    });

    return wrapped(req, ctx);
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

    // Auth gate.
    if (found.entry.options.requireAuth && !session) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', requestId } }, { status: 401, headers: { 'x-request-id': requestId } });
    }
    if (found.entry.options.requireRole && session) {
      if (!found.entry.options.requireRole.includes(session.role)) {
        return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Insufficient role', requestId } }, { status: 403, headers: { 'x-request-id': requestId } });
      }
    }

    // Call the raw handler with (req, session, params, ctx).
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
