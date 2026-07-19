import { addDays } from 'date-fns';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, PAYMENT_RETENTION_YEARS, loadEnv } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import type { CreateSubscriptionInput } from './types';
import { subscriptionRepo } from './repository';
import { transitionSubscription } from './state';
import { scheduleRefund } from '../payment/service';

const env = loadEnv();
function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }
function generateMerchOrderId() { return `SUB${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }

export const subscriptionService = {
  async create(input: CreateSubscriptionInput) {
    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, input.planId));
    if (!plan || !plan.isActive) throw new NotFoundError('Plan not found');
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, input.routeId));
    if (!route || !route.isActive) throw new NotFoundError('Route not found');

    // Business rule: one active subscription per (rider, route)
    const existing = await subscriptionRepo.findActiveForRiderRoute(input.riderId, input.routeId);
    if (existing) throw new ConflictError('Rider already has an active subscription on this route');

    // Business rule: trial plan usable once per rider
    if (plan.isTrial && await subscriptionRepo.hasUsedTrial(input.riderId, plan.id)) {
      throw new ConflictError('Trial plan already used');
    }

    let price = Money.fromDecimal(plan.priceETB);
    let corporateMemberId: string | null = null;
    if (input.corporateMemberId) {
      // Corporate subsidy IDOR: the previous implementation accepted ANY
      // corporateMemberId without verifying that the membership belongs to
      // the requesting rider. A rider could pass a corporate admin's member
      // ID and ride at that corporate's subsidy rate they're not entitled
      // to. Now we look up the rider's profile by id (passed in
      // input.riderId, which the route has already translated from
      // session.userId) and verify the membership's userId matches.
      const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.id, input.corporateMemberId));
      if (!member || member.approvalStatus !== 'approved' || !member.isActive) {
        throw new BadRequestError('Corporate membership not approved');
      }
      // Look up the rider profile to get the userId, then verify ownership.
      const [riderProfile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.id, input.riderId));
      if (!riderProfile || member.userId !== riderProfile.userId) {
        throw new BadRequestError('Corporate membership does not belong to this rider');
      }
      const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.id, member.corporateId));
      if (corp && corp.isActive) {
        price = price.sub(price.pct(corp.subsidyPercent)); // employee pays discounted share
      }
      corporateMemberId = member.id;
    }

    // First transaction: insert pending subscription + payment rows, then commit.
    // Do NOT hold this transaction open across the provider network call — if Telebirr
    // takes 5 seconds, the row locks are held for 5 seconds, exhausting the connection pool.
    const { sub, payment, merchOrderId } = await db.transaction(async (tx) => {
      const [sub] = await tx.insert(schema.subscriptions).values({
        riderId: input.riderId, planId: plan.id, routeId: route.id, corporateMemberId,
        status: 'pending_payment',
        morningSlot: input.morningSlot, eveningSlot: input.eveningSlot,
        startDate: new Date(), endDate: addDays(new Date(), plan.durationDays),
      }).returning();

      const merchOrderId = generateMerchOrderId();
      const [payment] = await tx.insert(schema.payments).values({
        riderId: input.riderId, subscriptionId: sub.id, amount: price.toString(),
        method: input.paymentMethod, reference: merchOrderId, status: 'pending',
        retentionExpiresAt: addYears(new Date(), PAYMENT_RETENTION_YEARS),
      }).returning();

      return { sub, payment, merchOrderId };
    });

    // Provider call outside the transaction — network latency won't hold DB locks.
    const provider = getPaymentProvider(input.paymentMethod);
    const checkout = await provider.createCheckout({
      merchOrderId, amount: price, description: `Addis Ride — ${plan.name}`,
      notifyUrl: env.TELEBIRR_NOTIFY_URL, redirectUrl: env.TELEBIRR_REDIRECT_URL,
    });

    // Second transaction: update prepayId if the provider returned one.
    if (checkout.status === 'checkout') {
      await db.update(schema.payments).set({ prepayId: checkout.prepayId }).where(eq(schema.payments.id, payment.id));
    }

    return { subscription: sub, payment, checkout };
  },

  async renew(subscriptionId: string, riderId: string, paymentMethod: 'telebirr' | 'cbe') {
    const sub = await subscriptionRepo.findById(subscriptionId);
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'expired' && sub.status !== 'cancelled') throw new ConflictError('Only expired/cancelled subscriptions can be renewed');
    // routeId is nullable on subscriptions (ON DELETE SET NULL from routes), but
    // create() requires it. A subscription without a route cannot be renewed —
    // the route was likely deleted. Surface a clear error instead of crashing
    // on the `!` non-null assertion. (H48 fix.)
    if (!sub.routeId) throw new BadRequestError('Cannot renew a subscription whose route has been deleted');
    return subscriptionService.create({
      riderId, planId: sub.planId, routeId: sub.routeId,
      morningSlot: sub.morningSlot ?? undefined, eveningSlot: sub.eveningSlot ?? undefined,
      paymentMethod, corporateMemberId: sub.corporateMemberId ?? undefined,
    });
  },

  async cancel(subscriptionId: string, riderId: string) {
    const sub = await subscriptionRepo.findById(subscriptionId);
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    return db.transaction(async (tx) => {
      const result = await transitionSubscription(tx, subscriptionId, 'subscription.cancelled');
      await tx.update(schema.subscriptions).set({ cancelledAt: new Date() }).where(eq(schema.subscriptions.id, subscriptionId));

      // If the subscription is active and has a completed payment, queue a
      // prorated refund for the unused rides. The state machine's sideEffects
      // list includes 'refund.if_eligible' — we implement that check here
      // rather than in the state machine itself (which stays pure).
      //
      // We call scheduleRefund (which validates: payment completed, amount
      // positive, cumulative ≤ original) rather than inserting into
      // refundRetries directly. This ensures the cancel-path refund goes
      // through the same validation as admin-initiated refunds. (H49 fix.)
      //
      // H44 fix: the per-ride value is derived from the ACTUAL PAID AMOUNT
      // (payment.amount), not from plan.priceETB. A corporate-subsidy
      // subscriber who paid 40% of the list price must be refunded based on
      // what they actually paid, not the full list price — otherwise the
      // refund exceeds the charge (money laundering). For unlimited plans
      // (ridesIncluded === -1), no per-ride refund is due.
      if (sub.status === 'active') {
        const [plan] = await tx.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
        const [payment] = await tx.select().from(schema.payments)
          .where(and(eq(schema.payments.subscriptionId, subscriptionId), eq(schema.payments.status, 'completed')))
          .orderBy(desc(schema.payments.createdAt)).limit(1);
        if (plan && payment && plan.ridesIncluded > 0) {
          const unusedRides = Math.max(0, plan.ridesIncluded - sub.ridesUsed);
          if (unusedRides > 0) {
            // H44: use payment.amount (actual paid), not plan.priceETB (list price).
            const paidAmount = Money.fromDecimal(payment.amount);
            const perRide = paidAmount.div(plan.ridesIncluded);
            const refundAmount = perRide.mul(unusedRides);
            // Only schedule if the refund amount is positive and doesn't exceed
            // the payment amount (scheduleRefund enforces both, but we skip
            // the call entirely for zero amounts to avoid a no-op audit row).
            if (refundAmount.isPositive() && refundAmount.lte(paidAmount)) {
              await scheduleRefund(payment.id, refundAmount, 'subscription_cancelled', tx);
            }
          }
        }
      }

      await tx.insert(schema.outboxEvents).values([
        { channel: 'notification', payload: { type: 'subscription_cancelled', userId: riderId } },
        { channel: 'audit', payload: { action: 'subscription.cancelled', entityId: subscriptionId } },
      ]);
      return result;
    });
  },
};
