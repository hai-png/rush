import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { engagementService } from './service';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';

export const engagementRoutes = new Hono();
engagementRoutes.use('*', requireAuth);

engagementRoutes.get('/notifications', async (c) => {
  const { rows, cursor } = await engagementService.listForUser(c.get('session').userId, Number(c.req.query('limit') ?? 20), c.req.query('cursor'));
  return c.json({ data: rows, meta: { cursor, limit: 20 } });
});
engagementRoutes.get('/notifications/unread-count', async (c) => c.json({ data: { count: await engagementService.unreadCount(c.get('session').userId) } }));
engagementRoutes.patch('/notifications/:id', async (c) => { await engagementService.markRead(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });
engagementRoutes.delete('/notifications/:id', async (c) => { await engagementService.remove(c.get('session').userId, c.req.param('id')); return c.body(null, 204); });

engagementRoutes.get('/notifications/preferences', async (c) => c.json({ data: await engagementService.getPreferences(c.get('session').userId) }));
engagementRoutes.patch('/notifications/preferences', async (c) => c.json({ data: await engagementService.updatePreferences(c.get('session').userId, await c.req.json()) }));

engagementRoutes.post('/devices', async (c) => {
  const body = z.object({ pushToken: z.string(), platform: z.enum(['ios', 'android', 'web']) }).parse(await c.req.json());
  const [row] = await db.insert(schema.devices).values({ userId: c.get('session').userId, ...body })
    .onConflictDoUpdate({ target: [schema.devices.userId, schema.devices.pushToken], set: { lastSeenAt: new Date() } }).returning();
  return c.json({ data: row }, 201);
});
engagementRoutes.delete('/devices', async (c) => {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(await c.req.json());
  await db.delete(schema.devices).where(and(eq(schema.devices.userId, c.get('session').userId), eq(schema.devices.pushToken, pushToken)));
  return c.body(null, 204);
});
