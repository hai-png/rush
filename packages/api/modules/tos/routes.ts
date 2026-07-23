import { createRoute } from '@hono/zod-openapi';
import { getSession } from '../../src/context';
import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { requireAuth } from '../../src/middleware/auth';
import { clientIp } from '../../src/ip';
import { CURRENT_TOS_VERSION, ErrorSchema } from '@addis/shared';

export const tosRoutes = new TypedOpenAPIHono();

const acceptRoute = createRoute({
  method: 'post',
  path: '/',
  middleware: [requireAuth] as const,
  request: {
    body: { content: { 'application/json': { schema: z.object({ version: z.string() }) } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ data: z.object({ accepted: z.boolean(), version: z.string() }) }) } }, description: 'Accepted' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad request' },
  },
});

tosRoutes.openapi(acceptRoute, async (c) => {
  const session = getSession(c);
  const { version } = c.req.valid('json');
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

const getRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { 'application/json': { schema: z.object({ data: z.array(z.any()) }) } }, description: 'Acceptance history' },
  },
});

tosRoutes.openapi(getRoute, async (c) => {
  const session = getSession(c);
  const rows = await db
    .select()
    .from(schema.tosAcceptances)
    .where(eq(schema.tosAcceptances.userId, session.userId));
  rows.sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
  return c.json({ data: rows });
});
