
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { Money } from '@/lib/money';
import { BadRequestError, ConflictError } from '@/lib/errors';
import { enqueueNotification } from '@/lib/outbox';

// A transaction client is a narrower PrismaClient that omits $connect/$disconnect/$on/$transaction/$extends.
type TxClient = Prisma.TransactionClient;

export type SubscriptionStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';
export type SubscriptionEvent =
  | 'payment.settled'
  | 'payment.failed'
  | 'cancel'
  | 'expire'
  | 'ride.consumed';

const TRANSITIONS: Record<SubscriptionStatus, Partial<Record<SubscriptionEvent, SubscriptionStatus>>> = {
  pending_payment: {
    'payment.settled': 'active',
    'payment.failed': 'pending_payment', // user can retry
    'cancel': 'cancelled',
  },
  active: {
    'cancel': 'cancelled',
    'expire': 'expired',
  },
  expired: {},
  cancelled: {},
};

export async function transitionSubscription(
  tx: TxClient | typeof db,
  subscriptionId: string,
  event: SubscriptionEvent,
): Promise<void> {
  const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new BadRequestError('Subscription not found');

  const next = TRANSITIONS[sub.status as SubscriptionStatus]?.[event];
  if (!next) {
    throw new ConflictError(
      `Cannot transition subscription from ${sub.status} via ${event}`,
    );
  }
  if (next === sub.status) return; // no-op

  const now = new Date();
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: next,
      cancelledAt: next === 'cancelled' ? now : undefined,
    },
  });

  // Fanout
  if (next === 'active') {
    await enqueueNotification({
      userId: sub.userId,
      type: 'subscription_activated',
      title: 'Subscription activated',
      body: `Your subscription is now active until ${sub.endDate.toLocaleDateString()}.`,
      link: '/dashboard/rider',
    });
  } else if (next === 'expired') {
    await enqueueNotification({
      userId: sub.userId,
      type: 'subscription_expired',
      title: 'Subscription expired',
      body: 'Your subscription has expired. Renew to keep riding.',
      link: '/plans',
    });
  } else if (next === 'cancelled') {
    await enqueueNotification({
      userId: sub.userId,
      type: 'subscription_cancelled',
      title: 'Subscription cancelled',
      body: 'Your subscription has been cancelled.',
      link: '/dashboard/rider',
    });
  }
}

export async function consumeRide(
  tx: TxClient | typeof db,
  subscriptionId: string,
): Promise<void> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) throw new BadRequestError('Subscription not found');
  if (sub.status !== 'active') throw new BadRequestError('Subscription not active');
  if (sub.plan.ridesIncluded === -1) {
    // Unlimited plan — no counter to check, just increment for reporting.
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { ridesUsed: { increment: 1 } },
    });
    return;
  }
  // Atomic CAS update: only increment if we haven't hit the cap. Two
  // concurrent POST /rides with the same sub will see exactly one succeed.
  const updated = await tx.subscription.updateMany({
    where: { id: subscriptionId, ridesUsed: { lt: sub.plan.ridesIncluded } },
    data: { ridesUsed: { increment: 1 } },
  });
  if (updated.count === 0) {
    throw new BadRequestError('No rides remaining in subscription');
  }
}
