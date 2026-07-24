import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { verifyAccessToken, verifySession } from '@/lib/auth';
import { AppError, UnauthorizedError, ForbiddenError, RateLimitError, ConflictError, toErrorEnvelope } from '@/lib/errors';
import { CURRENT_TOS_VERSION } from '@/lib/env';
import { ensureSchedulerStarted } from '@/lib/scheduler';
import { logger } from '@/lib/logger';
import { recordRequest } from '@/lib/api-metrics';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-addis-session' : 'addis-session';
const CSRF_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-addis-csrf' : 'addis-csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type Session = Awaited<ReturnType<typeof verifySession>>;

export type ApiContext = {
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  session: Session | null;
};

// Phase 3 fix: typed ApiHandler so handler bodies get compile-time type
export type ApiHandler<I = unknown> = {
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  session: Session;
  body: I;
  params: Record<string, string>;
  query: Record<string, string>;
};

export type ApiOptions = {
  requireAuth?: boolean;
  requireRole?: Array<'rider' | 'contractor' | 'corporate_admin' | 'platform_admin'>;
  exemptFromTosGate?: boolean;
  deprecated?: {
    sunset?: Date;   // when the route will stop responding
    link?: string;   // docs URL for the migration path
  };
};

function parseTrustedProxies(): Set<string> {
  const raw = process.env.TRUSTED_PROXIES || '';
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

export function clientIp(req: NextRequest): string | undefined {
  const xff = req.headers.get('x-forwarded-for');
  const trusted = parseTrustedProxies();
  if (xff && trusted.size > 0) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!trusted.has(parts[i]!)) return parts[i];
    }
    if (parts.length > 0) return parts[0];
  }
  return req.headers.get('x-real-ip') ?? undefined;
}

type RateBucket = { count: number; expiresAt: number };
const rateBuckets = new Map<string, RateBucket>();

type RateRule = {
  pattern: RegExp;
  limit: number;
  windowSec: number;
  keyFn: (ctx: { session: Session | null; body: any; ip: string | undefined }) => string | null;
};

