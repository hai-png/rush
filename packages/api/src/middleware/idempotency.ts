import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { ConflictError } from '@addis/shared';

const PROCESSING_STATUS = 0;

const EXEMPT_PATHS = [
  /^\/api\/v1\/auth\//,
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/cron\//,
];

function isExempt(path: string): boolean {
  return EXEMPT_PATHS.some(re => re.test(path));
}

export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  if (isExempt(c.req.path)) return next();
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  if (key.length > 256) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Idempotency-Key too long (max 256 chars)', requestId: c.get('requestId') } }, 400);
  }

  const session = c.get('session');

  if (!session) {
    return next();
  }

  const scope = session.userId;
  const scopedKey = `${scope}:${key}`;

  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 1_000_000) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body too large for idempotency', requestId: c.get('requestId') } }, 413);
  }
  const bodyText = await c.req.raw.clone().text();
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  const claimed = await db.insert(schema.idempotencyRecords).values({
    key: scopedKey, userId: session.userId, method: c.req.method, path: c.req.path,
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

    if (existing.responseStatus >= 200 && existing.responseStatus < 300) {
      return c.json(existing.responseBody as any, existing.responseStatus as any);
    }
    if (existing.responseStatus === 409) {
      return c.json(existing.responseBody as any, existing.responseStatus as any);
    }

    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    throw new ConflictError('Previous request with this Idempotency-Key failed; retry now');
  }

  try {
    await next();
  } catch (err) {

    await db.transaction(async (tx) => {
      await tx.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
    }).catch(() => {  });
    throw err;
  }

  const res = c.res.clone();
  if (res.status >= 200 && res.status < 300) {
    const responseBody = await res.json().catch(() => ({}));
    await db.update(schema.idempotencyRecords)
      .set({ responseStatus: res.status, responseBody })
      .where(eq(schema.idempotencyRecords.key, scopedKey));
  } else if (res.status === 409) {

    const responseBody = await res.json().catch(() => ({}));
    await db.update(schema.idempotencyRecords)
      .set({ responseStatus: res.status, responseBody })
      .where(eq(schema.idempotencyRecords.key, scopedKey));
  } else {

    await db.delete(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, scopedKey));
  }
};
