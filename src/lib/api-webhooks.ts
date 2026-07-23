import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments';
import { settlePayment, failPayment } from '@/lib/payment-service';
import { toErrorEnvelope } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';

// BIZ-070 (#19): money formatter for ETB amounts in user-facing notifications.
// The frontend agent creates @/lib/format.ts with `formatETB(cents) -> string`.
// We import it lazily so the build doesn't break before that file exists,
// and fall back to an inline formatter on failure.
async function formatETB(cents: number): Promise<string> {
  try {
    const mod = await import('@/lib/format');
    if (typeof (mod as any).formatETB === 'function') {
      return (mod as any).formatETB(cents);
    }
  } catch {
    // fall through to inline
  }
  // TODO: remove this fallback once src/lib/format.ts is committed by the
  // frontend agent.
  return `${(cents / 100).toFixed(2)} ETB`;
}

// SEC-20: Telebirr webhook security currently relies solely on signature
// verification. A defence-in-depth IP allowlist (Telebirr's documented egress
// ranges) should be added before production — implement by populating
// env.TELEBIRR_WEBHOOK_IPS (comma-separated CIDRs) and rejecting requests
// whose real client IP (per clientIp() in api.ts) is not in the list.
// Tracked as future work pending confirmation of Telebirr's published CIDRs.

export async function handleTelebirrNotify(req: NextRequest, _session: any, _params: any, ctx: { requestId: string }): Promise<NextResponse> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const provider = getPaymentProvider('telebirr');
    if (!provider.parseWebhook) {
      return NextResponse.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Provider does not support webhooks', requestId } }, { status: 501 });
    }

    // the signature against the raw body + headers. Re-serialising ctx.body
    // would mangle field ordering and break real Telebirr signatures.
    const event = await provider.parseWebhook(req as unknown as Request);

    if (!event.signatureValid) {
      logger.warn({ type: event.type }, '[telebirr-webhook] invalid signature — rejecting');
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid signature', requestId } }, { status: 401 });
    }

    const outRequestNo = (event as any).outRequestNo ?? (event as any).raw?.out_request_no ?? 'unknown';
    const raw = (event as any).raw;
    const tradeStatus = (event as any).raw?.trade_status ?? 'unknown';

    if (event.type === 'payment.settled') {
      await settlePayment(event.merchOrderId, event.amount, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'payment.failed') {
      await failPayment(event.merchOrderId, raw, outRequestNo, tradeStatus, raw);
    } else if (event.type === 'refund.succeeded') {
      await markRefundSucceeded(event.refundRequestNo, raw);
    } else if (event.type === 'refund.failed') {
      await markRefundFailed(event.refundRequestNo, raw);
    }

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const { status, body } = toErrorEnvelope(err, requestId);
    return NextResponse.json(body, { status });
  }
}

// Update RefundRetry + Payment when a refund webhook arrives. Without this,
// the row stays 'pending'/'processing' forever and the user is never notified
// (only the polling-based processRefundRetries path would have marked it).
async function markRefundSucceeded(refundRequestNo: string, raw: unknown): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    const updated = await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ['pending', 'processing'] } },
      data: { status: 'succeeded' },
    });
    if (updated.count === 0) return;
    const retry = await tx.refundRetry.findUnique({ where: { refundRequestNo } });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({ where: { id: retry.paymentId } });
    if (!fresh) return;
    // refundAmountCents was already reserved at scheduleRefund time.
    // Do NOT add retry.amountCents again — that would double-count.
    const allRefunded = fresh.refundAmountCents >= fresh.amountCents;
    await tx.payment.update({
      where: { id: fresh.id },
      data: {
        status: allRefunded ? 'refunded' : 'partially_refunded',
        refundedAt: new Date(),
      },
    });
    const userId = fresh.userId;
    const refundAmount = retry.amountCents;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import('@/lib/outbox');
      await enqueueNotification({
        userId,
        type: 'refund_completed',
        title: 'Refund completed',
        body: `Your refund of ${await formatETB(refundAmount)} has been processed.`,
      });
    });
  });
  for (const fx of sideEffects) { try { await fx(); } catch (e) { logger.error({ err: (e as Error).message }, '[refund-webhook] side effect failed'); } }
  logger.info({ refundRequestNo }, '[telebirr-webhook] refund succeeded');
}

async function markRefundFailed(refundRequestNo: string, raw: unknown): Promise<void> {
  const sideEffects: Array<() => Promise<void>> = [];
  await db.$transaction(async (tx) => {
    await tx.refundRetry.updateMany({
      where: { refundRequestNo, status: { in: ['pending', 'processing'] } },
      data: { status: 'permanent_failure', lastError: 'Webhook reported refund failed' },
    });
    const retry = await tx.refundRetry.findUnique({ where: { refundRequestNo } });
    if (!retry) return;
    const fresh = await tx.payment.findUnique({ where: { id: retry.paymentId } });
    if (!fresh) return;
    const userId = fresh.userId;
    sideEffects.push(async () => {
      const { enqueueNotification } = await import('@/lib/outbox');
      await enqueueNotification({
        userId,
        type: 'refund_failed',
        title: 'Refund failed',
        body: 'Your refund could not be processed by Telebirr.',
      });
    });
  });
  for (const fx of sideEffects) { try { await fx(); } catch (e) { logger.error({ err: (e as Error).message }, '[refund-webhook] side effect failed'); } }
  logger.warn({ refundRequestNo }, '[telebirr-webhook] refund failed');
}


export async function handleTwilioStatus(req: any, session: any, params: any, ctx: any): Promise<any> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const env = (await import('@/lib/env')).loadEnv();
    if (env.TWILIO_AUTH_TOKEN) {
      const { verifyTwilioSignature } = await import('@/lib/webhook-verify');
      const NextRequest = (await import('next/server')).NextRequest;
      if (!verifyTwilioSignature(req as unknown as NextRequest, env.TWILIO_AUTH_TOKEN)) {
        return { status: 401, data: { error: 'Invalid signature' } };
      }
    }
    const body = await req.text();
    const params = new URLSearchParams(body);
    const messageSid = params.get('MessageSid');
    const messageStatus = params.get('MessageStatus');
    const logger = (await import('@/lib/logger')).logger;
    logger.info({ messageSid, messageStatus }, '[webhook] Twilio SMS status');
    return { status: 200, data: { ok: true } };
  } catch (err) {
    return { status: 500, data: { error: 'Webhook processing failed' } };
  }
}


export async function handleResendStatus(req: any, session: any, params: any, ctx: any): Promise<any> {
  const requestId = ctx.requestId ?? crypto.randomUUID();
  try {
    const body = await req.text();
    const logger = (await import('@/lib/logger')).logger;
    logger.info({ bodyLength: body.length }, '[webhook] Resend email status received');
    return { status: 200, data: { ok: true } };
  } catch {
    return { status: 500, data: { error: 'Webhook processing failed' } };
  }
}
