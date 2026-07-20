import { emailProvider } from '@addis/email';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { notificationLogHelper } from '../lib/notification-log';

export async function handle(
  payload: { userId: string; subject: string; body: string; to?: string; html?: string },
  evt?: typeof schema.outboxEvents.$inferSelect,
) {
  if (evt?.id && await notificationLogHelper.alreadySent(evt.id, 'email')) {
    return;
  }
  let to = payload.to;
  if (!to) {
    const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, payload.userId) as any);
    if (!user?.email) throw new Error(`User ${payload.userId} has no email address on file`);
    to = user.email;
  }

  const ok = await emailProvider.send({ to, subject: payload.subject, body: payload.body, html: payload.html } as any);
  if (!ok) throw new Error(`Email delivery failed for ${to}`);

  if (evt?.id) {
    try { await notificationLogHelper.recordSent(evt.id, 'email', to); }
    catch (err) { console.error('[email-outbox] recordSent failed (duplicate risk):', (err as Error).message); }
  }
}
