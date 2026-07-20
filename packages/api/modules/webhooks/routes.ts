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

    c.get('logger')?.warn({ err: (err as Error).message }, 'telebirr webhook parse/signature failure');
    return c.text('BAD_SIGNATURE', 401);
  }

  if (event.signatureValid !== true) {
    return c.text('INVALID_SIGNATURE', 401);
  }

  if (event.type === 'payment.settled' || event.type === 'payment.failed') {

    const outRequestNo = (event as any).outRequestNo ?? `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await db.insert(schema.telebirrNotifyEvents)
        .values({ merchOrderId: event.merchOrderId, tradeStatus: event.type, outRequestNo });
    } catch (err: any) {
      if (err.code === '23505') return c.text('SUCCESS');
      throw err;
    }

    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, event.merchOrderId));
    if (!payment) {

      c.get('logger')?.warn({ merchOrderId: event.merchOrderId }, 'webhook: notification for unknown payment reference');
      return c.text('SUCCESS');
    }

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

        const reopened = await db.update(schema.payments)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, 'failed')))
          .returning({ id: schema.payments.id });
        if (reopened.length === 0) {

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

    } else {
      if (payment.status === 'pending') {
        await failPayment(event.merchOrderId, event.raw);
      }

    }
    return c.text('SUCCESS');
  }

  if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
    if (!event.refundRequestNo) return c.text('SUCCESS');
    const newStatus = event.type === 'refund.succeeded' ? 'succeeded' : 'permanent_failure';

    const updated = await db.update(schema.refundRetries)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(and(
        eq(schema.refundRetries.refundRequestNo, event.refundRequestNo),
        inArray(schema.refundRetries.status, ['pending', 'processing'] as any),
      ))
      .returning();
    if (updated.length === 0) {

      c.get('logger')?.warn(
        { refundRequestNo: event.refundRequestNo, type: event.type },
        'webhook: refund event for unknown refund_request_no',
      );
      return c.text('SUCCESS');
    }
    const retry = updated[0];
    if (event.type === 'refund.succeeded') {

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

  c.get('logger')?.warn({ type: (event as any).type }, 'webhook: unknown telebirr event type');
  return c.text('SUCCESS');
});
