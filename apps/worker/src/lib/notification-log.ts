import { and, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { createId } from '@paralleldrive/cuid2';

export const notificationLogHelper = {

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

      if (err.code === '23505') return false;
      throw err;
    }
  },
};
