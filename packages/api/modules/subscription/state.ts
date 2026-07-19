import { defineStateMachine } from '@addis/shared';
import type { SubscriptionStatus } from '@addis/shared';
import { eq, sql } from 'drizzle-orm';

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

/**
 * Applies a transition to a row inside an existing transaction.
 *
 * The previous implementation did SELECT-then-UPDATE with no CAS guard —
 * two concurrent `cancel` calls both SELECT (see `active`), both resolve
 * to `cancelled`, both UPDATE. Worse, if `payment.settled` and `cancel`
 * raced, the cancel could overwrite the settle, losing the payment
 * settlement. Now the UPDATE has `WHERE id = ? AND status = ?` (CAS), so
 * only the first transition wins; the second throws InvalidTransitionError
 * because the row's status has already moved.
 */
export async function transitionSubscription(
  tx: import('@addis/db').Db, subscriptionId: string, event: string,
) {
  const { schema } = await import('@addis/db');
  const [row] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, subscriptionId));
  if (!row) throw new Error(`Subscription ${subscriptionId} not found`);
  const t = subscriptionState.resolve(row.status, event);

  // CAS update: only update if the status hasn't changed since we read it.
  // If zero rows are updated, another transaction beat us — re-read and
  // throw InvalidTransitionError for the new state.
  const updated = await tx.update(schema.subscriptions)
    .set({ status: t.to, updatedAt: new Date() })
    .where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.status, row.status)))
    .returning();
  if (updated.length === 0) {
    // Someone else transitioned this subscription concurrently. Re-read to
    // throw an accurate error.
    const [fresh] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, subscriptionId));
    if (fresh) {
      // Re-resolve against the new state — will throw InvalidTransitionError
      // if the event is now illegal, which is the correct behavior.
      subscriptionState.resolve(fresh.status, event);
    }
    throw new Error(`Subscription ${subscriptionId} transition lost to concurrent writer`);
  }
  return { from: t.from, to: t.to, sideEffects: t.sideEffects ?? [] };
}

// Importing `and` here to avoid top-level churn — it's used in the CAS where clause above.
import { and } from 'drizzle-orm';
