import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { ConflictError } from '@addis/shared';

export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  const bodyText = await c.req.raw.clone().text();
  const bodyHash = createHash('sha256').update(bodyText).digest('hex');

  const [existing] = await db.select().from(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, key));
  if (existing) {
    if (existing.requestBodyHash !== bodyHash) throw new ConflictError('Idempotency-Key reused with a different request body');
    return c.json(existing.responseBody as any, existing.responseStatus as any);
  }

  await next();

  const res = c.res.clone();
  if (res.status < 500) {
    const responseBody = await res.json().catch(() => ({}));
    await db.insert(schema.idempotencyRecords).values({
      key, method: c.req.method, path: c.req.path, requestBodyHash: bodyHash,
      responseStatus: res.status, responseBody, expiresAt: new Date(Date.now() + 24 * 3600_000),
    }).onConflictDoNothing();
  }
};
