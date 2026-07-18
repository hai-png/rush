import { addHours } from 'date-fns';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, proratedRideValue, PAYMENT_RETENTION_YEARS } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { scheduleRefund } from '../payment/service';

const SEAT_RELEASE_TTL_HOURS = Number(process.env.SEAT_RELEASE_TTL_HOURS ?? 4);
function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }
function generateMerchOrderId() { return `CLM${Date.now()}${Math.random().toString(36).slice(2, 8)}`; }

export const marketplaceService = {
  async release(riderId: string, input: { subscriptionId: string; releaseDate: string; window: 'morning' | 'evening' }) {
    const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId));
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'active') throw new ConflictError('Subscription is not active');
    if (!sub.routeId) throw new BadRequestError('Subscription has no route');
    if (new Date(input.releaseDate) < new Date(new Date().toDateString())) throw new BadRequestError('Release date must be in the future');

    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, sub.routeId));
    if (!plan || !route) throw new NotFoundError('Plan or route not found');

    const refundAmount = proratedRideValue(Money.fromDecimal(plan.priceETB), plan.ridesIncluded, Money.fromDecimal(route.fare));

    try {
      const [release] = await db.insert(schema.seatReleases).values({
        subscriptionId: sub.id, riderId, routeId: sub.routeId, window: input.window,
        releaseDate: input.releaseDate, refundAmount: refundAmount.toString(),
        expiresAt: addHours(new Date(`${input.releaseDate}T00:00:00Z`), 24 + SEAT_RELEASE_TTL_HOURS), // end of release day + TTL
      }).returning();
      await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_released', userId: riderId } });
      return release;
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Seat already released for this date/window'); // unique index violation
      throw e;
    }
  },

  async cancelRelease(riderId: string, releaseId: string) {
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, releaseId));
    if (!release || release.riderId !== riderId) throw new NotFoundError('Release not found');
    if (release.status !== 'open') throw new ConflictError('Release cannot be cancelled in its current state');
    await db.update(schema.seatReleases).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.seatReleases.id, releaseId));
  },

  /** Atomic claim via CAS update — race-free even with concurrent claimers. */
  async claim(claimerId: string, input: { seatReleaseId: string; paymentMethod: 'telebirr' | 'cbe' }) {
    const result = await db.transaction(async (tx) => {
      const claimed = await tx.update(schema.seatReleases)
        .set({ status: 'claimed', updatedAt: new Date() })
        .where(and(
          eq(schema.seatReleases.id, input.seatReleaseId),
          eq(schema.seatReleases.status, 'open'),
          gt(schema.seatReleases.expiresAt, new Date()),
        ))
        .returning();
      if (claimed.length === 0) throw new ConflictError('Seat already claimed, cancelled, or expired');

      const release = claimed[0];
      if (release.riderId === claimerId) throw new BadRequestError('Cannot claim your own released seat');

      const merchOrderId = generateMerchOrderId();
      const [payment] = await tx.insert(schema.payments).values({
        riderId: claimerId, amount: release.refundAmount, method: input.paymentMethod,
        reference: merchOrderId, status: 'pending', retentionExpiresAt: addYears(new Date(), PAYMENT_RETENTION_YEARS),
      }).returning();

      const [claim] = await tx.insert(schema.seatClaims).values({
        seatReleaseId: input.seatReleaseId, riderId: claimerId, routeId: release.routeId,
        window: release.window, paymentId: payment.id, status: 'confirmed',
      }).returning();

      await tx.update(schema.payments).set({ seatClaimId: claim.id }).where(eq(schema.payments.id, payment.id));

      // Find original subscriber's payment to refund once claimer pays (queued on settle, not here)
      return { release, claim, payment };
    });

    const provider = getPaymentProvider(input.paymentMethod);
    const checkout = await provider.createCheckout({
      merchOrderId: result.payment.reference, amount: Money.fromDecimal(result.payment.amount),
      description: 'Addis Ride — claim released seat', notifyUrl: process.env.TELEBIRR_NOTIFY_URL!, redirectUrl: process.env.TELEBIRR_REDIRECT_URL!,
    });
    return { ...result, checkout };
  },

  /** Called from settlePayment() when a seat-claim payment settles: pay out the original subscriber. */
  async onClaimPaymentSettled(seatClaimId: string) {
    const [claim] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, seatClaimId));
    if (!claim) return;
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    if (!release) return;
    const [originalPayment] = await db.select().from(schema.payments).where(eq(schema.payments.subscriptionId, release.subscriptionId));
    if (!originalPayment) return;
    await scheduleRefund(originalPayment.id, Money.fromDecimal(release.refundAmount), 'seat_claimed');
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_claimed', userId: release.riderId } });
  },
};
