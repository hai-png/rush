// All security invariants baked in from the start. No patches.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { verifySession } from '@/lib/auth';
import { AppError, UnauthorizedError, ForbiddenError, RateLimitError, ConflictError, toErrorEnvelope } from '@/lib/errors';
import { CURRENT_TOS_VERSION } from '@/lib/env';
import { ensureSchedulerStarted } from '@/lib/scheduler';
import { logger } from '@/lib/logger';

export const SESSION_COOKIE = 'addis-session';
const CSRF_COOKIE = 'addis-csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type Session = Awaited<ReturnType<typeof verifySession>>;

export type ApiContext = {
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  session: Session | null;
};

export type ApiOptions = {
  requireAuth?: boolean;
  requireRole?: Array<'rider' | 'contractor' | 'corporate_admin' | 'platform_admin'>;
  exemptFromTosGate?: boolean;
  // Idempotency is auto-applied to POST with an Idempotency-Key header.
};

export function clientIp(req: NextRequest): string | undefined {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.headers.get('x-real-ip') ?? undefined;
}

type RateBucket = { count: number; expiresAt: number };
const rateBuckets = new Map<string, RateBucket>();

type RateRule = {
  pattern: RegExp;
  limit: number;
  windowSec: number;
  // returns the bucket key suffix; if it returns null, the rule is skipped
  keyFn: (ctx: { session: Session | null; body: any; ip: string | undefined }) => string | null;
};

