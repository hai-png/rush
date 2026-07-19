import { getSession } from '../../src/context';
import { TypedHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { engagementService } from './service';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';

export const engagementRoutes = new TypedHono();
engagementRoutes.use('*', requireAuth);

engagementRoutes.get('/notifications', async (c) => {
  const { rows, cursor } = await engagementService.listForUser(getSession(c).userId, Number(c.req.query('limit') ?? 20), c.req.query('cursor'));
  return c.json({ data: rows, meta: { cursor, limit: 20 } });
});
engagementRoutes.get('/notifications/unread-count', async (c) => c.json({ data: { count: await engagementService.unreadCount(getSession(c).userId) } }));
engagementRoutes.patch('/notifications/:id', async (c) => { await engagementService.markRead(getSession(c).userId, c.req.param('id')); return c.body(null, 204); });
engagementRoutes.delete('/notifications/:id', async (c) => { await engagementService.remove(getSession(c).userId, c.req.param('id')); return c.body(null, 204); });

engagementRoutes.get('/notifications/preferences', async (c) => c.json({ data: await engagementService.getPreferences(getSession(c).userId) }));
engagementRoutes.patch('/notifications/preferences', async (c) => c.json({ data: await engagementService.updatePreferences(getSession(c).userId, await c.req.json()) }));

engagementRoutes.post('/devices', async (c) => {
  const body = z.object({ pushToken: z.string(), platform: z.enum(['ios', 'android', 'web']) }).parse(await c.req.json());
  const [row] = await db.insert(schema.devices).values({ userId: getSession(c).userId, ...body })
    .onConflictDoUpdate({ target: [schema.devices.userId, schema.devices.pushToken], set: { lastSeenAt: new Date() } }).returning();
  return c.json({ data: row }, 201);
});
engagementRoutes.delete('/devices', async (c) => {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(await c.req.json());
  await db.delete(schema.devices).where(and(eq(schema.devices.userId, getSession(c).userId), eq(schema.devices.pushToken, pushToken)));
  return c.body(null, 204);
});
