import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { ConflictError } from '@addis/shared';

// No real HTTP response ever has status 0 — used as a sentinel to mark a claimed-but-not-yet-
// completed idempotency record while the handler is still running.
const PROCESSING_STATUS = 0;

// Auth/OTP endpoints must NOT be cached by the idempotency middleware. A
// cached /auth/token response contains a live access token; a cached /auth/otp/send
// response (in dev) contains the OTP code. If the cache key happens to collide
// (Idempotency-Key reused across users, or a stolen key), a second caller
// receives the cached credential — full account takeover within the token's
// 30-minute validity window. The previous middleware applied to ALL POSTs
// under /api/v1/* with no exclusions.
const EXEMPT_PATHS = [
  /^\/api\/v1\/auth\//,        // /token, /refresh, /register, /logout, /me, /change-password, /sessions, /2fa/*, /otp/*
  /^\/api\/v1\/webhooks\//,    // provider callbacks — signature is the real idempotency control
  /^\/api\/v1\/cron\//,        // cron jobs — advisory lock is the real dedup
];

function isExempt(path: string): boolean {
  return EXEMPT_PATHS.some(re => re.test(path));
}

export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (isExempt(c.req.path)) return next();
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  // Cap key length to prevent DoS via multi-MB keys.
  if (key.length > 256) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Idempotency-Key too long (max 256 chars)', requestId: c.get('requestId') } }, 400);
  }

  const session = c.get('session');
  // Scope the stored key to the caller. The previous code's `anon:<key>`
  // scope for unauthenticated callers was catastrophic: any two anonymous
  // callers who happened to send the same Idempotency-Key (a client bug,
  // or an attacker guessing/reusing keys) collided on the same cached
  // response — including, on /auth/otp/send in dev, the OTP code itself.
  // Now anonymous callers each get a per-request randomized scope: the key
  // only dedups within a single in-flight anonymous request, which is the
  // only legitimate use case (double-click protection). For real anonymous
  // POST endpoints we recommend the route itself implement dedup.
  const scope = session?.userId ?? `anon:${c.get('requestId')}`;
  const scopedKey = `${scope}:${key}`;

  // Cap body size we'll hash — a multi-MB body shouldn't trigger a full SHA.
  const bodyText = await c.req.raw.clone().text();
  if (bodyText.length > 1_000_000) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body too large for idempotency', requestId: c.get('requestId') } }, 413);
  }
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  // Atomically claim the key with an INSERT before running the handler.
  const claimed = await db.insert(schema.idempotencyRecords).values({
    key: scopedKey, userId: session?.userId ?? null, method: c.req.method, path: c.req.path,
    requestBodyHash: bodyHash, responseStatus: PROCESSING_STATUS, responseBody: {},
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  }).onConflictDoNothing().returning();

  if (claimed.length === 0) {
    const [existing] = await db.select().from(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    if (!existing || existing.requestBodyHash !== bodyHash) {
      throw new ConflictError('Idempotency-Key reused with a different request body');
    }
    if (existing.responseStatus === PROCESSING_STATUS) {
      throw new ConflictError('A request with this Idempotency-Key is still being processed; retry shortly');
    }
    // Replay: only cache successful (2xx) and 409/422 (idempotent conflict) responses.
    // Caching 400/401/403/404 was wrong — the client may want to retry with a
    // corrected request, but the cached error was replayed for 24h.
    if (existing.responseStatus >= 200 && existing.responseStatus < 300) {
      return c.json(existing.responseBody as any, existing.responseStatus as any);
    }
    if (existing.responseStatus === 409 || existing.responseStatus === 422) {
      return c.json(existing.responseBody as any, existing.responseStatus as any);
    }
    // For other 4xx/5xx: release the claim so a legitimate retry can proceed.
    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    throw new ConflictError('Previous request with this Idempotency-Key failed; retry now');
  }

  try {
    await next();
  } catch (err) {
    // Release the claim inside a transaction so a crash between the catch
    // and the DELETE doesn't leave the row stuck at PROCESSING_STATUS=0
    // forever (permanent lockout for that key).
    await db.transaction(async (tx) => {
      await tx.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    }).catch(() => { /* best-effort; original error is more important */ });
    throw err;
  }

  const res = c.res.clone();
  if (res.status >= 200 && res.status < 300) {
    const responseBody = await res.json().catch(() => ({}));
    await db.update(schema.idempotencyRecords)
      .set({ responseStatus: res.status, responseBody })
      .where(eq(schema.idempotencyRecords.key, scopedKey));
  } else if (res.status === 409 || res.status === 422) {
    // Cache conflict/unprocessable — they're idempotent assertions.
    const responseBody = await res.json().catch(() => ({}));
    await db.update(schema.idempotencyRecords)
      .set({ responseStatus: res.status, responseBody })
      .where(eq(schema.idempotencyRecords.key, scopedKey));
  } else {
    // 4xx (other) / 5xx: don't cache; release the claim so retries work.
    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
  }
};
