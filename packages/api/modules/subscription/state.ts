import { defineStateMachine } from '@addis/shared';
import type { SubscriptionStatus } from '@addis/shared';

export const subscriptionState = defineStateMachine<SubscriptionStatus>({
  initial: 'pending_payment',
  transitions: [
    { from: 'pending_payment', to: 'active', event: 'payment.settled', sideEffects: ['notify.payment_received', 'audit.subscription_activated'] },
    { from: 'pending_payment', to: 'cancelled', event: 'payment.failed', sideEffects: ['notify.payment_failed', 'audit.subscription_cancelled'] },
    { from: 'pending_payment', to: 'cancelled', event: 'subscription.stale', sideEffects: ['audit.subscription_cancelled'] },
    { from: 'active', to: 'expired', event: 'subscription.expired', sideEffects: ['notify.subscription_expired', 'audit.subscription_expired'] },
    { from: 'active', to: 'cancelled', event: 'subscription.cancelled', sideEffects: ['refund.if_eligible', 'notify.subscription_cancelled', 'audit.subscription_cancelled'] },
  ],
});

/** Applies a transition to a row inside an existing transaction. Throws InvalidTransitionError if illegal. */
export async function transitionSubscription(
  tx: import('@addis/db').DbOrTx, subscriptionId: string, event: string,
) {
  const { schema } = await import('@addis/db');
  const { eq } = await import('drizzle-orm');
  const [row] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, subscriptionId));
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`);
  const t = subscriptionState.resolve(row.status, event);
  await tx.update(schema.subscriptions).set({ status: t.to, updatedAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId));
  return { from: t.from, to: t.to, sideEffects: t.sideEffects ?? [] };
}
