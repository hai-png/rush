import { smsProvider } from '@addis/sms';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

export async function handle(
  payload: { userId?: string; phone?: string; body: string },
  evt?: typeof schema.outboxEvents.$inferSelect,
) {
  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'sms')) {
    return;
  }
  let phone = payload.phone;
  if (!phone && payload.userId) {
    const [u] = await db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, payload.userId));
    phone = u?.phone;
  }
  if (phone) {
    await smsProvider.send(phone, payload.body);

    if (evt?.id) {
      try { await notificationLogHelper.recordSent(evt.id, 'sms', phone); }
      catch (err) { console.error('[sms-outbox] recordSent failed (duplicate risk):', (err as Error).message); }
    }
  }
}
