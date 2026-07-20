import { TypedOpenAPIHono } from '../../src/typed-hono';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new TypedOpenAPIHono();

webhookRoutes.post('/telebirr/notify', async (c) => {
  const provider = getPaymentProvider('telebirr');
  let event;
  try {
    event = await provider.parseWebhook(c.req.raw);
  } catch (err) {
    // parseWebhook throws on invalid signature or stale timestamp. Return
    // 401 so Telebirr doesn't retry — a replayed or forged notification
    // should not trigger retries. The previous implementation let the throw
    // propagate to the error handler, which returned 500 (triggering
    // Telebirr retries on a bad signature — exactly what the attacker wants).
    c.get('logger')?.warn({ err: (err as Error).message }, 'telebirr webhook parse/signature failure');
    return c.text('BAD_SIGNATURE', 401);
  }

  // Signature verification is the single most important security control on a
  // payment webhook: without it, any attacker who can guess/enumerate a
  // merchOrderId can settle their own pending payment by POSTing a forged
  // notification. The previous implementation trusted provider.parseWebhook
  // to verify, but never asserted that it did. Now we refuse to act on any
  // event that the provider hasn't explicitly marked signature-valid.
  if (event.signatureValid !== true) {
    return c.text('INVALID_SIGNATURE', 401);
  }

  if (event.type === 'payment.settled' || event.type === 'payment.failed') {
    // FOLLOW-UP 2 (PAY-002): composite PK on (merchOrderId, outRequestNo, receivedAt)
    // means each distinct Telebirr notification is recorded — no more dropped
    // supplementary notifications. The handler then applies a state-machine
    // override: if the new event is more authoritative than the current payment
    // status, transition the payment; otherwise it's a stale duplicate, no-op.
    const outRequestNo = (event as any).outRequestNo ?? `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const receivedAt = new Date();
    try {
      await db.insert(schema.telebirrNotifyEvents)
        .values({ merchOrderId: event.merchOrderId, tradeStatus: event.type, outRequestNo, receivedAt });
    } catch (err: any) {
      // Composite PK conflict means we already recorded this exact notification
      // (same merchOrderId + outRequestNo + receivedAt) — true duplicate, no-op.
      if (err.code === '23505') return c.text('SUCCESS');
      throw err;
    }

    // Read the current payment state to decide if the new event overrides it.
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
    if (!payment) {
      // No payment for this merchOrderId — log and ack so Telebirr doesn't retry.
      c.get('logger')?.warn({ merchOrderId: event.merchOrderId }, 'webhook: notification for unknown payment reference');
      return c.text('SUCCESS');
    }

    // FOLLOW-UP 2: state-machine override. 'payment.settled' is authoritative
    // over 'pending' AND 'failed' (a late settlement after a timeout-failure
    // must recover the payment). 'payment.failed' only applies if the payment
    // is still 'pending' — a 'failed' after 'completed' is a chargeback and
    // is handled separately (not by re-failing the payment).
    if (event.type === 'payment.settled') {
      if (payment.status === 'pending') {
        const settled = await settlePayment(event.merchOrderId, event.amount);
        if (settled && payment.seatClaimId) {
          await db.insert(schema.outboxEvents).values({
            channel: 'audit',
            payload: { action: 'claim_settlement_pending', entityId: payment.seatClaimId, paymentId: payment.id },
          });
          try {
            await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
            await db.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: { action: 'claim_settlement_completed', entityId: payment.seatClaimId, paymentId: payment.id },
            });
          } catch (err) {
            c.get('logger')?.error(
              { paymentId: payment.id, seatClaimId: payment.seatClaimId, err },
              'onClaimPaymentSettled failed — reconcile-claims cron will retry',
            );
          }
        }
      } else if (payment.status === 'failed') {
        // FOLLOW-UP 2: late settlement recovering a timed-out payment.
        // settlePayment's CAS `WHERE status='pending'` won't match (status is 'failed'),
        // so we need to explicitly re-open the payment to 'pending' first, then settle.
        // This is the recovery path for the PAY-002 race.
        // FA-002: check the CAS UPDATE actually matched; if 0 rows updated, a concurrent
        // webhook already moved the payment (e.g. to 'pending' or 'completed'), so skip
        // the settlePayment call — it would either no-op (pending -> completed via CAS)
        // or fail (completed -> can't re-settle).
        const reopened = await db.update(schema.payments)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, 'failed')))
          .returning({ id: schema.payments.id });
        if (reopened.length === 0) {
          // Concurrent webhook already transitioned the payment — log and ack.
          await db.insert(schema.outboxEvents).values({
            channel: 'audit',
            payload: { action: 'payment.reopen_skipped_concurrent', entityId: payment.id, currentStatus: payment.status },
          });
          return c.text('SUCCESS');
        }
        await db.insert(schema.outboxEvents).values({
          channel: 'audit',
          payload: { action: 'payment.reopened_from_failed', entityId: payment.id, reason: 'late_settlement_notification' },
        });
        const settled = await settlePayment(event.merchOrderId, event.amount);
        if (settled) {
          await db.insert(schema.outboxEvents).values({
            channel: 'audit',
            payload: { action: 'payment.recovered_late_settlement', entityId: payment.id },
          });
        }
      }
      // If payment.status is 'completed' / 'refunded' / 'partially_refunded', this
      // is a duplicate settlement notification — no-op.
    } else { // event.type === 'payment.failed'
      if (payment.status === 'pending') {
        await failPayment(event.merchOrderId, event.raw);
      }
      // If payment.status is 'completed', this is a chargeback — handled
      // separately via the refund.succeeded path, not by re-failing the payment.
    }
    return c.text('SUCCESS');
  }

  // FIX (API-011): The previous implementation only branched on `payment.settled`
  // and `payment.failed`. The provider's parseWebhook CAN produce
  // `refund.succeeded` and `refund.failed` events (when the inbound payload
  // contains a `refund_request_no`), but those fell through to the final
  // `return c.text('SUCCESS')` without being handled. The provider believed
  // we acknowledged; we did nothing. The refund_retries row stayed
  // 'processing' forever (until the 15-min process-refund-retries cron
  // polled verifyPayment). Now we update the refund_retries row directly
  // from the webhook event.
  if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
    if (!event.refundRequestNo) return c.text('SUCCESS');
    const newStatus = event.type === 'refund.succeeded' ? 'succeeded' : 'permanent_failure';
    // FIX (META-004): Only update if the row is still in a pre-terminal state
    // ('pending' or 'processing'). Without this guard, a duplicate webhook
    // (or a webhook arriving after the process-refund-retries cron already
    // marked the row 'succeeded') would match the UPDATE, return the row,
    // and accumulate refundAmount on the payment AGAIN — double-crediting.
    const updated = await db.update(schema.refundRetries)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(and(
        eq(schema.refundRetries.refundRequestNo, event.refundRequestNo),
        inArray(schema.refundRetries.status, ['pending', 'processing'] as any),
      ))
      .returning();
    if (updated.length === 0) {
      // Unknown refund — could be a webhook for a refund initiated elsewhere.
      // Acknowledge so Telebirr doesn't retry, but log for visibility.
      c.get('logger')?.warn(
        { refundRequestNo: event.refundRequestNo, type: event.type },
        'webhook: refund event for unknown refund_request_no',
      );
      return c.text('SUCCESS');
    }
    const retry = updated[0];
    if (event.type === 'refund.succeeded') {
      // FIX (DB-006): wrap in one transaction with SELECT FOR UPDATE.
      const { Money } = await import('@addis/shared');
      await db.transaction(async (tx) => {
        const [payment] = await tx.select().from(schema.payments)
          .where(eq(schema.payments.id, retry.paymentId)).for('update');
        if (!payment) return;
        const currentRefundAmount = payment.refundAmount ? Money.fromDecimal(payment.refundAmount) : Money.ZERO;
        const newRefundAmount = currentRefundAmount.add(Money.fromDecimal(retry.amount));
        const allRefunded = newRefundAmount.eq(Money.fromDecimal(payment.amount));
        await tx.update(schema.payments).set({
          status: allRefunded ? 'refunded' : 'partially_refunded',
          refundAmount: newRefundAmount.toString(),
          refundedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.payments.id, payment.id));
        await tx.insert(schema.outboxEvents).values({
          channel: 'notification',
          payload: { type: 'refund_completed', userId: payment.riderId },
        });
      });
    } else {
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, retry.paymentId));
      if (payment) {
        await db.insert(schema.outboxEvents).values({
          channel: 'notification',
          payload: { type: 'refund_failed', userId: payment.riderId },
        });
      }
    }
    return c.text('SUCCESS');
  }

  // Unknown event type — acknowledge so Telebirr doesn't retry, but log.
  c.get('logger')?.warn({ type: (event as any).type }, 'webhook: unknown telebirr event type');
  return c.text('SUCCESS');
});
