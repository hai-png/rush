import { db } from '@/lib/db';
import type { PrismaClient } from '@prisma/client';

// Prisma transaction client type — matches what db.$transaction callbacks receive.
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// added 'push' channel for Expo push notification delivery.
export type Channel = 'notification' | 'sms' | 'email' | 'push';

export async function enqueue(channel: Channel, payload: unknown): Promise<void> {
  await db.outboxEvent.create({
    data: {
      channel,
      payload: JSON.stringify(payload),
    },
  });
}

// Variant of enqueueNotification that accepts an existing transaction client.
// Use this inside a $transaction callback so the Notification + OutboxEvent
// rows are committed atomically with the caller's other writes — a crash
// between the caller's commit and enqueueNotification would otherwise lose
// the notification.
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
  // For notifications, write the notification row directly AND enqueue an
  // outbox event for push delivery.
  //
  // Wrap Notification + OutboxEvent writes in a single transaction so a
  // process crash between them can't leave orphan rows. Without this, a crash
  // after Notification.create but before enqueue could leave the user with a
  // notification they never got a push for (and vice versa for an outbox
  // event pointing at nothing).
  //
  // NOTE: this MUST be called from outside another $transaction — Prisma does
  // not support nested interactive transactions. All call sites in the
  // codebase invoke enqueueNotification from `sideEffects` arrays that run
  // AFTER the outer transaction commits, so this is safe. For call sites
  // that need atomicity with an in-flight tx, use enqueueNotificationTx.
  await db.$transaction(async (tx) => {
    await enqueueNotificationTx(tx, notif);
  });
}
