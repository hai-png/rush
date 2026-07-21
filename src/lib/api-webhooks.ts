// Webhooks — Telebirr payment notifications.
// settles or fails the payment.
import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/payments';
import { settlePayment, failPayment } from '@/lib/payment-service';
import { toErrorEnvelope } from '@/lib/errors';
import { logger } from '@/lib/logger';

export async function POST_telebirr_notify(ctx: any) {
  const requestId = ctx.requestId;
  try {
    const provider = getPaymentProvider('telebirr');
    if (!provider.parseWebhook) {
      return NextResponse.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Provider does not support webhooks', requestId } }, { status: 501 });
    }

    // The api() middleware already parsed the JSON body into ctx.body.
    // web Request per the provider interface).
    const rawBody = JSON.stringify(ctx.body ?? {});
    const syntheticReq = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    const event = await provider.parseWebhook(syntheticReq);

    if (!event.signatureValid) {
      logger.warn({ type: event.type }, '[telebirr-webhook] invalid signature — rejecting');
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid signature', requestId } }, { status: 401 });
    }

    const outRequestNo = (event as any).raw?.out_request_no ?? (event as any).raw?.outRequestNo ?? 'unknown';
    const raw = (event as any).raw;
    const tradeStatus = (event as any).raw?.trade_status ?? 'unknown';

    if (event.type === 'payment.settled') {
      await settlePayment(event.merchOrderId, event.amount, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'payment.failed') {
      await failPayment(event.merchOrderId, raw, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'refund.succeeded') {
      logger.info({ refundRequestNo: event.refundRequestNo }, '[telebirr-webhook] refund succeeded');
    } else if (event.type === 'refund.failed') {
      logger.warn({ refundRequestNo: event.refundRequestNo }, '[telebirr-webhook] refund failed');
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}
