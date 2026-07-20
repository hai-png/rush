import { addDays } from 'date-fns';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, PAYMENT_RETENTION_YEARS, loadEnv } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { createId } from '@paralleldrive/cuid2';
import type { CreateSubscriptionInput } from './types';
import { subscriptionRepo } from './repository';
import { transitionSubscription } from './state';
import { scheduleRefund } from '../payment/service';

const env = loadEnv();
function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }

function generateMerchOrderId() { return `SUB${createId()}`; }

export const subscriptionService = {
  async create(input: CreateSubscriptionInput) {
    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, input.planId));
    if (!plan || !plan.isActive) throw new NotFoundError('Plan not found');
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, input.routeId));
    if (!route || !route.isActive) throw new NotFoundError('Route not found');

    const existing = await subscriptionRepo.findActiveForRiderRoute(input.riderId, input.routeId);
    if (existing) throw new ConflictError('Rider already has an active subscription on this route');

    if (plan.isTrial && await subscriptionRepo.hasUsedTrial(input.riderId, plan.id)) {
      throw new ConflictError('Trial plan already used');
    }

    let price = Money.fromDecimal(plan.priceETB);
    let corporateMemberId: string | null = null;
    if (input.corporateMemberId) {

      const [member] = await db.select().from(schema.corporateMembers).where(eq(schema.corporateMembers.id, input.corporateMemberId));
      if (!member || member.approvalStatus !== 'approved' || !member.isActive) {
        throw new BadRequestError('Corporate membership not approved');
      }

      const [riderProfile] = await db.select().from(schema.riderProfiles).where(eq(schema.riderProfiles.id, input.riderId));
      if (!riderProfile || member.userId !== riderProfile.userId) {
        throw new BadRequestError('Corporate membership does not belong to this rider');
      }
      const [corp] = await db.select().from(schema.corporates).where(eq(schema.corporates.id, member.corporateId));
      if (corp && corp.isActive) {
        price = price.sub(price.pct(corp.subsidyPercent));
      }
      corporateMemberId = member.id;
    }

    const { sub, payment, merchOrderId } = await db.transaction(async (tx) => {
      const [sub] = await tx.insert(schema.subscriptions).values({
        riderId: input.riderId, planId: plan.id, routeId: route.id, corporateMemberId,
        status: 'pending_payment',
        morningSlot: input.morningSlot, eveningSlot: input.eveningSlot,
        startDate: new Date(), endDate: addDays(new Date(), plan.durationDays),
      }).returning();

      const merchOrderId = generateMerchOrderId();
      const [payment] = await tx.insert(schema.payments).values({
        riderId: input.riderId, subscriptionId: sub!.id, amount: price.toString(),
        method: input.paymentMethod, reference: merchOrderId, status: 'pending',
        retentionExpiresAt: addYears(new Date(), PAYMENT_RETENTION_YEARS),
      }).returning();

      return { sub: sub!, payment: payment!, merchOrderId };
    });

    const provider = getPaymentProvider(input.paymentMethod);
    const checkout = await provider.createCheckout({
      merchOrderId, amount: price, description: `Addis Ride — ${plan.name}`,
      notifyUrl: env.TELEBIRR_NOTIFY_URL, redirectUrl: env.TELEBIRR_REDIRECT_URL,
    });

    if (checkout.status === 'checkout') {
      await db.update(schema.payments).set({ prepayId: checkout.prepayId }).where(eq(schema.payments.id, payment.id));
    }

    return { subscription: sub, payment, checkout };
  },

  async renew(subscriptionId: string, riderId: string, paymentMethod: 'telebirr' | 'cbe') {
    const sub = await subscriptionRepo.findById(subscriptionId);
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'expired' && sub.status !== 'cancelled') throw new ConflictError('Only expired/cancelled subscriptions can be renewed');

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

      if (sub.status === 'active') {
        const [plan] = await tx.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
        const [payment] = await tx.select().from(schema.payments)
          .where(and(eq(schema.payments.subscriptionId, subscriptionId), eq(schema.payments.status, 'completed')))
          .orderBy(desc(schema.payments.createdAt)).limit(1);
        if (plan && payment && plan.ridesIncluded > 0) {
          const unusedRides = Math.max(0, plan.ridesIncluded - sub.ridesUsed);
          if (unusedRides > 0) {

            const paidAmount = Money.fromDecimal(payment.amount);
            const refundAmount = paidAmount.mul(unusedRides).div(plan.ridesIncluded);

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