const RATE_RULES: RateRule[] = [
  { pattern: /\/api\/v1\/auth\/token$/, limit: 100, windowSec: 60, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  { pattern: /\/api\/v1\/auth\/token$/, limit: 5, windowSec: 60, keyFn: ({ body }) => body?.phone ? `phone:${body.phone}` : null },
  { pattern: /\/api\/v1\/auth\/register$/, limit: 50, windowSec: 3600, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  { pattern: /\/api\/v1\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  { pattern: /\/api\/v1\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/password\/reset$/, limit: 3, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/password\/reset\/confirm$/, limit: 5, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: ({ session }) => session ? `user:${session.id}` : null },
  { pattern: /\/api\/v1\/corporate\/invites$/, limit: 50, windowSec: 3600, keyFn: ({ session }) => session ? `user:${session.id}` : null },
  { pattern: /\/api\/v1\/webhooks\//, limit: 600, windowSec: 60, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
];

const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };
// H-17 fix: default GET rate limits (higher than state-changing).
const DEFAULT_AUTHED_GET = { limit: 300, windowSec: 60 };
const DEFAULT_ANON_GET = { limit: 120, windowSec: 60 };

export type RateLimitInfo = { limit: number; remaining: number; resetAt: number };

// H-16 fix: normalize the path for rate-limit bucketing so parameterized routes
function normalizePathForRateLimit(path: string): string {
  return path.replace(/\/[a-zA-Z0-9]{20,}/g, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');
}

export async function rateLimitCheck(
  path: string,
  method: string,
  ctx: { session: Session | null; body: any; ip: string | undefined },
): Promise<RateLimitInfo | null> {
  if (process.env.RATE_LIMIT_DISABLED === '1') return null;

  const matchingRules = RATE_RULES.filter(r => r.pattern.test(path));
  let maxRetry = 0;
  let info: RateLimitInfo | null = null;

  for (const rule of matchingRules) {
    const keySuffix = rule.keyFn(ctx);
    if (!keySuffix) continue;
    if (keySuffix.startsWith('ip:undefined')) {
      throw new RateLimitError(60);
    }
    const normPath = normalizePathForRateLimit(path);
    const key = `rl:${normPath}:${rule.pattern.source}:${keySuffix}`;
    const now = Date.now();
    // H-22 fix: try Redis-backed rate limit when available (distributed).
    info = await rateLimitBucket(key, rule.limit, rule.windowSec, now);
    if (info && info.remaining < 0) {
      const ttl = info.resetAt - Math.ceil(now / 1000);
      if (ttl > maxRetry) maxRetry = ttl;
    }
  }
  if (maxRetry > 0) throw new RateLimitError(maxRetry);

  if (matchingRules.length === 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    const { limit, windowSec } = ctx.session ? DEFAULT_AUTHED : DEFAULT_ANON;
    const keySuffix = ctx.session ? `user:${ctx.session.id}` : (ctx.ip ? `ip:${ctx.ip}` : null);
    // H-22 fix: fail CLOSED when IP is undefined on unauthenticated state-changing
    // requests. Previously this returned info (fail-open), allowing unbounded
    // requests when no proxy header was present. The intent was fail-closed.
    if (!keySuffix) {
      throw new RateLimitError(60);
    }
    if (keySuffix.startsWith('ip:undefined')) throw new RateLimitError(60);
    const normPath = normalizePathForRateLimit(path);
    const key = `rl:${normPath}:${keySuffix}`;
    const now = Date.now();
    info = await rateLimitBucket(key, limit, windowSec, now);
    if (info && info.remaining < 0) {
      throw new RateLimitError(info.resetAt - Math.ceil(now / 1000));
    }
  }
  return info;
}

async function rateLimitBucket(
  key: string,
  limit: number,
  windowSec: number,
  now: number,
): Promise<RateLimitInfo | null> {
  const { redisRateLimit } = await import('@/lib/redis');
  const redisResult = await redisRateLimit(key, limit, windowSec);
  if (redisResult) {
    const resetAt = redisResult.allowed
      ? Math.ceil((now + windowSec * 1000) / 1000)
      : Math.ceil((now + redisResult.retryAfter * 1000) / 1000);
    return {
      limit,
      remaining: redisResult.allowed ? Math.max(0, limit - redisResult.count) : -1,
      resetAt,
    };
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.expiresAt < now) {
    rateBuckets.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return { limit, remaining: limit - 1, resetAt: Math.ceil((now + windowSec * 1000) / 1000) };
  }
  bucket.count++;
  const remaining = Math.max(0, limit - bucket.count);
  return { limit, remaining, resetAt: Math.ceil(bucket.expiresAt / 1000) };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (v.expiresAt < now) rateBuckets.delete(k);
  }
}, 5 * 60_000).unref?.();

export function readCookie(req: NextRequest, name: string): string | undefined {
  const cookieHeader = req.headers.get('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export const CSRF_EXEMPT = [
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/cron\//,
];

export async function csrfCheck(req: NextRequest): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  if (CSRF_EXEMPT.some(re => re.test(req.nextUrl.pathname))) return;

  const sessionToken = readCookie(req, SESSION_COOKIE);
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!sessionToken && bearer) return;
  if (!sessionToken && !bearer) return;

  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    throw new ForbiddenError('CSRF token missing');
  }
  const a = createHash('sha256').update(cookieToken).digest();
  const b = createHash('sha256').update(headerToken).digest();
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenError('CSRF token mismatch');
  }
}

const TOS_EXEMPT = [
  /^\/api\/v1\/tos/,
  /^\/api\/v1\/auth\/(login|token|logout|refresh|password|2fa|sessions|me|otp|phone|register)/,
  /^\/api\/v1\/account\/delete/,
  /^\/api\/v1\/health/,
  /^\/api\/v1\/webhooks/,
  /^\/api\/v1\/cron/,
];

export function tosGate(path: string, session: Session | null): void {
  if (!session) return;
  if (TOS_EXEMPT.some(re => re.test(path))) return;
  if (session.tosVersion !== CURRENT_TOS_VERSION) {
    throw new ConflictError('TOS_UPDATE_REQUIRED', 'Please accept the updated Terms of Service');
  }
}

const IDEMPOTENCY_EXEMPT = [
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/cron\//,
];

