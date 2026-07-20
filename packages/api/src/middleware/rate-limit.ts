import type { MiddlewareHandler } from 'hono';
import { RateLimitError } from '@addis/shared';
import { redis } from '../../infra/redis';
import { clientIp } from '../ip';

// keyFn is async: the OTP rules need to read `phone` out of the (cloned) request body, and
// this middleware now runs after authMiddleware so session-based rules can also key off it.
const RULES: { pattern: RegExp; limit: number; windowSec: number; keyFn: (c: any) => Promise<string> | string }[] = [
  // NOTE: the actual login route is POST /api/v1/auth/token (see identity/routes.ts), not
  // /auth/login — matching the wrong path silently left login on the much looser default
  // anonymous limit, which is far too permissive for a password endpoint.
  // Per-account lockout is enforced in identityService.login; this per-IP rule is
  // the second layer of defense against credential stuffing.
  { pattern: /\/auth\/token$/, limit: 10, windowSec: 60, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/register$/, limit: 5, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  // OTP send: per-IP AND per-phone. The previous per-phone-only rule allowed
  // an attacker rotating phone numbers to send unlimited OTPs (SMS-pumping /
  // toll-fraud). Now an attacker is capped at 3 sends / 10 min per IP
  // regardless of how many phones they target.
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: c => bodyPhone(c) },
  // Password reset endpoints had no rule at all — fell through to
  // DEFAULT_ANON (60/min per spoofable IP), enabling unlimited OTP
  // brute-force against /password/reset/confirm.
  { pattern: /\/auth\/password\/reset$/, limit: 3, windowSec: 600, keyFn: c => bodyPhone(c) },
  { pattern: /\/auth\/password\/reset\/confirm$/, limit: 5, windowSec: 600, keyFn: c => bodyPhone(c) },
  // Authenticated mutations — these key off session.userId, which is always
  // present (requireAuth runs before rate-limit on these routes via the
  // route-level middleware order).
  { pattern: /\/corporate\/onboard$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
  // H39 fix: Corporate self-signup (POST /corporate/signup) creates a
  // corporate_admin user + a corporate row. The previous implementation had
  // no rule for this path — it fell through to DEFAULT_ANON (60/min per IP),
  // which (combined with XFF spoofing) enabled unlimited corporate account
  // creation. Now capped at 3/hour per IP — enough for legitimate self-signup
  // but blocks spam/enumeration.
  { pattern: /\/corporate\/signup$/, limit: 3, windowSec: 3600, keyFn: c => `ip:${clientIp(c)}` },
  { pattern: /^\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
  { pattern: /\/refunds$/, limit: 5, windowSec: 3600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
  // Account export is expensive (8 DB queries + ZIP streaming). Cap tightly.
  { pattern: /\/account\/export$/, limit: 3, windowSec: 600, keyFn: c => `user:${c.get('session')?.userId ?? 'anon'}` },
];
const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

/**
 * Reads `phone` from the JSON body without consuming the stream the route handler still needs.
 * `clientIp` is imported from `../../src/ip` (FIX API-015: shared helper so
 * route handlers and rate-limit agree on which XFF entry to trust).
 */
async function bodyPhone(c: any): Promise<string> {
  try {
    // Cap body size we'll parse — a 10MB body shouldn't trigger a JSON parse
    // just to extract the phone field.
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
  // All matching rules apply (a request can match both per-IP and per-phone
  // rules for the same endpoint). The most restrictive wins.
  const matchingRules = RULES.filter(r => r.pattern.test(path));
  const session = c.get('session');

  // Evaluate all matching rules. If any rule trips, throw 429 with the
  // longest remaining window. The previous code only applied the FIRST
  // matching rule — so a /auth/otp/send request was either per-IP OR
  // per-phone, never both.
  let maxRetryAfter = 0;
  for (const rule of matchingRules) {
    const key = `rl:${path}:${rule.pattern.source}:${await rule.keyFn(c)}`;
    const count = await redis.incr(key).catch(() => 1);
    if (count === 1) {
      // Set TTL only on first increment. INCR-then-EXPIRE race: if the
      // process crashes between them, the key has no TTL and persists
      // forever, permanently blocking that bucket. Best-effort — Redis
      // doesn't support atomic INCR+EXPIRE in a single command without
      // Lua. The window of vulnerability is microseconds.
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

  // Apply the default rule if no specific rule matched.
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
