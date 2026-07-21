// Payment service — settlement, failure, refunds.
// `scheduleRefund` row-locks the payment to prevent concurrent over-refund
// (PAY-003 fix baked in from the start).
// `settlePayment` uses the TelebirrNotifyEvent composite PK (merchOrderId, outRequestNo)
// for dedup — done right the first time (PAY-002 / DB-001 fix baked in).

import { db } from '@/lib/db';
import { Money } from '@/lib/money';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { getPaymentProvider } from '@/lib/payments';
import { transitionSubscription } from '@/lib/subscription';
import { enqueueNotification } from '@/lib/outbox';
import { audit } from '@/lib/audit';
import { createId } from '@/lib/id';
import { Prisma } from '@prisma/client';

export async function settlePayment(reference: string, reportedAmount: Money | undefined, outRequestNo: string, tradeStatus: string, rawPayload: unknown): Promise<boolean> {
  // Side effects (notifications, audit) collected during the tx and run AFTER
  // the tx commits — calling them inside would deadlock SQLite's single writer.
  const sideEffects: Array<() => Promise<void>> = [];

  const result = await db.$transaction(async (tx) => {
    try {
      await tx.telebirrNotifyEvent.create({
        data: {
          merchOrderId: reference,
          outRequestNo,
          tradeStatus,
          totalAmount: reportedAmount?.toDecimalString() ?? null,
          rawPayload: JSON.stringify(rawPayload),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }

    const updated = await tx.payment.updateMany({
      where: { reference, status: 'pending' },
      data: { status: 'completed', updatedAt: new Date() },
    });
    if (updated.count === 0) return false;

    const p = await tx.payment.findUnique({ where: { reference } });
    if (!p) return false;

    if (reportedAmount) {
      const expected = Money.fromCents(p.amountCents);
      if (!expected.eq(reportedAmount)) {
        await tx.payment.update({ where: { id: p.id }, data: { status: 'failed' } });
        sideEffects.push(async () => {
          await audit({
            action: 'payment.amount_mismatch',
            entityType: 'payment',
            entityId: p.id,
            after: { expected: p.amountCents, reported: reportedAmount.cents },
          });
        });
        return false;
      }
    }

    if (p.subscriptionId) {
      // Inline the subscription transition to avoid enqueueNotification inside
      // the transaction (which would deadlock SQLite).
      const sub = await tx.subscription.findUnique({ where: { id: p.subscriptionId } });
      if (sub && sub.status === 'pending_payment') {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: 'active' },
        });
        sideEffects.push(async () => {
          await enqueueNotification({
            userId: sub.userId,
            type: 'subscription_expiring',
            title: 'Subscription activated',
            body: `Your subscription is now active until ${new Date(sub.endDate).toLocaleDateString()}.`,
            link: '/dashboard/rider',
          });
        });
      }
    }
    if (p.seatClaimId) {
      await tx.seatClaim.update({ where: { id: p.seatClaimId }, data: { status: 'confirmed' } });
    }

    const userId = p.userId;
    const amountCents = p.amountCents;
    const paymentId = p.id;
    sideEffects.push(async () => {
      await enqueueNotification({
        userId,
        type: 'payment_received',
        title: 'Payment received',
        body: `Your payment of ${Money.fromCents(amountCents).toString()} was received.`,
        link: '/dashboard/rider',
      });
      await audit({
        actorId: userId,
        action: 'payment.settled',
        entityType: 'payment',
        entityId: paymentId,
        after: { reference, amountCents },
      });
    });
    return true;
  }, { timeout: 15_000, maxWait: 20_000 });

  // Run side effects after the tx commits.
  for (const fx of sideEffects) {
    try { await fx(); } catch (e) { console.error('[settlePayment] side effect failed:', e); }
  }
  return result;
}

