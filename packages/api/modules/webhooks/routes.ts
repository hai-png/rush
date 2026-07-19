// FIX (ARCH-003): Migrated from bare `Hono()` to `TypedOpenAPIHono` so this
// module is OpenAPI-capable and `c.get('session')` / `c.get('requestId')` /
// `c.get('logger')` are typed. Existing .post/.get/.patch/.delete calls
// continue to work; they can be incrementally converted to
// .openapi(createRoute(...), handler) to appear in the OpenAPI document.
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
    // replay protection
    const inserted = await db.insert(schema.telebirrNotifyEvents)
      .values({ merchOrderId: event.merchOrderId, tradeStatus: event.type })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return c.text('SUCCESS'); // already processed

    if (event.type === 'payment.settled') {
      const settled = await settlePayment(event.merchOrderId, event.amount);
      if (settled) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
        if (payment?.seatClaimId) {
          await db.insert(schema.outboxEvents).values({
            channel: 'audit',
            payload: {
              action: 'claim_settlement_pending',
              entityId: payment.seatClaimId,
              paymentId: payment.id,
            },
          });
          try {
            await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
            await db.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: {
                action: 'claim_settlement_completed',
                entityId: payment.seatClaimId,
                paymentId: payment.id,
              },
            });
          } catch (err) {
            // FIX (API-012): use the structured logger, not console.error.
            c.get('logger')?.error(
              { paymentId: payment.id, seatClaimId: payment.seatClaimId, err },
              'onClaimPaymentSettled failed — reconcile-claims cron will retry',
            );
          }
        }
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
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
      // Accumulate refundAmount on the payment row, mirroring the logic in
      // processRefundRetries. The previous implementation had a bug where
      // refundAmount was overwritten instead of accumulated — we preserve
      // the fix here.
      const { Money } = await import('@addis/shared');
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, retry.paymentId));
      if (payment) {
        const currentRefundAmount = payment.refundAmount ? Money.fromDecimal(payment.refundAmount) : Money.ZERO;
        const newRefundAmount = currentRefundAmount.add(Money.fromDecimal(retry.amount));
        const allRefunded = newRefundAmount.eq(Money.fromDecimal(payment.amount));
        await db.update(schema.payments).set({
          status: allRefunded ? 'refunded' : 'partially_refunded',
          refundAmount: newRefundAmount.toString(),
          refundedAt: new Date(), updatedAt: new Date(),
        }).where(eq(schema.payments.id, payment.id));
        await db.insert(schema.outboxEvents).values({
          channel: 'notification',
          payload: { type: 'refund_completed', userId: payment.riderId },
        });
      }
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
