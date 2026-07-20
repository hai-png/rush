import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { createId } from '@paralleldrive/cuid2';

/**
 * FOLLOW-UP 3 (INFRA-009): Idempotency helper for SMS/email/push handlers.
 *
 * Records every successfully-sent message in `notification_log`, keyed by
 * (outboxEventId, channel). Handlers call `alreadySent` at the start to
 * skip re-sends on outbox retry, and `recordSent` after a successful send.
 *
 * The unique index on (outbox_event_id, channel) is the dedup primitive —
 * if two workers race to send the same outbox event, only one INSERT wins.
 */
export const notificationLogHelper = {
  /**
   * Returns true if a message for this outbox event + channel has already
   * been sent successfully. Call at the START of every handler.
   */
  async alreadySent(outboxEventId: string, channel: 'sms' | 'email' | 'push'): Promise<boolean> {
    const rows = await db.select({ id: schema.notificationLog.id })
      .from(schema.notificationLog)
      .where(and(
        eq(schema.notificationLog.outboxEventId, outboxEventId),
        eq(schema.notificationLog.channel, channel),
      ))
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Record a successful send. The unique index on (outbox_event_id, channel)
   * means a concurrent INSERT from another worker loses — only one wins.
   * Returns true if this call won the race (the row was inserted), false if
   * another worker already recorded the send.
   */
  async recordSent(outboxEventId: string, channel: 'sms' | 'email' | 'push', recipient: string, providerMessageId?: string): Promise<boolean> {
    try {
      await db.insert(schema.notificationLog).values({
        id: createId(),
        outboxEventId,
        channel,
        recipient,
        providerMessageId: providerMessageId ?? null,
      });
      return true;
    } catch (err: any) {
      // 23505 = unique_violation — another worker already recorded this send.
      if (err.code === '23505') return false;
      throw err;
    }
  },
};
