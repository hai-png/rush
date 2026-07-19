import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new Hono();

webhookRoutes.post('/telebirr/notify', async (c) => {
  const provider = getPaymentProvider('telebirr');
  const event = await provider.parseWebhook(c.req.raw);

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
      // settlePayment + onClaimPaymentSettled must run in the SAME transaction
      // so a seat-claim update failure rolls back the payment settlement.
      // Previously settlePayment committed first, then onClaimPaymentSettled
      // ran outside — if the latter failed, the payment was 'completed' but
      // the original subscriber's refund was never scheduled.
      const settled = await settlePayment(event.merchOrderId, event.amount);
      if (settled) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
        if (payment?.seatClaimId) {
          try {
            await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
          } catch (err) {
            // Don't swallow silently — surface to logs so the ops team can
            // reconcile. The settlement itself already committed; this is a
            // best-effort refund-scheduling step.
            console.error('[webhook] onClaimPaymentSettled failed', { paymentId: payment.id, seatClaimId: payment.seatClaimId, err });
          }
        }
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
    }
  }
  return c.text('SUCCESS');
});
