import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';
import { clientIp } from '../ip';

const RULES: { pattern: RegExp; limit: number; windowSec: number; keyFn: (c: any) => Promise<string> | string }[] = [

  { pattern: /\/auth\/token$/, limit: 10, windowSec: 60, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/register$/, limit: 5, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },

  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: c => bodyPhone(c) },

  { pattern: /\/auth\/password\/reset$/, limit: 3, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/auth\/password\/reset\/confirm$/, limit: 5, windowSec: 600, keyFn: c => bodyPhone(c) },

  { pattern: /\/corporate\/onboard$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },

  { pattern: /\/corporate\/signup$/, limit: 3, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /^\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
  { pattern: /\/refunds$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },

  { pattern: /\/account\/export$/, limit: 3, windowSec: 600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
];
const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

async function bodyPhone(c: any): Promise<string> {
  try {

    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > 100_000) return 'phone:unknown';
    const body = await c.req.raw.clone().json();
    return `phone:${body?.phone ?? 'unknown'}`;
  } catch {
    return 'phone:unknown';
  }
}

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  const matchingRules = RULES.filter(r => r.pattern.test(path));
  const session = c.get('session');

  let maxRetryAfter = 0;
  for (const rule of matchingRules) {
    const key = `rl:${path}:${rule.pattern.source}:${await rule.keyFn(c)}`;
    const count = await redis.incr(key).catch(() => 1);
    if (count === 1) {

      await redis.expire(key, rule.windowSec).catch(() => {});
    }
    if (count > rule.limit) {
      const ttl = await redis.ttl(key).catch(() => rule.windowSec);
      if (ttl > maxRetryAfter) maxRetryAfter = ttl;
    }
  }
  if (maxRetryAfter > 0) {
    c.header('Retry-After', String(maxRetryAfter));
    throw new RateLimitError(maxRetryAfter);
  }

  if (matchingRules.length === 0) {
    const { limit, windowSec, keyFn } = session
      ? { ...DEFAULT_AUTHED, keyFn: (_c: any) => `user:${session.userId}` }
      : { ...DEFAULT_ANON, keyFn: (c: any) => `ip:${clientIp(c)}` };
    const key = `rl:${path}:${await keyFn(c)}`;
    const count = await redis.incr(key).catch(() => 1);
    if (count === 1) await redis.expire(key, windowSec).catch(() => {});
    const ttl = await redis.ttl(key).catch(() => windowSec);
    c.header('X-RateLimit-Reset', String(ttl));
    if (count > limit) {
      c.header('Retry-After', String(ttl));
      throw new RateLimitError(ttl);
    }
  }
  await next();
};
