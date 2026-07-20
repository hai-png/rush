import { smsProvider } from '@addis/sms';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';

/**
 * SMS outbox handler.
 *
 * FIX (INFRA-009): This handler has NO idempotency guard. If a worker crashes
 * after `smsProvider.send()` succeeds but before the outbox row is marked
 * 'delivered' (e.g. SIGTERM mid-send, DB blip on the UPDATE), the next worker
 * will re-send the SMS — the recipient gets a duplicate. The audit handler
 * (INFRA-003) is the only handler that gets full idempotency in this round
 * (via an outboxEventId stamp in audit_logs). A durable `notification_log`
 * table that every channel writes before dispatch is deferred to follow-up 3
 * (separate task); until then, SMS duplicates are mitigated only by the
 * 5-minute visibility timeout on outbox rows.
 *
 * The `evt` parameter is the full outbox row; it is currently unused but is
 * passed to every handler so the future notification_log writer has access to
 * the event id without another signature change.
 */
export async function handle(
  payload: { userId?: string; phone?: string; body: string },
  _evt?: typeof schema.outboxEvents.$inferSelect,
) {
  let phone = payload.phone;
  if (!phone && payload.userId) {
    const [u] = await db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, payload.userId));
    phone = u?.phone;
  }
  if (phone) await smsProvider.send(phone, payload.body);
}
