import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';
import type { Variables } from '../context';

type Env = { Variables: Variables };

// keyFn is async: the OTP rules need to read `phone` out of the (cloned) request body, and
// this middleware now runs after authMiddleware so session-based rules can also key off it.
const RULES: { pattern: RegExp; limit: number; windowSec: number; keyFn: (c: import('hono').Context<Env>) => Promise<string> | string }[] = [
  // NOTE: the actual login route is POST /api/v1/auth/token (see identity/routes.ts), not
  // /auth/login — matching the wrong path silently left login on the much looser default
  // anonymous limit, which is far too permissive for a password endpoint.
  { pattern: /\/auth\/token$/, limit: 10, windowSec: 60, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/register$/, limit: 5, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/corporate\/onboard$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /^\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
  { pattern: /\/refunds$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId}` },
];
const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

function clientIp(c: import('hono').Context<Env>) { return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'; }

/** Reads `phone` from the JSON body without consuming the stream the route handler still needs. */
async function bodyPhone(c: import('hono').Context<Env>): Promise<string> {
  try {
    const body = await c.req.raw.clone().json();
    return `phone:${body?.phone ?? 'unknown'}`;
  } catch {
    return 'phone:unknown';
  }
}

export const rateLimitMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const path = c.req.path;
  const rule = RULES.find(r => r.pattern.test(path));
  const session = c.get('session');
  const { limit, windowSec, keyFn } = rule ?? (session ? { ...DEFAULT_AUTHED, keyFn: (c: import('hono').Context<Env>) => `user:${session.userId}` } : { ...DEFAULT_ANON, keyFn: (c: import('hono').Context<Env>) => `ip:${clientIp(c)}` });

  const key = `rl:${path}:${await keyFn(c)}`;
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
