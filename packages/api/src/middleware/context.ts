import type { MiddlewareHandler } from 'hono';
import { childLogger } from '../../infra/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requestContext: MiddlewareHandler = async (c, next) => {

  const clientRequestId = c.req.header('x-request-id');
  const requestId = clientRequestId && UUID_RE.test(clientRequestId) ? clientRequestId : crypto.randomUUID();
  const start = Date.now();
  c.set('requestId', requestId);
  c.set('logger', childLogger(requestId, { route: c.req.path, method: c.req.method }));
  c.header('X-Request-Id', requestId);
  await next();
  c.get('logger').info({ statusCode: c.res.status, durationMs: Date.now() - start }, 'request completed');
};
