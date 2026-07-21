// Single API entry point. All /api/v1/* requests dispatch via the route table
// in src/lib/api-routes.ts. The per-route options (requireAuth, requireRole,
// exemptFromTosGate) are applied per-request by calling api() with the matched
// entry's options.

import { NextRequest, NextResponse } from 'next/server';
import { findRoute } from '@/lib/api-routes';
import { api } from '@/lib/api';
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

    // Apply the matched entry's options by wrapping its handler in api().
    const wrapped = api(found.entry.options, async (innerCtx) => {
      return found.entry.handler({
        ...innerCtx,
        params: { ...p, ...found.params },
      });
    });

    return wrapped(req, ctx);
  };
}

export const GET = handle('GET');
export const POST = handle('POST');
export const PUT = handle('PUT');
export const PATCH = handle('PATCH');
export const DELETE = handle('DELETE');
