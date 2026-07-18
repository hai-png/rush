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
    const rows = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.riderId, riderId), eq(schema.subscriptions.planId, trialPlanId)));
    return rows.length > 0;
  },
  async expireDue(tx = db) {
    return tx.update(schema.subscriptions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.status, 'active'), lt(schema.subscriptions.endDate, sql`now()`)))
      .returning({ id: schema.subscriptions.id, riderId: schema.subscriptions.riderId });
  },
  async cancelStalePending(tx = db, olderThanHours = 2) {
    return tx.update(schema.subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.subscriptions.status, 'pending_payment'),
        lt(schema.subscriptions.createdAt, sql`now() - interval '${sql.raw(String(olderThanHours))} hours'`),
      ))
      .returning({ id: schema.subscriptions.id });
  },
  /** CAS decrement used by refund settlement — never goes below 0. */
  async decrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`greatest(${schema.subscriptions.ridesUsed} - 1, 0)`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, subscriptionId));
  },
  async incrementRidesUsed(tx = db, subscriptionId: string) {
    await tx.update(schema.subscriptions)
      .set({ ridesUsed: sql`${schema.subscriptions.ridesUsed} + 1`, updatedAt: new Date() })
      .where(eq(schema.subscriptions.id, subscriptionId));
  },
};
