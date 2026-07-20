import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { requireAuth } from '../../src/middleware/auth';
import { clientIp } from '../../src/ip';
import { CURRENT_TOS_VERSION } from '@addis/shared';

export const tosRoutes = new TypedHono();

tosRoutes.post('/', requireAuth, async (c) => {
  const session = getSession(c);

  const parsed = z.object({ version: z.string() }).safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'version field is required and must be a string', requestId: c.get('requestId') } },
      400,
    );
  }
  const { version } = parsed.data;
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

    await tx
      .insert(schema.tosAcceptances)
      .values({
        userId: session.userId,
        version,
        ipAddress: clientIp(c) ?? null,
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

tosRoutes.get('/', requireAuth, async (c) => {
  const session = getSession(c);
  const rows = await db
    .select()
    .from(schema.tosAcceptances)
    .where(eq(schema.tosAcceptances.userId, session.userId));
  rows.sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
  return c.json({ data: rows });
});