async function idempotencyCheck(req: NextRequest, ctx: ApiContext, bodyText: string): Promise<{ replay?: any; scopedKey?: string; bodyHash?: string }> {
  if (req.method !== 'POST') return {};
  if (IDEMPOTENCY_EXEMPT.some(re => re.test(req.nextUrl.pathname))) return {};
  const key = req.headers.get('idempotency-key');
  if (!key) return {};
  if (key.length > 256) throw new Error('Idempotency-Key too long (max 256 chars)');

  if (!ctx.session) return {};

  const scopedKey = `${ctx.session.id}:${key}`;
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  try {
    await db.idempotencyRecord.create({
      data: {
        key: scopedKey,
        userId: ctx.session.id,
        method: req.method,
        path: req.nextUrl.pathname,
        requestBodyHash: bodyHash,
        responseStatus: 0,
        responseBody: '{}',
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    return { scopedKey, bodyHash };
  } catch {
    const existing = await db.idempotencyRecord.findUnique({ where: { key: scopedKey } });
    if (!existing) throw new ConflictError('Idempotency conflict; retry');
    if (existing.requestBodyHash !== bodyHash) {
      throw new ConflictError('Idempotency-Key reused with a different request body');
    }
    if (existing.responseStatus === 0) {
      throw new ConflictError('A request with this Idempotency-Key is still being processed; retry shortly');
    }
    if (existing.responseStatus >= 200 && existing.responseStatus < 300) {
      return { replay: JSON.parse(existing.responseBody), scopedKey };
    }
    await db.idempotencyRecord.delete({ where: { key: scopedKey } });
    throw new ConflictError('Previous request with this Idempotency-Key failed; retry now');
  }
}

async function persistIdempotency(scopedKey: string, status: number, body: unknown): Promise<void> {
  if (status >= 200 && status < 300 || status === 409) {
    await db.idempotencyRecord.update({
      where: { key: scopedKey },
      data: { responseStatus: status, responseBody: JSON.stringify(body) },
    });
  } else {
    await db.idempotencyRecord.delete({ where: { key: scopedKey } }).catch(() => {});
  }
}

type HandlerResult = { status?: number; data?: unknown; headers?: Record<string, string> } | unknown;
type Handler = (ctx: ApiContext & { body?: any; params: Record<string, string>; query: Record<string, string> }) => Promise<HandlerResult> | HandlerResult;

export function api(options: ApiOptions, handler: Handler) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    const requestId = crypto.randomUUID();
    const requestStart = Date.now();
    ensureSchedulerStarted();
    const ip = clientIp(req);
    const ua = req.headers.get('user-agent') ?? undefined;

    const requestLogger = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname, ip, userId: undefined as string | undefined });

    if (SAFE_METHODS.has(req.method)) {
      const c = await cookies();
      if (!c.get(CSRF_COOKIE)) {
        c.set(CSRF_COOKIE, randomBytes(32).toString('hex'), {
          path: '/', httpOnly: false, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 86400,
        });
      }
    }

    let idem: { replay?: any; scopedKey?: string; bodyHash?: string } | undefined;
    try {
      let session: Session | null = null;
      const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      const cookieHeader = req.headers.get('cookie') ?? '';
      let cookieToken: string | undefined;
      for (const part of cookieHeader.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === SESSION_COOKIE) { cookieToken = v.join('='); break; }
      }
      const token = bearer ?? cookieToken;
      if (token) {
        if (bearer) {
          try {
            session = await verifyAccessToken(token);
          } catch { }
        }
        if (!session) {
          try {
            session = await verifySession(token);
          } catch { }
        }
      }
      if (session) (requestLogger as any).bindings.userId = session.id;

      await csrfCheck(req);

      let body: any = undefined;
      let bodyText = '';
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
        const maxBodyBytes = parseInt(process.env.MAX_BODY_BYTES ?? '1048576', 10); // 1MB default
        if (contentLength > maxBodyBytes) {
          const res = NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: `Body exceeds ${maxBodyBytes} bytes`, requestId } }, { status: 413 });
          res.headers.set('x-request-id', requestId);
          return res;
        }
        bodyText = await req.text();
        if (bodyText.length > maxBodyBytes) {
          const res = NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: `Body exceeds ${maxBodyBytes} bytes`, requestId } }, { status: 413 });
          res.headers.set('x-request-id', requestId);
          return res;
        }
        if (bodyText && bodyText.length > 0) {
          try { body = JSON.parse(bodyText); } catch {  }
        }
      }

      const rateInfo = await rateLimitCheck(req.nextUrl.pathname, req.method, { session, body, ip });

      if (options.requireAuth && !session) throw new UnauthorizedError();
      if (options.requireRole && session) {
        if (!options.requireRole.includes(session.role as any)) {
          throw new ForbiddenError('Insufficient role');
        }
      }

      if (!options.exemptFromTosGate) tosGate(req.nextUrl.pathname, session);

      idem = await idempotencyCheck(req, { requestId, ipAddress: ip, userAgent: ua, session } as ApiContext, bodyText);
      if (idem.replay !== undefined) {
        return NextResponse.json(idem.replay);
      }

      const params = await ctx.params;
      const query: Record<string, string> = {};
      req.nextUrl.searchParams.forEach((value, key) => { query[key] = value; });
      const result = await handler({ requestId, ipAddress: ip, userAgent: ua, session, body, params, query });

      if (result instanceof NextResponse) {
        if (idem.scopedKey) {
          await persistIdempotency(idem.scopedKey, result.status, await result.json().catch(() => null));
        }
        result.headers.set('x-request-id', requestId);
        return result;
      }

      const status = (result && typeof result === 'object' && 'status' in result) ? (result as any).status ?? 200 : 200;
      const data = (result && typeof result === 'object' && 'data' in result) ? (result as any).data : result;
      const headers = (result && typeof result === 'object' && 'headers' in result) ? (result as any).headers : undefined;
      const pagination = (result && typeof result === 'object' && 'pagination' in result) ? (result as any).pagination : undefined;

      if (idem.scopedKey) {
        await persistIdempotency(idem.scopedKey, status, data === undefined ? null : { data, ...(pagination ? { pagination } : {}) });
      }

      const responseBody = data === undefined ? null : (pagination ? { data, pagination } : { data });
      const res = NextResponse.json(responseBody, { status });
    try { recordRequest(req.method, status); } catch {  }
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, String(v));
      }
      // #10: deprecation headers (RFC 8594 Sunset + RFC 9745 Deprecation).
      if (options.deprecated) {
        res.headers.set('Deprecation', 'true');
        if (options.deprecated.sunset) {
          res.headers.set('Sunset', options.deprecated.sunset.toUTCString());
        }
        if (options.deprecated.link) {
          res.headers.set('Link', `<${options.deprecated.link}>; rel="deprecation"`);
        }
      }
      res.headers.set('x-request-id', requestId);
      if (rateInfo) {
        res.headers.set('X-RateLimit-Limit', String(rateInfo.limit));
        res.headers.set('X-RateLimit-Remaining', String(rateInfo.remaining));
        res.headers.set('X-RateLimit-Reset', String(rateInfo.resetAt));
      }
      const durationMs = Date.now() - requestStart;
      if (durationMs > 1000) {
        requestLogger.warn({ status, durationMs }, '[api] slow request');
      } else {
        requestLogger.info({ status, durationMs }, '[api] request completed');
      }
      return res;
    } catch (err) {
      logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err, requestId }, '[api] unhandled error');
      const { status, body } = toErrorEnvelope(err, requestId);
      if (idem?.scopedKey && !(err instanceof ConflictError)) {
        await db.idempotencyRecord.delete({ where: { key: idem.scopedKey } }).catch(() => {});
      }
      const res = NextResponse.json(body, { status });
      res.headers.set('x-request-id', requestId);
      if (err instanceof RateLimitError) {
        res.headers.set('retry-after', String(err.retryAfterSec));
      }
      const durationMs = Date.now() - requestStart;
      if (status >= 500) {
        requestLogger.error({ status, durationMs, err: (err as Error).message }, '[api] server error');
      } else {
        requestLogger.info({ status, durationMs }, '[api] client error');
      }
      return res;
    }
  };
}

export async function setSessionCookie(res: NextResponse, token: string): Promise<void> {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
}

export async function clearSessionCookie(res: NextResponse): Promise<void> {
  res.cookies.delete(SESSION_COOKIE);
}

