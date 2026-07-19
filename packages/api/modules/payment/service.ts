import { and, eq, lte } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { transitionSubscription } from '../subscription/state';

/** Idempotent: returns false if the payment was already settled/failed (webhook replay safe).
 *  `reportedAmount`, when supplied by the caller, is the amount the payment provider's webhook
 *  is confirming was actually paid — this MUST match what we expected for the payment before
 *  any subscription/seat benefit is granted. Settling purely because the provider said
 *  "success", without checking the amount, would let an underpayment (or a malformed/forged
 *  event that somehow got past signature verification) unlock the full benefit anyway. */
export async function settlePayment(reference: string, reportedAmount?: Money): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(schema.payments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(schema.payments.reference, reference), eq(schema.payments.status, 'pending')))
      .returning();
    if (updated.length === 0) return false;
    // updated.length > 0 guarantees updated[0] is defined.
    const p = updated[0]!;

    if (reportedAmount && !reportedAmount.eq(Money.fromDecimal(p.amount))) {
      await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, p.id));
      await tx.insert(schema.outboxEvents).values({
        channel: 'audit',
        payload: { action: 'payment.amount_mismatch', entityId: p.id, expectedAmount: p.amount, reportedAmount: reportedAmount.toString() },
      });
      return false;
    }

    if (p.subscriptionId) {
      await transitionSubscription(tx, p.subscriptionId, 'payment.settled');
    }
    if (p.seatClaimId) {
      await tx.update(schema.seatClaims).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(schema.seatClaims.id, p.seatClaimId));
    }

    await tx.insert(schema.outboxEvents).values([
      { channel: 'notification', payload: { type: 'payment_received', userId: p.riderId, amount: p.amount } },
      { channel: 'audit', payload: { action: 'payment.settled', entityId: p.id } },
    ]);
    return true;
  });
}

export async function failPayment(reference: string, reasonRaw: unknown): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(schema.payments)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(schema.payments.reference, reference), eq(schema.payments.status, 'pending')))
      .returning();
    if (updated.length === 0) return false;
    const p = updated[0]!;
    if (p.subscriptionId) await transitionSubscription(tx, p.subscriptionId, 'payment.failed');
    if (p.seatClaimId) {
      // claimer payment failed -> claim cancelled -> seat reopens for others
      const [claim] = await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(schema.seatClaims.id, p.seatClaimId)).returning();
      if (claim) await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    }
    await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'payment_failed', userId: p.riderId, raw: reasonRaw } });
    return true;
  });
}

/** Queue a refund; retried by process-refund-retries cron with exponential backoff. */
export async function scheduleRefund(paymentId: string, amount: Money, reason: string, tx: import('@addis/db').DbOrTx = db) {
  const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) throw new Error(`Payment ${paymentId} not found`);
  const refundRequestNo = `RF${paymentId}${Date.now()}`;
  await tx.insert(schema.refundRetries).values({
    paymentId, merchOrderId: payment.reference, refundRequestNo, amount: amount.toString(), reason,
  });
}

const BACKOFF_MIN = [15, 30, 60, 120, 240];

export async function processRefundRetries(limit = 50) {
  const due = await db.select().from(schema.refundRetries)
    .where(and(eq(schema.refundRetries.status, 'pending'), lte(schema.refundRetries.nextAttemptAt, new Date())))
    .limit(limit);

  for (const retry of due) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, retry.paymentId));
    if (!payment) continue;
    const provider = getPaymentProvider(payment.method);
    const result = await provider.refund({
      merchOrderId: retry.merchOrderId, refundRequestNo: retry.refundRequestNo,
      amount: Money.fromDecimal(retry.amount), reason: retry.reason,
    });

    await db.transaction(async (tx) => {
      if (result.status === 'succeeded') {
        await tx.update(schema.refundRetries).set({ status: 'succeeded', updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
        await tx.update(schema.payments).set({
          status: 'refunded', refundAmount: retry.amount, refundedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.payments.id, payment.id));
        if (payment.subscriptionId) {
          const { subscriptionRepo } = await import('../subscription/repository');
          await subscriptionRepo.decrementRidesUsed(tx, payment.subscriptionId);
        }
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_completed', userId: payment.riderId } });
      } else {
        const attempts = retry.attempts + 1;
        if (result.status === 'failed' && result.permanent) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, lastError: result.error, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
        } else if (attempts >= retry.maxAttempts) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
        } else {
          const backoffMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 15;
          await tx.update(schema.refundRetries).set({
            attempts, nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
            lastError: result.status === 'failed' ? result.error : null, updatedAt: new Date(),
          }).where(eq(schema.refundRetries.id, retry.id));
        }
      }
    });
  }
  return { processed: due.length };
}
