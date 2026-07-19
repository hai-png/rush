import { emailProvider } from '@addis/email';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

/**
 * Email outbox handler. Sends transactional email via the @addis/email provider
 * (Resend). If the payload didn't include a `to` address, we look it up from
 * the users table — most outbox events are raised from service code that only
 * knows the userId, not the email.
 *
 * Throws on failure so the outbox retry/backoff path engages.
 */
export async function handle(payload: { userId: string; subject: string; body: string; to?: string; html?: string }) {
  let to = payload.to;
  if (!to) {
    const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, payload.userId));
    if (!user?.email) throw new Error(`User ${payload.userId} has no email address on file`);
    to = user.email;
  }

  const ok = await emailProvider.send({ to, subject: payload.subject, body: payload.body, html: payload.html });
  if (!ok) throw new Error(`Email delivery failed for ${to}`);
}