const RATE_RULES: RateRule[] = [
  { pattern: /\/api\/v1\/auth\/token$/, limit: 100, windowSec: 60, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  // P1-8 / SEC-010: tightened from 10/min to 5/min per phone. A 6-digit TOTP
  // has 10^6 possibilities; at 5 attempts/min across rotating 30s windows,
  // a sustained brute-force takes ~140 days for a 50% success chance.
  { pattern: /\/api\/v1\/auth\/token$/, limit: 5, windowSec: 60, keyFn: ({ body }) => body?.phone ? `phone:${body.phone}` : null },
  { pattern: /\/api\/v1\/auth\/register$/, limit: 50, windowSec: 3600, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  { pattern: /\/api\/v1\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: ({ ip }) => ip ? `ip:${ip}` : null },
  { pattern: /\/api\/v1\/auth\/otp\/send$/, limit: 3, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/otp\/verify$/, limit: 10, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/password\/reset$/, limit: 3, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/auth\/password\/reset\/confirm$/, limit: 5, windowSec: 600, keyFn: ({ body }) => `phone:${body?.phone ?? 'unknown'}` },
  { pattern: /\/api\/v1\/subscriptions$/, limit: 10, windowSec: 3600, keyFn: ({ session }) => session ? `user:${session.id}` : null },
];

const DEFAULT_AUTHED = { limit: 100, windowSec: 60 };
const DEFAULT_ANON = { limit: 60, windowSec: 60 };

export type RateLimitInfo = { limit: number; remaining: number; resetAt: number };

export function rateLimitCheck(
  path: string,
  method: string,
  ctx: { session: Session | null; body: any; ip: string | undefined },
): RateLimitInfo | null {
  const matchingRules = RATE_RULES.filter(r => r.pattern.test(path));
  let maxRetry = 0;
  let info: RateLimitInfo | null = null;

  for (const rule of matchingRules) {
    const keySuffix = rule.keyFn(ctx);
    if (!keySuffix) continue;
    if (keySuffix.startsWith('ip:undefined')) {
      // Don't bucket on unknown IP — would let one attacker DoS all anon users.
      throw new RateLimitError(60);
    }
    const key = `rl:${path}:${rule.pattern.source}:${keySuffix}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.expiresAt < now) {
      rateBuckets.set(key, { count: 1, expiresAt: now + rule.windowSec * 1000 });
      info = { limit: rule.limit, remaining: rule.limit - 1, resetAt: Math.ceil((now + rule.windowSec * 1000) / 1000) };
    } else {
      bucket.count++;
      const remaining = Math.max(0, rule.limit - bucket.count);
      info = { limit: rule.limit, remaining, resetAt: Math.ceil(bucket.expiresAt / 1000) };
      if (bucket.count > rule.limit) {
        const ttl = Math.ceil((bucket.expiresAt - now) / 1000);
        if (ttl > maxRetry) maxRetry = ttl;
      }
    }
  }
  if (maxRetry > 0) throw new RateLimitError(maxRetry);

  if (matchingRules.length === 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    const { limit, windowSec } = ctx.session ? DEFAULT_AUTHED : DEFAULT_ANON;
    const keySuffix = ctx.session ? `user:${ctx.session.id}` : (ctx.ip ? `ip:${ctx.ip}` : null);
    if (!keySuffix) return info;
    if (keySuffix.startsWith('ip:undefined')) throw new RateLimitError(60);
    const key = `rl:${path}:${keySuffix}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.expiresAt < now) {
      rateBuckets.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
      info = { limit, remaining: limit - 1, resetAt: Math.ceil((now + windowSec * 1000) / 1000) };
    } else {
      bucket.count++;
      const remaining = Math.max(0, limit - bucket.count);
      info = { limit, remaining, resetAt: Math.ceil(bucket.expiresAt / 1000) };
      if (bucket.count > limit) {
        throw new RateLimitError(Math.ceil((bucket.expiresAt - now) / 1000));
      }
    }
  }
  return info;
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

  // Only skip CSRF when the request uses bearer auth AND no session cookie.
  // If both are present, the request is browser-like and CSRF must be enforced.
  if (!sessionToken && bearer) return;
  // If neither credential is present, the request is anonymous — CSRF doesn't apply.
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
    // Collision — fetch existing.
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
    // Non-2xx: allow retry by deleting.
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
    // Start the background scheduler on first API request (no-op if already started).
    ensureSchedulerStarted();
    const ip = clientIp(req);
    const ua = req.headers.get('user-agent') ?? undefined;

    // P1-53 / OPS-017: structured request logging with requestId correlation.
    // The child logger is available to handlers via ctx, but we also log a
    // completion line at the end of every request for access-log analysis.
    const requestLogger = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname, ip, userId: undefined as string | undefined });

    // Ensure CSRF cookie exists for safe methods.
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
      // ── Auth ────────────────────────────────────────────────────────────
      let session: Session | null = null;
      const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      // Read the session cookie from the request's Cookie header directly —
      const cookieHeader = req.headers.get('cookie') ?? '';
      let cookieToken: string | undefined;
      for (const part of cookieHeader.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === SESSION_COOKIE) { cookieToken = v.join('='); break; }
      }
      const token = bearer ?? cookieToken;
      if (token) {
        // Failed credential verification MUST propagate as 401 — never silently
        session = await verifySession(token);
      }
      // Update the requestLogger with the resolved userId for completion logging.
      if (session) (requestLogger as any).bindings.userId = session.id;

      // ── CSRF ────────────────────────────────────────────────────────────
      await csrfCheck(req);

      let body: any = undefined;
      let bodyText = '';
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // P2-64 / API-053: enforce a max body size to prevent memory-exhaustion
        // DoS (a 1GB JSON body would be buffered entirely in memory).
        // 1MB is generous for all current endpoints (file uploads bypass this
        // via the raw handler path). Override via MAX_BODY_BYTES env var.
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
          try { body = JSON.parse(bodyText); } catch { /* leave body undefined */ }
        }
      }

      const rateInfo = rateLimitCheck(req.nextUrl.pathname, req.method, { session, body, ip });

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
      // Extract query params from the URL search string so handlers can
      // read ?corporateId= etc. without needing a separate req object.
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

      if (idem.scopedKey) {
        await persistIdempotency(idem.scopedKey, status, data === undefined ? null : { data });
      }

      const res = NextResponse.json(data === undefined ? null : { data }, { status });
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, String(v));
      }
      res.headers.set('x-request-id', requestId);
      // P2-52 / API-032: X-RateLimit-* headers so clients can proactively back off.
      if (rateInfo) {
        res.headers.set('X-RateLimit-Limit', String(rateInfo.limit));
        res.headers.set('X-RateLimit-Remaining', String(rateInfo.remaining));
        res.headers.set('X-RateLimit-Reset', String(rateInfo.resetAt));
      }
      // P1-53 / OPS-017: request completion log.
      const durationMs = Date.now() - requestStart;
      if (durationMs > 1000) {
        requestLogger.warn({ status, durationMs }, '[api] slow request');
      } else {
        requestLogger.info({ status, durationMs }, '[api] request completed');
      }
      return res;
    } catch (err) {
      const { status, body } = toErrorEnvelope(err, requestId);
      // If we reserved an idempotency-record lock and the handler threw,
      // release it so the client can retry with the same key. ConflictError
      // (409) is the exception — it's already a "retry" signal so we keep
      // the row for the existing conflict to surface.
      if (idem?.scopedKey && !(err instanceof ConflictError)) {
        await db.idempotencyRecord.delete({ where: { key: idem.scopedKey } }).catch(() => {});
      }
      const res = NextResponse.json(body, { status });
      res.headers.set('x-request-id', requestId);
      if (err instanceof RateLimitError) {
        res.headers.set('retry-after', String(err.retryAfterSec));
      }
      // P1-53: error completion log (5xx at error, 4xx at info).
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
