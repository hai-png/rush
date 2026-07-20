import { emailProvider } from '@addis/email';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

/**
 * Email outbox handler. Sends transactional email via the @addis/email provider
 * (Resend). If the payload didn't include a `to` address, we look it up from
 * the users table — most outbox events are raised from service code that only
 * knows the userId, not the email.
 *
 * Throws on failure so the outbox retry/backoff path engages.
 *
 * FOLLOW-UP 3 (INFRA-009): Durable idempotency via notification_log.
 */
export async function handle(
  payload: { userId: string; subject: string; body: string; to?: string; html?: string },
  evt?: typeof schema.outboxEvents.$inferSelect,
) {
  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'email')) {
    return; // already sent — duplicate-suppressed
  }
  let to = payload.to;
  if (!to) {
    const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, payload.userId));
    if (!user?.email) throw new Error(`User ${payload.userId} has no email address on file`);
    to = user.email;
  }

  const ok = await emailProvider.send({ to, subject: payload.subject, body: payload.body, html: payload.html });
  if (!ok) throw new Error(`Email delivery failed for ${to}`);
  // FA-004: log but don't throw on recordSent failure (see sms.ts for rationale).
  if (evt?.id) {
    try { await notificationLogHelper.recordSent(evt.id, 'email', to); }
    catch (err) { console.error('[email-outbox] recordSent failed (duplicate risk):', (err as Error).message); }
  }
}
