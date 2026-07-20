import { TypedOpenAPIHono } from '../../src/typed-hono';
import { z } from 'zod';
import { requireAuth } from '../../src/middleware/auth';
import { engagementService } from './service';
import { db, schema } from '@addis/db';
import { eq, and } from 'drizzle-orm';

export const engagementRoutes = new TypedOpenAPIHono();
engagementRoutes.use('*', requireAuth);

engagementRoutes.get('/notifications', async (c) => {
  const { parseLimit } = await import('../../src/limit');
  const limit = parseLimit(c.req.query('limit'));
  const { rows, cursor } = await engagementService.listForUser(c.get('session')!.userId, limit, c.req.query('cursor'));
  return c.json({ data: rows, meta: { cursor, limit } });
});
engagementRoutes.get('/notifications/unread-count', async (c) => c.json({ data: { count: await engagementService.unreadCount(c.get('session')!.userId) } }));
engagementRoutes.patch('/notifications/:id', async (c) => { await engagementService.markRead(c.get('session')!.userId, c.req.param('id')); return c.body(null, 204); });
engagementRoutes.delete('/notifications/:id', async (c) => { await engagementService.remove(c.get('session')!.userId, c.req.param('id')); return c.body(null, 204); });

const ChannelKeyZ = z.enum(['inApp', 'push', 'sms', 'email']);
const NotificationTypeZ = z.enum([
  'payment_received', 'payment_failed', 'refund_completed', 'refund_failed',
  'seat_claimed', 'seat_released', 'seat_release_expired',
  'subscription_expiring', 'subscription_expired', 'subscription_cancelled',
  'trip_departing', 'document_verified', 'document_rejected',
  'support_reply', 'support_resolved',
  'corporate_member_added', 'corporate_member_removed', 'corporate_reset',
  'general',
]);
const TimeOfDayZ = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM');
const UpdatePreferencesInput = z.object({

  prefs: z.record(NotificationTypeZ, z.record(ChannelKeyZ, z.boolean())).optional(),
  quietHoursStart: TimeOfDayZ.nullable().optional(),
  quietHoursEnd: TimeOfDayZ.nullable().optional(),
}).strict();

engagementRoutes.patch('/notifications/preferences', async (c) => {
  const body = UpdatePreferencesInput.parse(await c.req.json());
  return c.json({ data: await engagementService.updatePreferences(c.get('session')!.userId, body as any) });
});

engagementRoutes.post('/devices', async (c) => {
  const body = z.object({ pushToken: z.string(), platform: z.enum(['ios', 'android', 'web']) }).parse(await c.req.json());
  // SEC-018: include `platform` in the conflict target so a token that
  // somehow gets registered from two different platforms (shouldn't happen
  // with Expo, but defense in depth) updates the platform field rather
  // than leaving it stale.
  const [row] = await db.insert(schema.devices).values({ userId: c.get('session')!.userId, ...body })
    .onConflictDoUpdate({
      target: [schema.devices.userId, schema.devices.pushToken],
      set: { lastSeenAt: new Date(), platform: body.platform },
    }).returning();
  return c.json({ data: row }, 201);
});
engagementRoutes.delete('/devices', async (c) => {
  const { pushToken } = z.object({ pushToken: z.string() }).parse(await c.req.json());
  await db.delete(schema.devices).where(and(eq(schema.devices.userId, c.get('session')!.userId), eq(schema.devices.pushToken, pushToken)));
  return c.body(null, 204);
});
