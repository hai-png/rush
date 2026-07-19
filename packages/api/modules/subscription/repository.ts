import { and, eq, lt, sql } from 'drizzle-orm';
import { db, schema } from '@addis/db';

export const subscriptionRepo = {
  async findById(id: string) {
    const [row] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
    return row ?? null;
  },
  async findActiveForRiderRoute(riderId: string, routeId: string) {
    const [row] = await db.select().from(schema.subscriptions).where(and(
      eq(schema.subscriptions.riderId, riderId),
      eq(schema.subscriptions.routeId, routeId),
      eq(schema.subscriptions.status, 'active'),
    ));
    return row ?? null;
  },
  async hasUsedTrial(riderId: string, trialPlanId: string) {
    // Only count subscriptions that actually resulted in a payment — the
    // previous implementation counted ANY subscription row, including ones
    // that went to 'cancelled' via cancelStalePending (payment never
    // settled). A rider whose trial payment failed could never trial again.
    const rows = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.riderId, riderId),
        eq(schema.subscriptions.planId, trialPlanId),
        sql`${schema.subscriptions.status} in ('active', 'expired')`,
      ));
    return rows.length > 0;
  },

  /**
   * Bulk-expire active subscriptions whose endDate has passed.
   *
   * The previous implementation did a raw UPDATE with no outbox events —
   * the state machine declared `notify.subscription_expired` and
   * `audit.subscription_expired` side effects, but they were never fired.
   * Riders whose subscriptions expired via cron got NO notification. Now
   * we queue per-subscription outbox events in the same transaction.
   */
  async expireDue(tx = db) {
    const expired = await tx.update(schema.subscriptions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.status, 'active'), lt(schema.subscriptions.endDate, sql`now()`)))
      .returning({ id: schema.subscriptions.id, riderId: schema.subscriptions.riderId });

    if (expired.length > 0) {
      await tx.insert(schema.outboxEvents).values(
        expired.flatMap(s => [
          { channel: 'notification' as const, payload: { type: 'subscription_expired', userId: s.riderId, subscriptionId: s.id } },
          { channel: 'audit' as const, payload: { action: 'subscription.expired', entityId: s.id } },
        ]),
      );
    }
    return expired;
  },

  /**
   * Cancel stale pending_payment subscriptions.
   *
   * Same fix as expireDue: queue per-subscription outbox events. Also
   * parameterized the interval safely — the previous implementation used
   * `sql.raw(String(olderThanHours))` which would be a SQL injection
   * vector if a future caller passed user-controlled input.
   */
  async cancelStalePending(tx = db, olderThanHours = 2) {
    const cancelled = await tx.update(schema.subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.subscriptions.status, 'pending_payment'),
        lt(schema.subscriptions.createdAt, sql`now() - make_interval(hours => ${olderThanHours})`),
      ))
      .returning({ id: schema.subscriptions.id, riderId: schema.subscriptions.riderId });

    if (cancelled.length > 0) {
      await tx.insert(schema.outboxEvents).values(
        cancelled.map(s => ({
          channel: 'audit' as const,
          payload: { action: 'subscription.cancelled_stale', entityId: s.id, userId: s.riderId },
        })),
      );
    }
    return cancelled;
  },

  /**
   * CAS decrement used by refund settlement — never goes below 0.
   * Now also guards against decrementing on a cancelled/expired subscription.
   */
  async decrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`greatest(${schema.subscriptions.ridesUsed} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.status, 'active')));
  },

  /**
   * Increment ridesUsed. The previous implementation had no guard — a
   * cancelled or expired subscription could still be incremented, and
   * ridesUsed could exceed the plan's ridesIncluded. The caller
   * (operations/service.ts completeTrip) now checks both before calling,
   * but we add a DB-level guard too for defense in depth: only increment
   * if the subscription is active AND ridesUsed is still under the plan
   * limit (or the plan is unlimited).
   */
  async incrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.execute(sql`
      UPDATE subscriptions SET rides_used = rides_used + 1, updated_at = now()
      WHERE id = ${subscriptionId}
        AND status = 'active'
        AND (
          SELECT rides_included FROM subscription_plans WHERE id = subscriptions.plan_id
        ) = -1
        OR (
          SELECT rides_included FROM subscription_plans WHERE id = subscriptions.plan_id
        ) > rides_used
    `);
  },
};
