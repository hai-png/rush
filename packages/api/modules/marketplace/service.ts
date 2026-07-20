import { addHours } from 'date-fns';
import { and, eq, gt, desc, lte } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, ConflictError, BadRequestError, NotFoundError, proratedRideValue, PAYMENT_RETENTION_YEARS, loadEnv } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { createId } from '@paralleldrive/cuid2';
import { scheduleRefund } from '../payment/service';
import { subscriptionRepo } from '../subscription/repository';

const env = loadEnv();
const SEAT_RELEASE_TTL_HOURS = Number(process.env.SEAT_RELEASE_TTL_HOURS ?? 4);
function addYears(d: Date, years: number) { const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c; }
// FIX (PAY-011): use cuid2
function generateMerchOrderId() { return `CLM${createId()}`; }

export const marketplaceService = {
  async release(riderId: string, input: { subscriptionId: string; releaseDate: string; window: 'morning' | 'evening' }) {
    const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId));
    if (!sub || sub.riderId !== riderId) throw new NotFoundError('Subscription not found');
    if (sub.status !== 'active') throw new ConflictError('Subscription is not active');
    if (!sub.routeId) throw new BadRequestError('Subscription has no route');
    // H45 fix: timezone-safe date comparison. The previous implementation
    // compared `new Date(input.releaseDate)` (parsed as UTC midnight for
    // ISO date-only strings) with `new Date(new Date().toDateString())`
    // (local midnight) — on a server in UTC+3, a same-day-UTC release was
    // incorrectly rejected as past. Now both sides use UTC midnight.
    const releaseDateUTC = new Date(input.releaseDate + 'T00:00:00Z');
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    if (releaseDateUTC < todayUTC) throw new BadRequestError('Release date must be in the future');

    const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.id, sub.planId));
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, sub.routeId));
    if (!plan || !route) throw new NotFoundError('Plan or route not found');

    // FIX (API-002): Quota check + increment ridesUsed on release. Without this,
    // a rider could release ALL seats, get a full refund, and STILL take all rides.
    if (plan.ridesIncluded > 0) {
      const ridesLeft = plan.ridesIncluded - sub.ridesUsed;
      if (ridesLeft <= 0) {
        throw new BadRequestError('Subscription ride quota exhausted — no seats available to release');
      }
    }

    // FIX (PAY-005): use payment.amount (actual paid), not plan.priceETB (list).
    let refundAmount: Money;
    if (plan.ridesIncluded > 0) {
      const [payment] = await db.select().from(schema.payments)
        .where(and(eq(schema.payments.subscriptionId, sub.id), eq(schema.payments.status, 'completed')))
        .orderBy(desc(schema.payments.createdAt)).limit(1);
      if (payment) {
        refundAmount = Money.fromDecimal(payment.amount).div(plan.ridesIncluded);
      } else {
        refundAmount = proratedRideValue(Money.fromDecimal(plan.priceETB), plan.ridesIncluded, Money.fromDecimal(route.fare));
      }
    } else {
      refundAmount = proratedRideValue(Money.fromDecimal(plan.priceETB), plan.ridesIncluded, Money.fromDecimal(route.fare));
    }

    try {
      // FA-003: wrap release insert + incrementRidesUsed + outbox in one transaction.
      // Without this, if incrementRidesUsed fails after the release insert commits,
      // the rider gets the refund (via the claim flow) without losing the ride quota —
      // reopening the API-002 free-ride exploit.
      return await db.transaction(async (tx) => {
        const [release] = await tx.insert(schema.seatReleases).values({
          subscriptionId: sub.id, riderId, routeId: sub.routeId, window: input.window,
          releaseDate: input.releaseDate, refundAmount: refundAmount.toString(),
          expiresAt: addHours(new Date(`${input.releaseDate}T00:00:00Z`), 24 + SEAT_RELEASE_TTL_HOURS),
        }).returning();
        // FIX (API-002): consume the released ride's quota.
        await subscriptionRepo.incrementRidesUsed(tx, sub.id);
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_released', userId: riderId } });
        return release;
      });
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictError('Seat already released for this date/window'); // unique index violation
      throw e;
    }
  },

  async cancelRelease(riderId: string, releaseId: string) {
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, releaseId));
    if (!release || release.riderId !== riderId) throw new NotFoundError('Release not found');
    if (release.status !== 'open') throw new ConflictError('Release cannot be cancelled in its current state');
    await db.transaction(async (tx) => {
      await tx.update(schema.seatReleases).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(schema.seatReleases.id, releaseId));
      // FIX (API-002): restore the rider's quota consumed at release time.
      if (release.subscriptionId) {
        await subscriptionRepo.decrementRidesUsed(tx, release.subscriptionId);
      }
    });
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
    try {
      const checkout = await provider.createCheckout({
        merchOrderId: result.payment.reference, amount: Money.fromDecimal(result.payment.amount),
        description: 'Addis Ride — claim released seat', notifyUrl: env.TELEBIRR_NOTIFY_URL, redirectUrl: env.TELEBIRR_REDIRECT_URL,
      });
      return { ...result, checkout };
    } catch (err) {
      // The DB transaction above already committed: the release is 'claimed' and a pending
      // payment/claim exist. If the checkout call to the provider then fails (network error,
      // provider outage, etc.), the seat would otherwise be stuck 'claimed' forever with no
      // way for the claimer to actually pay for it, and no way for anyone else to claim it
      // either. Reverting here gives the release back to the open pool and marks the
      // claim/payment as failed so a retry (a fresh claim() call) can proceed cleanly.
      await db.transaction(async (tx) => {
        await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, result.release.id));
        await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() }).where(eq(schema.seatClaims.id, result.claim.id));
        await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, result.payment.id));
      });
      throw err;
    }
  },

  /** Called from settlePayment() when a seat-claim payment settles: pay out the original subscriber.
   *
   *  H46 fix: the original implementation selected "most recent completed payment" with no
   *  upper bound on createdAt — a renewal made AFTER the release would be picked as the
   *  refund target, refunding the wrong charge. Now we filter to payments created at or
   *  before the release's createdAt, so the refund targets the payment that was actually
   *  active when the seat was released. */
  async onClaimPaymentSettled(seatClaimId: string) {
    const [claim] = await db.select().from(schema.seatClaims).where(eq(schema.seatClaims.id, seatClaimId));
    if (!claim) return;
    const [release] = await db.select().from(schema.seatReleases).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    if (!release) return;
    // FIX (META-003): Idempotency check. This method is called from both the
    // webhook handler (webhooks/routes.ts) and the reconcile-claims cron. If
    // both fire (or the cron runs twice), we must not schedule duplicate
    // refunds. Check for an existing refund_retry with reason='seat_claimed'
    // for the original payment before proceeding.
    const [originalPayment] = await db.select().from(schema.payments)
      .where(and(
        eq(schema.payments.subscriptionId, release.subscriptionId),
        eq(schema.payments.status, 'completed'),
        lte(schema.payments.createdAt, release.createdAt),
      ))
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    if (!originalPayment) return;
    // Check if a refund was already scheduled for this payment + reason.
    const [existingRefund] = await db.select().from(schema.refundRetries)
      .where(and(
        eq(schema.refundRetries.paymentId, originalPayment.id),
        eq(schema.refundRetries.reason, 'seat_claimed'),
      ))
      .limit(1);
    if (existingRefund) return; // already scheduled — idempotent no-op
    await scheduleRefund(originalPayment.id, Money.fromDecimal(release.refundAmount), 'seat_claimed');
    await db.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'seat_claimed', userId: release.riderId } });
  },
};
