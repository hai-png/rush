import { TypedHono } from '../../src/typed-hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new TypedHono();

webhookRoutes.post('/telebirr/notify', async (c) => {
  const provider = getPaymentProvider('telebirr');

  // parseWebhook verifies the RSA signature; a signature failure or malformed
  // payload throws. We must return 400 (not 500) so Telebirr doesn't retry the
  // webhook indefinitely — and we must NOT return 'SUCCESS' for a bad signature,
  // otherwise an attacker could forge webhooks. Log the error via the request
  // logger and return 400.
  let event;
  try {
    event = await provider.parseWebhook(c.req.raw);
  } catch (err) {
    c.get('logger')?.warn({ err }, 'telebirr webhook signature/parse failure');
    return c.text('BAD_SIGNATURE', 400);
  }

  if (event.type === 'payment.settled' || event.type === 'payment.failed') {
    // replay protection — merchOrderId is the primary key, so duplicate webhook
    // deliveries are no-ops.
    const inserted = await db.insert(schema.telebirrNotifyEvents)
      .values({ merchOrderId: event.merchOrderId, tradeStatus: event.type })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return c.text('SUCCESS'); // already processed

    if (event.type === 'payment.settled') {
      const settled = await settlePayment(event.merchOrderId, event.amount);
      if (settled) {
        const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
        if (payment?.seatClaimId) await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
    }
  }
  return c.text('SUCCESS');
});
