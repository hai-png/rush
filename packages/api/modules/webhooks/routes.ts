import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new Hono();

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
      // 3.28 fix: settlePayment and onClaimPaymentSettled cannot run in the
      // same transaction because settlePayment opens its own internal
      // transaction. Instead, we:
      //   1. Call settlePayment (commits its own tx — payment → completed,
      //      subscription → active).
      //   2. If the payment has a seatClaimId, queue a `claim_settlement_pending`
      //      outbox event so the reconcile-claims cron can pick it up if
      //      onClaimPaymentSettled fails.
      //   3. Attempt onClaimPaymentSettled immediately (best-effort). If it
      //      succeeds, mark the outbox event as delivered. If it fails, the
      //      cron will retry.
      const settled = await settlePayment(event.merchOrderId, event.amount);
      if (settled) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
        if (payment?.seatClaimId) {
          // Queue a tracking outbox event so the reconcile-claims cron can
          // detect a failed onClaimPaymentSettled and retry.
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
            // Success — mark the tracking event as resolved.
            await db.insert(schema.outboxEvents).values({
              channel: 'audit',
              payload: {
                action: 'claim_settlement_completed',
                entityId: payment.seatClaimId,
                paymentId: payment.id,
              },
            });
          } catch (err) {
            // onClaimPaymentSettled failed — the reconcile-claims cron will
            // detect the pending settlement and retry. Log for visibility.
            console.error('[webhook] onClaimPaymentSettled failed — reconcile-claims cron will retry', {
              paymentId: payment.id,
              seatClaimId: payment.seatClaimId,
              err: (err as Error).message,
            });
          }
        }
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
    }
  }
  return c.text('SUCCESS');
});
