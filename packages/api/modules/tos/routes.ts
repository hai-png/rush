import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { requireAuth } from '../../src/middleware/auth';
import { CURRENT_TOS_VERSION } from '@addis/shared';

export const tosRoutes = new TypedHono();

/**
 * Accepts the current (or, defensively, any version the server knows about) Terms of Service.
 * Mounted at /api/v1/tos so the ToS-gate middleware's EXEMPT list (`/^\/api\/v1\/tos/`) allows
 * authenticated users with a stale tosVersion to call this endpoint — otherwise they'd be
 * locked out by 409 TOS_UPDATE_REQUIRED with no way to recover.
 *
 * Records a row in tos_acceptances for audit/legal retention (Proclamation 1321/2024 §17)
 * and bumps the user's tosVersion so subsequent requests pass the gate.
 */
tosRoutes.post('/', requireAuth, async (c) => {
  const session = c.get('session');
  const { version } = z.object({ version: z.string() }).parse(await c.req.json());
  if (version !== CURRENT_TOS_VERSION) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: `Unsupported ToS version. Current is ${CURRENT_TOS_VERSION}`, requestId: c.get('requestId') } },
      400,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ tosVersion: version, updatedAt: new Date() })
      .where(eq(schema.users.id, session.userId));
    // Unique index (userId, version) means a re-accept of the same version is a no-op upsert.
    await tx
      .insert(schema.tosAcceptances)
      .values({
        userId: session.userId,
        version,
        ipAddress: c.req.header('x-forwarded-for') ?? null,
        userAgent: c.req.header('user-agent') ?? null,
      })
      .onConflictDoNothing();
    await tx.insert(schema.outboxEvents).values({
      channel: 'audit',
      payload: { action: 'tos.accepted', entityId: session.userId, version },
    });
  });

  return c.json({ data: { accepted: true, version } });
});

/** Returns the caller's ToS acceptance history (newest first). Used by the account page. */
tosRoutes.get('/', requireAuth, async (c) => {
  const session = c.get('session');
  const rows = await db
    .select()
    .from(schema.tosAcceptances)
    .where(eq(schema.tosAcceptances.userId, session.userId));
  rows.sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
  return c.json({ data: rows });
});
