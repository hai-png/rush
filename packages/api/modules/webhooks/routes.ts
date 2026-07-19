import { TypedHono } from '../../src/typed-hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '@addis/db';
import { getPaymentProvider } from '@addis/payments';
import { settlePayment, failPayment } from '../payment/service';
import { marketplaceService } from '../marketplace/service';

export const webhookRoutes = new TypedHono();

webhookRoutes.post('/telebirr/notify', async (c) => {
  const provider = getPaymentProvider('telebirr');
  const event = await provider.parseWebhook(c.req.raw);

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
        if (payment?.seatClaimId) await marketplaceService.onClaimPaymentSettled(payment.seatClaimId);
      }
    } else {
      await failPayment(event.merchOrderId, event.raw);
    }
  }
  return c.text('SUCCESS');
});
