import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';

const RULES: { pattern: RegExp; limit: number; windowSec: number; keyFn: (c: any) => string }[] = [
  { pattern: /\/auth\/login$/, limit: 10, windowSec: 60, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/register$/, limit: 5, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => `phone:${bodyPhone(c)}` },
  { pattern: /\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: c => `phone:${bodyPhone(c)}` },
  { pattern: /\/corporate\/onboard$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /^\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /\/refunds$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
];
const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

function clientIp(c: any) { return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'; }
function bodyPhone(c: any) { return c.get('__parsedBodyPhone') ?? 'unknown'; }

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  const rule = RULES.find(r => r.pattern.test(path));
  const session = c.get('session');
  const { limit, windowSec, keyFn } = rule ?? (session ? { ...DEFAULT_AUTHED, keyFn: (c: any) => `user:${session.userId}` } : { ...DEFAULT_ANON, keyFn: (c: any) => `ip:${clientIp(c)}` });

  const key = `rl:${path}:${keyFn(c)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  const ttl = await redis.ttl(key);
  c.header('X-RateLimit-Reset', String(ttl));
  if (count > limit) {
    c.header('Retry-After', String(ttl));
    throw new RateLimitError(ttl);
  }
  await next();
};
