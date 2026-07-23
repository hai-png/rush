import { db } from '@/lib/db';

// H2 FIX: added 'push' channel for Expo push notification delivery.
export type Channel = 'notification' | 'sms' | 'email' | 'push';

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
  // H2 FIX: also enqueue a push notification delivery event so the outbox
  // can send it to the user's registered device(s) via Expo Push API.
  await enqueue('push', notif);
}
