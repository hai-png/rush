import type { MiddlewareHandler } from 'hono';
import { CURRENT_TOS_VERSION } from '@addis/shared';

const EXEMPT = [
  /^\/api\/v1\/tos/,
  /^\/api\/v1\/auth\/(login|token|logout|refresh|password|2fa|sessions|me)/,
  /^\/api\/v1\/account\/delete/,
  /^\/api\/v1\/health/,
  /^\/api\/v1\/webhooks/,
  /^\/api\/v1\/cron/,
];

export const tosGateMiddleware: MiddlewareHandler = async (c, next) => {
  const session = c.get('session');
  if (session && !EXEMPT.some(re => re.test(c.req.path))) {
    if (session.tosVersion !== CURRENT_TOS_VERSION) {
      c.header('Location', '/tos/accept');
      return c.json({ error: { code: 'TOS_UPDATE_REQUIRED', message: 'Please accept the updated Terms of Service', requestId: c.get('requestId') } }, 409);
    }
  }
  return await next();
};
