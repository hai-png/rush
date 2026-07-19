import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { ConflictError } from '@addis/shared';
import type { Variables } from '../context';

type Env = { Variables: Variables };

// No real HTTP response ever has status 0 — used as a sentinel to mark a claimed-but-not-yet-
// completed idempotency record while the handler is still running.
const PROCESSING_STATUS = 0;

export const idempotencyMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  const session = c.get('session');
  // Scope the stored key to the caller. A bare client-supplied key is not safe to use as the
  // global lookup key: two different users who happen to send the same Idempotency-Key value
  // (client bug, or a malicious user guessing/reusing another user's key) would otherwise be
  // able to collide on — and potentially receive — each other's cached response.
  const scopedKey = `${session?.userId ?? 'anon'}:${key}`;

  const bodyText = await c.req.raw.clone().text();
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  // Atomically claim the key with an INSERT before running the handler. Checking "does a
  // record exist" and only inserting *after* the handler runs (the original approach) leaves
  // a window where two concurrent requests with the same key both see "no record yet" and
  // both execute the handler — defeating the entire point of idempotency for something like a
  // payment or subscription creation. Only one concurrent INSERT can win here.
  const claimed = await db.insert(schema.idempotencyRecords).values({
    key: scopedKey, userId: session?.userId ?? null, method: c.req.method, path: c.req.path,
    requestBodyHash: bodyHash, responseStatus: PROCESSING_STATUS, responseBody: {},
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  }).onConflictDoNothing().returning();

  if (claimed.length === 0) {
    // Someone else already claimed this key (in flight or completed).
    const [existing] = await db.select().from(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    if (!existing || existing.requestBodyHash !== bodyHash) {
      throw new ConflictError('Idempotency-Key reused with a different request body');
    }
    if (existing.responseStatus === PROCESSING_STATUS) {
      throw new ConflictError('A request with this Idempotency-Key is still being processed; retry shortly');
    }
    return c.json(existing.responseBody as any, existing.responseStatus as any);
  }

  try {
    await next();
  } catch (err) {
    // Release the claim so a legitimate retry after a genuine failure isn't permanently
    // stuck behind a "processing" row that will never complete.
    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    throw err;
  }

  const res = c.res.clone();
  if (res.status < 500) {
    const responseBody = await res.json().catch(() => ({}));
    await db.update(schema.idempotencyRecords)
      .set({ responseStatus: res.status, responseBody })
      .where(eq(schema.idempotencyRecords.key, scopedKey));
  } else {
    // Don't persist a 5xx as a "completed" idempotent response — clear the claim so retries work.
    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
  }
};
