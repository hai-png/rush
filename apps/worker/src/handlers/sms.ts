import { smsProvider } from '@addis/sms';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

/**
 * SMS outbox handler.
 *
 * FOLLOW-UP 3 (INFRA-009): Durable idempotency via notification_log. The
 * handler checks `alreadySent` at the start (skip if already delivered) and
 * calls `recordSent` after a successful send. The unique index on
 * (outbox_event_id, channel) is the dedup primitive — concurrent workers
 * racing to send the same outbox event, only one INSERT wins.
 */
export async function handle(
  payload: { userId?: string; phone?: string; body: string },
  evt?: typeof schema.outboxEvents.$inferSelect,
) {
  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'sms')) {
    return; // already sent — duplicate-suppressed
  }
  let phone = payload.phone;
  if (!phone && payload.userId) {
    const [u] = await db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, payload.userId));
    phone = u?.phone;
  }
  if (phone) {
    await smsProvider.send(phone, payload.body);
    if (evt?.id) await notificationLogHelper.recordSent(evt.id, 'sms', phone);
  }
}
