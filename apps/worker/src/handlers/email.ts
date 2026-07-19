import { Resend } from 'resend';

/**
 * Email outbox handler. Sends transactional email via Resend.
 *
 * The previous worker index referenced `./handlers/email` but the file did not
 * exist — the worker would crash the first time an `email` channel outbox event
 * was dequeued. We provide a minimal implementation here. If RESEND_API_KEY is
 * not set, the handler throws so the outbox retry/backoff path engages.
 */
export async function handle(payload: { userId: string; subject: string; body: string; to?: string }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured — email outbox event cannot be delivered');
  }
  // If the payload didn't include a `to` address, we need to look it up from the
  // users table. Most outbox events are raised from service code that doesn't know
  // the user's email, only their userId.
  let to = payload.to;
  if (!to) {
    const { db, schema } = await import('@addis/db');
    const { eq } = await import('drizzle-orm');
    const [user] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, payload.userId));
    if (!user?.email) throw new Error(`User ${payload.userId} has no email address on file`);
    to = user.email;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Addis Ride <noreply@addisride.et>',
    to,
    subject: payload.subject,
    text: payload.body,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
