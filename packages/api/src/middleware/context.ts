import type { MiddlewareHandler } from 'hono';
import { childLogger } from '../../infra/logger';

export const requestContext: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  const start = Date.now();
  c.set('requestId', requestId);
  c.set('logger', childLogger(requestId, { route: c.req.path, method: c.req.method }));
  c.header('X-Request-Id', requestId);
  await next();
  c.get('logger').info({ statusCode: c.res.status, durationMs: Date.now() - start }, 'request completed');
};
