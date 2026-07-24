import { db } from '@/lib/db';
import type { PrismaClient } from '@prisma/client';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type Channel = 'notification' | 'sms' | 'email' | 'push';

export async function enqueue(channel: Channel, payload: unknown): Promise<void> {
  await db.outboxEvent.create({
    data: {
      channel,
      payload: JSON.stringify(payload),
    },
  });
}

export async function enqueueNotificationTx(tx: TxClient, notif: {
  userId: string; type: string; title: string; body: string; link?: string;
}): Promise<void> {
  await tx.notification.create({ data: notif });
  await tx.outboxEvent.create({
    data: { channel: 'notification', payload: JSON.stringify(notif) },
  });
  await tx.outboxEvent.create({
    data: { channel: 'push', payload: JSON.stringify(notif) },
  });
}

export async function enqueueNotification(notif: {
  userId: string; type: string; title: string; body: string; link?: string;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await enqueueNotificationTx(tx, notif);
  });
}

