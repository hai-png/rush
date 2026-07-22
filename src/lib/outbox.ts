import { db } from '@/lib/db';

export type Channel = 'notification' | 'sms' | 'email' | 'refund' | 'audit' | 'webhook';

export async function enqueue(channel: Channel, payload: unknown): Promise<void> {
  await db.outboxEvent.create({
    data: {
      channel,
      payload: JSON.stringify(payload),
    },
  });
}

export async function enqueueNotification(notif: {
  userId: string; type: string; title: string; body: string; link?: string;
}): Promise<void> {
  // For notifications, write the notification row directly AND enqueue an
  await db.notification.create({ data: notif });
  await enqueue('notification', notif);
}
