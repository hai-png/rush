// Subscription state machine — single source of truth for status transitions.
// All transitions go through here so audit + notification fanout is consistent.

import { db } from '@/lib/db';
import { Money } from '@/lib/money';
import { BadRequestError, ConflictError } from '@/lib/errors';
import { enqueueNotification } from '@/lib/outbox';

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
  tx: typeof db,
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
      type: 'subscription_expiring', // re-using this type for "activated"; original had no 'subscription_activated'
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

// Consume a ride against the subscription. Throws if no rides remaining.
export async function consumeRide(
  tx: typeof db,
  subscriptionId: string,
): Promise<void> {
  const sub = await tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  if (!sub) throw new BadRequestError('Subscription not found');
  if (sub.status !== 'active') throw new BadRequestError('Subscription not active');
  if (sub.plan.ridesIncluded !== -1 && sub.ridesUsed >= sub.plan.ridesIncluded) {
    throw new BadRequestError('No rides remaining in subscription');
  }
  await tx.subscription.update({
    where: { id: subscriptionId },
    data: { ridesUsed: { increment: 1 } },
  });
}
