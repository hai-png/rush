import { and, eq, lt, sql, inArray } from 'drizzle-orm';
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

    const rows = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.riderId, riderId),
        eq(schema.subscriptions.planId, trialPlanId),
        sql`${schema.subscriptions.status} in ('active', 'expired')`,
      ));
    return rows.length > 0;
  },

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

  async cancelStalePending(tx = db, olderThanHours = 2) {
    const cancelled = await tx.update(schema.subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.subscriptions.status, 'pending_payment'),
        lt(schema.subscriptions.createdAt, sql`now() - make_interval(hours => ${olderThanHours})`),
      ))
      .returning({ id: schema.subscriptions.id, riderId: schema.subscriptions.riderId });

    if (cancelled.length > 0) {

      const subIds = cancelled.map(s => s.id);
      await tx.update(schema.payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(
          inArray(schema.payments.subscriptionId, subIds),
          eq(schema.payments.status, 'pending'),
        ));
      await tx.insert(schema.outboxEvents).values(
        cancelled.map(s => ({
          channel: 'audit' as const,
          payload: { action: 'subscription.cancelled_stale', entityId: s.id, userId: s.riderId },
        })),
      );
    }
    return cancelled;
  },

  async decrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`greatest(${schema.subscriptions.ridesUsed} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.status, 'active')));
  },

  async incrementRidesUsed(tx = db, subscriptionId: string) {

    await tx.execute(sql`
      UPDATE subscriptions SET rides_used = rides_used + 1, updated_at = now()
      WHERE id = ${subscriptionId}
        AND status = 'active'
        AND (
          (SELECT rides_included FROM subscription_plans WHERE id = subscriptions.plan_id) = -1
          OR (SELECT rides_included FROM subscription_plans WHERE id = subscriptions.plan_id) > rides_used
        )
    `);
  },
};