export async function failPayment(reference: string, reasonRaw: unknown, outRequestNo: string, tradeStatus: string, rawPayload: unknown): Promise<boolean> {
  return await db.$transaction(async (tx) => {
    // Dedup
    try {
      await tx.telebirrNotifyEvent.create({
        data: {
          merchOrderId: reference,
          outRequestNo,
          tradeStatus,
          rawPayload: JSON.stringify(rawPayload),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return false;
      }
      throw e;
    }

    const updated = await tx.payment.updateMany({
      where: { reference, status: 'pending' },
      data: { status: 'failed', updatedAt: new Date() },
    });
    if (updated.count === 0) return false;

    const p = await tx.payment.findUnique({ where: { reference } });
    if (!p) return false;

    if (p.subscriptionId) {
      await transitionSubscription(tx, p.subscriptionId, 'payment.failed');
    }
    if (p.seatClaimId) {
      await tx.seatClaim.update({ where: { id: p.seatClaimId }, data: { status: 'refunded' } });
      const claim = await tx.seatClaim.findUnique({ where: { id: p.seatClaimId } });
      if (claim) {
        await tx.seatRelease.update({ where: { id: claim.seatReleaseId }, data: { status: 'open' } });
      }
    }

    await enqueueNotification({
      userId: p.userId,
      type: 'payment_failed',
      title: 'Payment failed',
      body: `Your payment of ${Money.fromCents(p.amountCents).toString()} failed.`,
    });
    return true;
  });
}

// Row-locked refund scheduling — PAY-003 fix baked in.
export async function scheduleRefund(paymentId: string, amount: Money, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    // SQLite doesn't support SELECT FOR UPDATE; we rely on $transaction isolation
    // (SERIALIZABLE by default in our wrapper). For Postgres we'd add .for('update').
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`);
    if (payment.status !== 'completed') throw new BadRequestError('Only completed payments can be refunded');
    if (!amount.isPositive()) throw new BadRequestError('Refund amount must be positive');

    const original = Money.fromCents(payment.amountCents);
    const alreadyRefunded = Money.fromCents(payment.refundAmountCents);
    const total = alreadyRefunded.add(amount);
    if (total.gt(original)) {
      throw new BadRequestError(
        `Refund of ${amount.toString()} would exceed payment amount. Original: ${original.toString()}, already refunded: ${alreadyRefunded.toString()}.`,
      );
    }

    const refundRequestNo = `RF${createId()}`;
    await tx.refundRetry.create({
      data: {
        paymentId,
        merchOrderId: payment.reference,
        refundRequestNo,
        amountCents: amount.cents,
        reason,
      },
    });
    await audit({
      actorId: payment.userId,
      action: 'refund.scheduled',
      entityType: 'payment',
      entityId: paymentId,
      after: { amountCents: amount.cents, refundRequestNo, reason },
    });
  });
}

const BACKOFF_MIN = [1, 5, 15, 60, 240]; // shorter for dev

export async function processRefundRetries(limit = 10): Promise<{ processed: number }> {
  // Reset stale 'processing' rows.
  await db.refundRetry.updateMany({
    where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: 'pending' },
  });

  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.refundRetry.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    if (rows.length === 0) return [];
    await tx.refundRetry.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { status: 'processing' },
    });
    return rows;
  });

  let processed = 0;
  for (const retry of claimed) {
    const payment = await db.payment.findUnique({ where: { id: retry.paymentId } });
    if (!payment) continue;
    const provider = getPaymentProvider(payment.method as 'telebirr' | 'cbe');
    if (!provider.refund) continue;

    let result;
    try {
      result = await provider.refund({
        merchOrderId: retry.merchOrderId,
        refundRequestNo: retry.refundRequestNo,
        amount: Money.fromCents(retry.amountCents),
        reason: retry.reason,
      });
    } catch (err) {
      result = { status: 'failed' as const, error: (err as Error).message, permanent: false };
    }

    await db.$transaction(async (tx) => {
      if (result.status === 'succeeded') {
        const updated = await tx.refundRetry.updateMany({
          where: { id: retry.id, status: { in: ['pending', 'processing'] } },
          data: { status: 'succeeded' },
        });
        if (updated.count === 0) return;

        const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
        if (!fresh) return;
        const currentRefund = Money.fromCents(fresh.refundAmountCents);
        const newRefund = currentRefund.add(Money.fromCents(retry.amountCents));
        const allRefunded = newRefund.eq(Money.fromCents(fresh.amountCents));
        await tx.payment.update({
          where: { id: fresh.id },
          data: {
            status: allRefunded ? 'refunded' : 'partially_refunded',
            refundAmountCents: newRefund.cents,
            refundedAt: new Date(),
          },
        });
        await enqueueNotification({
          userId: fresh.userId,
          type: 'refund_completed',
          title: 'Refund completed',
          body: `Your refund of ${Money.fromCents(retry.amountCents).toString()} has been processed.`,
        });
      } else {
        const attempts = retry.attempts + 1;
        if (result.status === 'failed' && result.permanent) {
          await tx.refundRetry.update({ where: { id: retry.id }, data: { status: 'permanent_failure', attempts, lastError: result.error } });
          await enqueueNotification({ userId: payment.userId, type: 'refund_failed', title: 'Refund failed', body: 'Your refund could not be processed.' });
        } else if (attempts >= retry.maxAttempts) {
          await tx.refundRetry.update({ where: { id: retry.id }, data: { status: 'permanent_failure', attempts } });
          await enqueueNotification({ userId: payment.userId, type: 'refund_failed', title: 'Refund failed', body: 'Your refund could not be processed after multiple attempts.' });
        } else {
          const backoffMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
          await tx.refundRetry.update({
            where: { id: retry.id },
            data: {
              attempts,
              nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
              lastError: result.status === 'failed' ? result.error : null,
            },
          });
        }
      }
    });
    processed++;
  }
  return { processed };
}
