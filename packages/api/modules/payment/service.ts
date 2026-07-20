import { and, eq, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { Money, BadRequestError, NotFoundError } from '@addis/shared';
import { getPaymentProvider } from '@addis/payments';
import { transitionSubscription } from '../subscription/state';
import { createId } from '@paralleldrive/cuid2';
import { paymentCounter, refundCounter } from '../health/metrics';

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
    const p = updated[0];

    // Amount verification: when reportedAmount is supplied, the payment is
    // failed on mismatch. When it is NOT supplied, we log an audit warning —
    // the settlement proceeds (the caller may be the reconcile-payments cron
    // that verified the payment externally) but the gap is recorded so
    // operators can spot callers that forget to pass the verified amount.
    // The previous implementation silently skipped the check with no audit
    // trail, making the gap invisible.
    if (reportedAmount) {
      const expected = Money.fromDecimal(p.amount);
      if (!expected.eq(reportedAmount)) {
        await tx.update(schema.payments).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.payments.id, p.id));
        await tx.insert(schema.outboxEvents).values({
          channel: 'audit',
          payload: { action: 'payment.amount_mismatch', entityId: p.id, expectedAmount: p.amount, reportedAmount: reportedAmount.toString() },
        });
        return false;
      }
    } else {
      // No amount assertion — record for audit visibility so operators can
      // spot callers that bypass the amount check.
      await tx.insert(schema.outboxEvents).values({
        channel: 'audit',
        payload: { action: 'payment.settled_without_amount_verification', entityId: p.id, reference },
      });
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
    // FIX (META-011): Observe the payment counter so /metrics reports real data.
    paymentCounter.labels('completed', p.method).inc();
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
    const p = updated[0];
    if (p.subscriptionId) await transitionSubscription(tx, p.subscriptionId, 'payment.failed');
    if (p.seatClaimId) {
      // claimer payment failed -> claim cancelled -> seat reopens for others
      const [claim] = await tx.update(schema.seatClaims).set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(schema.seatClaims.id, p.seatClaimId)).returning();
      if (claim) await tx.update(schema.seatReleases).set({ status: 'open', updatedAt: new Date() }).where(eq(schema.seatReleases.id, claim.seatReleaseId));
    }
    await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'payment_failed', userId: p.riderId, raw: reasonRaw } });
    paymentCounter.labels('failed', p.method).inc();
    return true;
  });
}

/**
 * Queue a refund.
 *
 * Previously this had no validation at all — an admin could queue a refund of
 * ETB 1,000,000 on a ETB 100 payment. Now we validate:
 *   1. The payment is in a refundable state ('completed').
 *   2. The refund amount is positive.
 *   3. The cumulative refunded amount (existing refundAmount + new amount)
 *      does not exceed the original payment amount.
 */
export async function scheduleRefund(paymentId: string, amount: Money, reason: string, tx: import('@addis/db').DbOrTx = db) {
  const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
  if (payment.status !== 'completed') throw new BadRequestError('Only completed payments can be refunded');
  if (!amount.isPositive()) throw new BadRequestError('Refund amount must be positive');

  const originalAmount = Money.fromDecimal(payment.amount);
  const alreadyRefunded = payment.refundAmount ? Money.fromDecimal(payment.refundAmount) : Money.ZERO;
  const totalAfterRefund = alreadyRefunded.add(amount);
  if (totalAfterRefund.gt(originalAmount)) {
    throw new BadRequestError(
      `Refund of ${amount.toString()} would exceed payment amount. ` +
      `Original: ${originalAmount.toString()}, already refunded: ${alreadyRefunded.toString()}.`
    );
  }

  // Use cuid2 instead of Date.now() + Math.random() — the previous format
  // (`RF${paymentId}${Date.now()}`) was predictable and could collide under
  // concurrency in the same millisecond.
  const refundRequestNo = `RF${createId()}`;
  await tx.insert(schema.refundRetries).values({
    paymentId, merchOrderId: payment.reference, refundRequestNo, amount: amount.toString(), reason,
  });
}

const BACKOFF_MIN = [15, 30, 60, 120, 240];

/**
 * Process due refund retries.
 *
 * The previous implementation had three serious bugs:
 *   1. No row lock — two cron instances could pick up the same refund row
 *      and both call provider.refund(), double-refunding the customer.
 *   2. refundAmount overwrite: `set({ refundAmount: retry.amount })` overwrote
 *      the existing refundAmount instead of accumulating. A second refund on
 *      the same payment erased the record of the first.
 *   3. provider.refund() ran OUTSIDE the transaction — if it succeeded but
 *      the DB transaction failed, the refund was issued but the row stayed
 *      'pending', triggering another refund on the next cron tick.
 *
 * Now we use SELECT FOR UPDATE SKIP LOCKED to claim rows atomically, run the
 * provider call BEFORE the transaction (so a provider failure doesn't hold
 * a DB row lock), and ACCUMULATE refundAmount rather than overwriting.
 */
export async function processRefundRetries(limit = 50) {
  // FIX (PAY-010): Re-queue rows stuck in 'processing' (worker crash mid-flight).
  await db.execute(sql`
    UPDATE refund_retries SET status = 'pending', updated_at = now()
    WHERE status = 'processing' AND updated_at < now() - interval '15 minutes'
  `);

  // Claim rows with SELECT FOR UPDATE SKIP LOCKED so concurrent workers
  // don't double-process the same refund.
  const claimed = await db.execute(sql`
    UPDATE refund_retries SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM refund_retries
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = (claimed as any).rows ?? (claimed as any);
  let processed = 0;

  for (const retry of rows) {
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, retry.paymentId));
    if (!payment) continue;
    const provider = getPaymentProvider(payment.method);

    // Run the provider call OUTSIDE the transaction.
    let result;
    try {
      result = await provider.refund({
        merchOrderId: retry.merchOrderId, refundRequestNo: retry.refundRequestNo,
        amount: Money.fromDecimal(retry.amount), reason: retry.reason,
      });
    } catch (err) {
      result = { status: 'failed' as const, error: (err as Error).message, permanent: false };
    }

    await db.transaction(async (tx) => {
      if (result.status === 'succeeded') {
        // FIX (PAY-001): CAS update with status filter — skip if webhook already processed.
        const updatedRetry = await tx.update(schema.refundRetries)
          .set({ status: 'succeeded', updatedAt: new Date() })
          .where(and(
            eq(schema.refundRetries.id, retry.id),
            inArray(schema.refundRetries.status, ['pending', 'processing']),
          ))
          .returning();
        if (updatedRetry.length === 0) return; // webhook already processed
        // FIX (PAY-001): Re-read payment inside tx with FOR UPDATE.
        const [freshPayment] = await tx.select().from(schema.payments)
          .where(eq(schema.payments.id, payment.id)).for('update');
        if (!freshPayment) return;
        const currentRefundAmount = freshPayment.refundAmount ? Money.fromDecimal(freshPayment.refundAmount) : Money.ZERO;
        const newRefundAmount = currentRefundAmount.add(Money.fromDecimal(retry.amount));
        const allRefunded = newRefundAmount.eq(Money.fromDecimal(freshPayment.amount));
        await tx.update(schema.payments).set({
          status: allRefunded ? 'refunded' : 'partially_refunded',
          refundAmount: newRefundAmount.toString(),
          refundedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.payments.id, freshPayment.id));
        // FIX (PAY-009): Do NOT call decrementRidesUsed — refunds must not
        // restore ride quota (the released ride's quota was already consumed
        // at marketplace.release time per API-002 fix).
        await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_completed', userId: freshPayment.riderId } });
        refundCounter.labels('succeeded').inc();
      } else {
        const attempts = retry.attempts + 1;
        if (result.status === 'failed' && result.permanent) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, lastError: result.error, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
          refundCounter.labels('permanent_failure').inc();
        } else if (attempts >= retry.maxAttempts) {
          await tx.update(schema.refundRetries).set({ status: 'permanent_failure', attempts, updatedAt: new Date() }).where(eq(schema.refundRetries.id, retry.id));
          await tx.insert(schema.outboxEvents).values({ channel: 'notification', payload: { type: 'refund_failed', userId: payment.riderId } });
          refundCounter.labels('permanent_failure').inc();
        } else {
          const backoffMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
          await tx.update(schema.refundRetries).set({
            attempts, nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
            lastError: result.status === 'failed' ? result.error : null, updatedAt: new Date(),
          }).where(eq(schema.refundRetries.id, retry.id));
        }
      }
    });
    processed++;
  }
  return { processed };
}
